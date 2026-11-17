import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Task } from '../../shared/contracts'
import { FullPageError, isRecoverable } from '../brand'
import { client } from '../api'
import { ActivityList } from '../components/Activity'
import { Labels, LabelsInput } from '../components/LabelsInput'
import { Markdown, MarkdownEditor } from '../components/Markdown'
import { AssigneeSelect, PrioritySelect, ProjectSelect, StatusSelect, StatusPill, dueInputValue } from '../components/TaskFields'
import { ActorBadge, ErrorMessage, Loading, TextInput, formatDate } from '../components/ui'
import { useActors, useTask, useTaskActivity } from '../hooks'
import { useProjects } from './ProjectsPage'
import { TASK_MAIN_SECTIONS, TASK_SIDE_SECTIONS } from './taskSections'

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

export function TaskDetailPage() {
  const { id = '' } = useParams()
  const task = useTask(id)
  if (task.isLoading) return <Loading />
  if (task.error && isRecoverable(task.error)) return <FullPageError error={task.error} onRetry={() => void task.refetch()} />
  if (task.error || !task.data) return <div className="page"><ErrorMessage error={task.error ?? 'Task not found'} /></div>
  return <TaskDetailView task={task.data} />
}

/**
 * Task Detail presentation shared by the full page and the Task side peek (Task Pads). Both variants
 * use the same queries and mutations; the peek only changes heading level and layout.
 */
export function TaskDetailView({ task, variant = 'page', headingId }: { task: Task; variant?: 'page' | 'peek'; headingId?: string }) {
  const [editing, setEditing] = useState(false)
  const update = useTaskMutation(task.id)
  const qc = useQueryClient()
  const archive = useMutation({
    mutationFn: (archived: boolean) => (archived ? client.tasks.archive(task.id) : client.tasks.restore(task.id)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['task', task.id] })
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
  const archived = task.archivedAt !== null
  const Heading = variant === 'peek' ? 'h2' : 'h1'
  return (
    <div className={variant === 'peek' ? 'task-peek-body' : 'page wide task-page'}>
      <nav className="breadcrumbs small" aria-label={variant === 'peek' ? 'Task location' : 'Breadcrumb'}>
        <Link to={`/projects/${task.project.id}`}>{task.project.name}</Link> <span aria-hidden="true">/</span>{' '}
        <span className="muted">{task.id}</span>
      </nav>
      <div className="task-layout">
        <div className="task-main">
          {editing ? (
            <EditTask task={task} onDone={() => setEditing(false)} />
          ) : (
            <>
              <div className="page-head">
                <Heading id={headingId}>{task.title}</Heading>
                <div className="row">
                  {!archived && (
                    <button type="button" onClick={() => setEditing(true)}>
                      Edit
                    </button>
                  )}
                  <button type="button" onClick={() => archive.mutate(!archived)}>
                    {archived ? 'Restore' : 'Archive'}
                  </button>
                </div>
              </div>
              {archived && <p className="notice">This task is archived. Restore it to make changes.</p>}
              <div className="row">
                <StatusPill status={task.status} />
                <Labels labels={task.labels} />
              </div>
              <Markdown source={task.description} />
            </>
          )}
          <ErrorMessage error={archive.error} />
          {TASK_MAIN_SECTIONS.map(({ key, Component }) => (
            <Component key={key} task={task} />
          ))}
          <TaskActivity taskId={task.id} />
        </div>
        <aside className="task-side" aria-label="Task details">
          <TaskSideFields task={task} disabled={archived} onChange={(body) => update.mutate(body)} />
          <ErrorMessage error={update.error} />
          <dl className="meta small">
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
    </div>
  )
}

function TaskSideFields({ task, disabled, onChange }: { task: Task; disabled: boolean; onChange: (body: Record<string, unknown>) => void }) {
  const actors = useActors()
  const projects = useProjects()
  const projectOptions = projects.data?.items ?? []
  const withCurrent = projectOptions.some((p) => p.id === task.project.id)
    ? projectOptions
    : [...projectOptions, { ...task.project, description: '', labels: [], systemKey: null, createdAt: '', updatedAt: '', createdBy: null, updatedBy: null }]
  return (
    <div className="stack">
      <StatusSelect value={task.status} onChange={(status) => onChange({ status })} disabled={disabled} />
      <AssigneeSelect value={task.assignee?.id ?? null} actors={actors.data ?? []} onChange={(assigneeId) => onChange({ assigneeId })} disabled={disabled} />
      <PrioritySelect value={task.priority} onChange={(priority) => onChange({ priority })} disabled={disabled} />
      <ProjectSelect value={task.project.id} projects={withCurrent} onChange={(projectId) => projectId && onChange({ projectId })} disabled={disabled} />
      <TextInput
        label="Due date"
        type="date"
        value={dueInputValue(task.dueAt)}
        onChange={(e) => onChange({ dueAt: e.target.value || null })}
        disabled={disabled}
      />
    </div>
  )
}

function EditTask({ task, onDone }: { task: Task; onDone: () => void }) {
  const update = useTaskMutation(task.id)
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [labels, setLabels] = useState(task.labels)
  return (
    <form
      className="panel stack"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        update.mutate({ title, description, labels }, { onSuccess: onDone })
      }}
    >
      <TextInput label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} />
      <MarkdownEditor id="task-description" label="Description (Markdown)" value={description} onChange={setDescription} rows={10} />
      <LabelsInput value={labels} onChange={setLabels} />
      <ErrorMessage error={update.error} />
      <div className="row">
        <button className="primary" type="submit" disabled={update.isPending}>
          Save
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function TaskActivity({ taskId }: { taskId: string }) {
  const activity = useTaskActivity(taskId)
  return (
    <section className="section" aria-labelledby="activity-heading">
      <h2 id="activity-heading">Activity</h2>
      {activity.isLoading ? <Loading /> : <ActivityList events={activity.data?.items ?? []} />}
    </section>
  )
}
