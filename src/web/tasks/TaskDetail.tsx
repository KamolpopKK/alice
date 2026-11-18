import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, ExternalLink, Pencil } from 'lucide-react'
import { TASK_PRIORITIES, type Task } from '../../shared/contracts'
import { ApiError, client } from '../api'
import { ActivityList } from '../components/Activity'
import { Labels, LabelsInput } from '../components/LabelsInput'
import { Markdown, MarkdownEditor } from '../components/Markdown'
import { dueInputValue } from '../components/TaskFields'
import { ActorBadge, formatDate } from '../components/ui'
import { useActors, useTaskActivity } from '../hooks'
import { useProjects } from '../pages/ProjectsPage'
import { TASK_MAIN_SECTIONS, TASK_SIDE_SECTIONS } from '../pages/taskSections'
import { Badge, Banner, Button, FieldMessage, LinkButton, SelectField, Skeleton, TextField, type SelectOption } from '../ui'
import { STATUS_OPTIONS, STATUS_TONE } from './model'
import { STATUS_LABELS } from '../../shared/contracts'

export type TaskDetailMode = 'page' | 'panel'

export const errorText = (error: unknown) => (error instanceof ApiError || error instanceof Error ? error.message : String(error))

/** Updates a task and refreshes every view that shows it. */
export function useTaskMutation(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => client.tasks.update(taskId, body),
    onSuccess: (res) => {
      qc.setQueryData(['task', taskId], res.task)
      void qc.invalidateQueries({ queryKey: ['task', taskId] })
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

type FieldKey = 'status' | 'assigneeId' | 'priority' | 'projectId' | 'dueAt'
type FieldState = { field: FieldKey; state: 'saving' | 'saved' | 'error'; message?: string } | null

/**
 * Per-field feedback: "Saving…" while the request runs, "Saved" briefly after, or the server's
 * message under the field that failed. Feedback stays next to the control that changed.
 */
function useFieldFeedback(taskId: string) {
  const update = useTaskMutation(taskId)
  const [state, setState] = useState<FieldState>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const change = (field: FieldKey, value: unknown) => {
    clearTimeout(timer.current)
    setState({ field, state: 'saving' })
    update.mutate(
      { [field]: value },
      {
        onSuccess: () => {
          setState({ field, state: 'saved' })
          timer.current = setTimeout(() => setState((s) => (s?.field === field && s.state === 'saved' ? null : s)), 2500)
        },
        onError: (error) => setState({ field, state: 'error', message: errorText(error) }),
      },
    )
  }
  const feedback = (field: FieldKey): ReactNode => {
    if (state?.field !== field) return null
    if (state.state === 'error') return <FieldMessage tone="error">{state.message}</FieldMessage>
    return (
      <span className="task-field-status" role="status">
        {state.state === 'saving' ? 'Saving…' : 'Saved'}
      </span>
    )
  }
  return { change, feedback, saving: update.isPending }
}

const PRIORITY_OPTIONS: SelectOption[] = TASK_PRIORITIES.map((p) => ({ value: p, label: p === 'none' ? 'No priority' : p[0].toUpperCase() + p.slice(1) }))

function Properties({ task, disabled }: { task: Task; disabled: boolean }) {
  const actors = useActors()
  const projects = useProjects()
  const { change, feedback } = useFieldFeedback(task.id)
  const assigneeId = useId()
  const people = (actors.data ?? []).filter((a) => a.kind === 'human')
  const agents = (actors.data ?? []).filter((a) => a.kind === 'agent')
  const projectList = projects.data?.items ?? []
  const projectOptions = (projectList.some((p) => p.id === task.project.id) ? projectList : [...projectList, task.project]).map((p) => ({ value: p.id, label: p.name }))
  return (
    <div className="task-properties">
      <div className="task-property">
        <SelectField label="Status" value={task.status} options={STATUS_OPTIONS} disabled={disabled} onChange={(e) => change('status', e.target.value)} />
        {feedback('status')}
      </div>
      <div className="task-property">
        {/* optgroup แยกคนกับ agent ให้ screen reader อ่านได้ */}
        <div className="ui-field">
          <label className="ui-field-label" htmlFor={assigneeId}>
            Assignee
          </label>
          <select id={assigneeId} className="ui-input ui-select" value={task.assignee?.id ?? ''} disabled={disabled} onChange={(e) => change('assigneeId', e.target.value || null)}>
            <option value="">Unassigned</option>
            <optgroup label="People">
              {people.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                </option>
              ))}
            </optgroup>
            <optgroup label="Agents">
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                </option>
              ))}
            </optgroup>
            {task.assignee && !actors.data?.some((a) => a.id === task.assignee?.id) && <option value={task.assignee.id}>{task.assignee.displayName}</option>}
          </select>
        </div>
        {feedback('assigneeId')}
      </div>
      <div className="task-property">
        <SelectField label="Priority" value={task.priority} options={PRIORITY_OPTIONS} disabled={disabled} onChange={(e) => change('priority', e.target.value)} />
        {feedback('priority')}
      </div>
      <div className="task-property">
        <SelectField label="Project" value={task.project.id} options={projectOptions} disabled={disabled} onChange={(e) => e.target.value && change('projectId', e.target.value)} />
        {feedback('projectId')}
      </div>
      <div className="task-property">
        <TextField label="Due date" type="date" value={dueInputValue(task.dueAt)} disabled={disabled} onChange={(e) => change('dueAt', e.target.value || null)} />
        {feedback('dueAt')}
      </div>
    </div>
  )
}

/**
 * Title, description and labels. If someone (a person or an agent) changes the task while it is
 * being edited, the editor says so and lets the person load the new version or keep their own.
 */
