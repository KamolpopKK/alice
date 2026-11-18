import { useId, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarRange, Plus, Trash2, Users } from 'lucide-react'
import type { Milestone, Project } from '../../shared/contracts'
import { client } from '../api'
import { useActors } from '../hooks'
import { errorText } from '../tasks/TaskDetail'
import { Avatar, Badge, Button, EmptyState, FieldMessage, IconButton, Popover, SectionHeader, Skeleton, TextField } from '../ui'

const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
const today = () => new Date().toLocaleDateString('en-CA')

function useInvalidateProject(projectId: string) {
  const qc = useQueryClient()
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['project', projectId] }), qc.invalidateQueries({ queryKey: ['activity'] })])
}

/** Who works on the project. Informational only: adding someone grants no access. */
export function ProjectMembers({ project }: { project: Project }) {
  const members = useQuery({ queryKey: ['project', project.id, 'members'], queryFn: () => client.projects.members(project.id) })
  const actors = useActors()
  const refresh = useInvalidateProject(project.id)
  const [choice, setChoice] = useState('')
  const selectId = useId()
  const add = useMutation({ mutationFn: (actorId: string) => client.projects.addMember(project.id, actorId), onSuccess: () => (setChoice(''), refresh()) })
  const remove = useMutation({ mutationFn: (actorId: string) => client.projects.removeMember(project.id, actorId), onSuccess: refresh })
  const list = members.data ?? []
  const candidates = (actors.data ?? []).filter((a) => !a.deactivatedAt && !list.some((m) => m.actor.id === a.id))
  const readOnly = project.archivedAt !== null
  return (
    <div className="project-members">
      <span className="project-avatars" aria-hidden="true">
        {list.slice(0, 5).map((m) => (
          <Avatar key={m.actor.id} name={m.actor.displayName} kind={m.actor.kind} size="sm" />
        ))}
      </span>
      <Popover
        label="Project members"
        align="start"
        trigger={
          <Button size="sm" variant="ghost" icon={Users}>
            {members.isLoading ? 'Members' : `${list.length} member${list.length === 1 ? '' : 's'}`}
          </Button>
        }
      >
        <div className="project-members-panel">
          <p className="ui-text-muted">Members show who works on this project. Everyone in the workspace can still see and change it.</p>
          {list.length === 0 ? (
            <p className="ui-text-muted">No members yet.</p>
          ) : (
            <ul className="project-members-list" aria-label="Members">
              {list.map((m) => (
                <li key={m.actor.id}>
                  <Avatar name={m.actor.displayName} kind={m.actor.kind} size="sm" />
                  <span>{m.actor.displayName}</span>
                  {m.actor.kind === 'agent' && <Badge tone="agent">Agent</Badge>}
                  {!readOnly && <IconButton icon={Trash2} size="sm" label={`Remove ${m.actor.displayName} from the project`} onClick={() => remove.mutate(m.actor.id)} />}
                </li>
              ))}
            </ul>
          )}
          {!readOnly && candidates.length > 0 && (
            <form
              className="project-members-add"
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                if (choice) add.mutate(choice)
              }}
            >
              <div className="ui-field">
                <label className="ui-field-label" htmlFor={selectId}>
                  Add a person or agent
                </label>
                <select id={selectId} className="ui-input ui-select" value={choice} onChange={(e) => setChoice(e.target.value)}>
                  <option value="">Choose…</option>
                  {candidates.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.displayName}
                      {a.kind === 'agent' ? ' (agent)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <Button size="sm" type="submit" icon={Plus} disabled={!choice} loading={add.isPending}>
                Add
              </Button>
            </form>
          )}
          {(add.error || remove.error) && <FieldMessage tone="error">{errorText(add.error ?? remove.error)}</FieldMessage>}
        </div>
      </Popover>
    </div>
  )
}

