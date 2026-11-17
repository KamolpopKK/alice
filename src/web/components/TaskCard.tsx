import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { STATUS_LABELS, TASK_STATUSES, type Task, type TaskStatus } from '../../shared/contracts'
import { client } from '../api'
import { Labels } from './LabelsInput'
import { PriorityPill } from './TaskFields'
import { RelationIndicators } from './Relations'
import { ActorBadge, formatDate } from './ui'

export function useStatusChange() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => client.tasks.update(id, { status }),
    onSuccess: (res) => {
      qc.setQueryData(['task', res.task.id], res.task)
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export function InlineStatus({ task, label }: { task: Task; label: string }) {
  const change = useStatusChange()
  return (
    <select
      aria-label={label}
      className="inline-select"
      value={task.status}
      disabled={change.isPending || task.archivedAt !== null}
      onChange={(e) => change.mutate({ id: task.id, status: e.target.value as TaskStatus })}
    >
      {TASK_STATUSES.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  )
}

function isOverdue(task: Task): boolean {
  return !!task.dueAt && task.status !== 'done' && task.status !== 'canceled' && Date.parse(task.dueAt) < Date.now()
}

export function TaskCard({ task, showProject = true }: { task: Task; showProject?: boolean }) {
  return (
    <article className="task-card" aria-label={task.title}>
      <Link to={`/tasks/${task.id}`} className="task-card-title">
        {task.title}
      </Link>
      <div className="task-card-meta small">
        {showProject && <span className="muted">{task.project.name}</span>}
        <PriorityPill priority={task.priority} />
        <RelationIndicators task={task} />
        {task.dueAt && <span className={isOverdue(task) ? 'overdue' : 'muted'}>Due {formatDate(task.dueAt, false)}</span>}
      </div>
      <Labels labels={task.labels} />
      <div className="task-card-foot">
        {task.assignee ? <ActorBadge actor={task.assignee} /> : <span className="muted small">Unassigned</span>}
        <InlineStatus task={task} label={`Status of ${task.title}`} />
      </div>
    </article>
  )
}