function EditTask({ task, onDone }: { task: Task; onDone: () => void }) {
  const update = useTaskMutation(task.id)
  const [base, setBase] = useState(task)
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [labels, setLabels] = useState(task.labels)
  const [kept, setKept] = useState<string | null>(null)
  const changedElsewhere =
    task.updatedAt !== base.updatedAt && kept !== task.updatedAt && (task.title !== base.title || task.description !== base.description || task.labels.join() !== base.labels.join())
  const useTheirs = () => {
    setBase(task)
    setTitle(task.title)
    setDescription(task.description)
    setLabels(task.labels)
  }
  return (
    <form
      className="task-edit"
      aria-label="Edit task"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        update.mutate({ title, description, labels }, { onSuccess: onDone })
      }}
    >
      {changedElsewhere && (
        <Banner
          tone="warning"
          title="This task changed while you were editing"
          action={
            <>
              <Button size="sm" onClick={useTheirs}>
                Load their changes
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setKept(task.updatedAt)}>
                Keep mine
              </Button>
            </>
          }
        >
          {task.updatedBy ? `${task.updatedBy.displayName} updated it. ` : ''}Saving now replaces their title, description and labels with yours.
        </Banner>
      )}
      <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} autoFocus />
      <MarkdownEditor id={`task-description-${task.id}`} label="Description (Markdown)" value={description} onChange={setDescription} rows={10} />
      <LabelsInput value={labels} onChange={setLabels} />
      {update.error && <FieldMessage tone="error">{errorText(update.error)}</FieldMessage>}
      <div className="task-edit-actions">
        <Button variant="primary" type="submit" loading={update.isPending}>
          Save
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </form>
  )
}

function TaskActivity({ taskId, mode }: { taskId: string; mode: TaskDetailMode }) {
  const activity = useTaskActivity(taskId)
  const headingId = `task-activity-${mode}-${taskId}`
  return (
    <section className="task-section" aria-labelledby={headingId}>
      <h2 id={headingId} className="task-section-title">
        Activity
      </h2>
      {activity.isLoading ? <Skeleton lines={3} /> : activity.error ? <FieldMessage tone="error">{errorText(activity.error)}</FieldMessage> : <ActivityList events={activity.data?.items ?? []} />}
    </section>
  )
}

/**
 * Task Detail: one component contract for the full page, the side panel beside a work view and the
 * full-height sheet on narrow screens. Every mode exposes the same fields, mutations and sections;
 * the mode changes only heading level, layout and the "Open full page" link.
 */
export function TaskDetail({ task, mode, headingId }: { task: Task; mode: TaskDetailMode; headingId?: string }) {
  const [editing, setEditing] = useState(false)
  const qc = useQueryClient()
  const archive = useMutation({
    mutationFn: (archived: boolean) => (archived ? client.tasks.archive(task.id) : client.tasks.restore(task.id)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['task', task.id] })
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
  const archived = task.archivedAt !== null
  const Heading = mode === 'page' ? 'h1' : 'h2'
  return (
    <article className={`task-detail task-detail--${mode}`} aria-labelledby={headingId}>
      <nav className="task-detail-crumbs" aria-label={mode === 'page' ? 'Breadcrumb' : 'Task location'}>
        <Link to={`/projects/${task.project.id}`}>{task.project.name}</Link>
        {mode === 'page' && (
          <>
            <span aria-hidden="true">/</span>
            <span className="ui-text-muted">{task.id}</span>
          </>
        )}
        {mode === 'panel' && (
          <LinkButton as={Link as never} to={`/tasks/${task.id}`} size="sm" variant="ghost" icon={ExternalLink} className="task-detail-full">
            Open full page
          </LinkButton>
        )}
      </nav>
      {editing ? (
        <EditTask task={task} onDone={() => setEditing(false)} />
      ) : (
        <header className="task-detail-head">
          <Heading id={headingId} className="task-detail-title">
            {task.title}
          </Heading>
          <div className="task-detail-actions">
            {!archived && (
              <Button size="sm" icon={Pencil} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            <Button size="sm" icon={archived ? ArchiveRestore : Archive} loading={archive.isPending} onClick={() => archive.mutate(!archived)}>
              {archived ? 'Restore' : 'Archive'}
            </Button>
          </div>
        </header>
      )}
      {archive.error && <FieldMessage tone="error">{errorText(archive.error)}</FieldMessage>}
      {archived && (
        <Banner tone="info" title="This task is archived.">
          Restore it to make changes.
        </Banner>
      )}
      <div className="task-detail-layout">
        <div className="task-detail-main">
          {!editing && (
            <>
              <div className="task-detail-badges">
                <Badge tone={STATUS_TONE[task.status]}>{STATUS_LABELS[task.status]}</Badge>
                <Labels labels={task.labels} />
              </div>
              <Markdown source={task.description} />
            </>
          )}
          {TASK_MAIN_SECTIONS.map(({ key, Component }) => (
            <Component key={key} task={task} />
          ))}
          <TaskActivity taskId={task.id} mode={mode} />
        </div>
        <aside className="task-detail-side" aria-label="Properties">
          <Properties task={task} disabled={archived} />
          <dl className="task-detail-meta">
            <dt>Created</dt>
            <dd>
              {formatDate(task.createdAt)} by <ActorBadge actor={task.createdBy} />
            </dd>
            <dt>Updated</dt>
            <dd>
              {formatDate(task.updatedAt)} by <ActorBadge actor={task.updatedBy} />
            </dd>
            {task.completedAt && (
              <>
                <dt>Completed</dt>
                <dd>{formatDate(task.completedAt)}</dd>
              </>
            )}
          </dl>
          {TASK_SIDE_SECTIONS.map(({ key, Component }) => (
            <Component key={key} task={task} />
          ))}
        </aside>
      </div>
    </article>
  )
}