/** Dates, task progress and milestones in the project Overview. */
export function ProjectPlan({ project }: { project: Project }) {
  const progress = useQuery({ queryKey: ['project', project.id, 'progress'], queryFn: () => client.projects.progress(project.id) })
  const p = progress.data
  const counted = p ? p.total - p.canceled : 0
  const percent = p && counted > 0 ? Math.round((p.done / counted) * 100) : 0
  const daysLeft = project.targetDate ? Math.round((Date.parse(`${project.targetDate}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 86_400_000) : null
  return (
    <section className="resource-panel" aria-labelledby="project-plan">
      <h2 id="project-plan" className="resource-panel-title">
        Plan
      </h2>
      <div className="project-plan-facts">
        <div>
          <p className="project-plan-label">Dates</p>
          {project.startDate || project.targetDate ? (
            <p className="project-plan-value">
              <CalendarRange aria-hidden="true" width={16} height={16} /> {project.startDate ? fmt(project.startDate) : 'No start'} – {project.targetDate ? fmt(project.targetDate) : 'no target'}
            </p>
          ) : (
            <p className="ui-text-muted">No dates yet. Add them with Edit.</p>
          )}
          {daysLeft !== null && !project.archivedAt && (
            <Badge tone={daysLeft < 0 ? 'danger' : daysLeft <= 7 ? 'warning' : 'neutral'}>{daysLeft < 0 ? `${-daysLeft} days past target` : daysLeft === 0 ? 'Target is today' : `${daysLeft} days left`}</Badge>
          )}
        </div>
        <div>
          <p className="project-plan-label" id={`progress-${project.id}`}>
            Progress
          </p>
          {progress.isLoading ? (
            <Skeleton lines={1} />
          ) : p && counted > 0 ? (
            <>
              <p className="project-plan-value">{percent}%</p>
              <div className="project-progress" role="progressbar" aria-labelledby={`progress-${project.id}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${p.done} of ${counted} tasks done`}>
                <span style={{ width: `${percent}%` }} />
              </div>
              <p className="ui-text-muted">
                {p.done} of {counted} tasks done{p.canceled ? ` · ${p.canceled} canceled not counted` : ''}
              </p>
            </>
          ) : (
            <p className="ui-text-muted">No tasks yet.</p>
          )}
        </div>
      </div>
      <Milestones project={project} />
    </section>
  )
}

function Milestones({ project }: { project: Project }) {
  const milestones = useQuery({ queryKey: ['project', project.id, 'milestones'], queryFn: () => client.projects.milestones(project.id) })
  const refresh = useInvalidateProject(project.id)
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const add = useMutation({
    mutationFn: () => client.projects.addMilestone(project.id, { title, dueDate: due || null }),
    onSuccess: () => {
      setTitle('')
      setDue('')
      refresh()
    },
  })
  // แสดงค่าที่เพิ่งกดทันที (optimistic) จนกว่ารายการที่โหลดใหม่จาก server จะมีค่านั้น
  // ไม่งั้น checkbox จะเด้งกลับไปค่าเก่าช่วงสั้น ๆ ระหว่างรอ refetch
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const update = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) => client.projects.updateMilestone(id, { completed }),
    onSuccess: () => refresh(),
    onSettled: (_d, _e, v) =>
      setPending((p) => {
        const next = { ...p }
        delete next[v.id]
        return next
      }),
  })
  const remove = useMutation({ mutationFn: (id: string) => client.projects.removeMilestone(id), onSuccess: refresh })
  const items = milestones.data ?? []
  const readOnly = project.archivedAt !== null
  const late = (m: Milestone) => !m.completedAt && m.dueDate !== null && m.dueDate < today()
  return (
    <div className="project-milestones">
      <SectionHeader title="Milestones" level={3} />
      {milestones.isLoading ? (
        <Skeleton lines={2} />
      ) : items.length === 0 ? (
        <EmptyState title="No milestones yet">Add the checkpoints that matter, such as a design review or the launch.</EmptyState>
      ) : (
        <ol className="project-milestone-list" aria-label="Milestones">
          {items.map((m) => (
            <li key={m.id} className={m.completedAt ? 'is-done' : undefined}>
              <input
                type="checkbox"
                className="ui-checkbox"
                aria-label={`${m.completedAt ? 'Reopen' : 'Complete'} milestone ${m.title}`}
                checked={pending[m.id] ?? m.completedAt !== null}
                disabled={readOnly || m.id in pending}
                onChange={(e) => {
                  const completed = e.target.checked
                  setPending((p) => ({ ...p, [m.id]: completed }))
                  update.mutate({ id: m.id, completed })
                }}
              />
              <span className="project-milestone-title">{m.title}</span>
              {m.dueDate && <span className={late(m) ? 'project-milestone-due is-late' : 'project-milestone-due'}>{late(m) ? `Late · ${fmt(m.dueDate)}` : fmt(m.dueDate)}</span>}
              {m.completedAt && <Badge tone="success">Done</Badge>}
              {!readOnly && <IconButton icon={Trash2} size="sm" label={`Delete milestone ${m.title}`} onClick={() => remove.mutate(m.id)} />}
            </li>
          ))}
        </ol>
      )}
      {!readOnly && (
        <form
          className="project-milestone-add"
          aria-label="Add a milestone"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (title.trim()) add.mutate()
          }}
        >
          <TextField label="Milestone" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Design review" />
          <TextField label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <Button size="sm" type="submit" icon={Plus} disabled={!title.trim()} loading={add.isPending}>
            Add milestone
          </Button>
        </form>
      )}
      {(add.error || update.error || remove.error) && <FieldMessage tone="error">{errorText(add.error ?? update.error ?? remove.error)}</FieldMessage>}
    </div>
  )
}
