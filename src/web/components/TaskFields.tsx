import { STATUS_LABELS, TASK_PRIORITIES, TASK_STATUSES, type Project, type PublicActor, type TaskPriority, type TaskStatus } from '../../shared/contracts'
import { Select } from './ui'

export function StatusSelect({ value, onChange, label = 'Status', disabled }: { value: TaskStatus; onChange: (s: TaskStatus) => void; label?: string; disabled?: boolean }) {
  return (
    <Select label={label} value={value} onChange={(e) => onChange(e.target.value as TaskStatus)} disabled={disabled}>
      {TASK_STATUSES.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </Select>
  )
}

export function PrioritySelect({ value, onChange, disabled }: { value: TaskPriority; onChange: (p: TaskPriority) => void; disabled?: boolean }) {
  return (
    <Select label="Priority" value={value} onChange={(e) => onChange(e.target.value as TaskPriority)} disabled={disabled}>
      {TASK_PRIORITIES.map((p) => (
        <option key={p} value={p}>
          {p === 'none' ? 'No priority' : p[0].toUpperCase() + p.slice(1)}
        </option>
      ))}
    </Select>
  )
}

export function AssigneeSelect({
  value,
  actors,
  onChange,
  disabled,
  label = 'Assignee',
}: {
  value: string | null
  actors: PublicActor[]
  onChange: (id: string | null) => void
  disabled?: boolean
  label?: string
}) {
  const humans = actors.filter((a) => a.kind === 'human')
  const agents = actors.filter((a) => a.kind === 'agent')
  return (
    <Select label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} disabled={disabled}>
      <option value="">Unassigned</option>
      <optgroup label="People">
        {humans.map((a) => (
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
    </Select>
  )
}

export function ProjectSelect({
  value,
  projects,
  onChange,
  disabled,
  allowDefault = false,
}: {
  value: string | null
  projects: Project[]
  onChange: (id: string | null) => void
  disabled?: boolean
  allowDefault?: boolean
}) {
  return (
    <Select label="Project" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} disabled={disabled}>
      {allowDefault && <option value="">Untitled (default)</option>}
      {projects
        .filter((p) => !(allowDefault && p.isSystem))
        .map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
    </Select>
  )
}

/** `<input type=date>` value from a stored due timestamp. */
export function dueInputValue(dueAt: string | null): string {
  return dueAt ? dueAt.slice(0, 10) : ''
}

export function PriorityPill({ priority }: { priority: TaskPriority }) {
  if (priority === 'none') return null
  return <span className={`pill pill-${priority}`}>{priority}</span>
}

export function StatusPill({ status }: { status: TaskStatus }) {
  return <span className={`pill pill-${status}`}>{STATUS_LABELS[status]}</span>
}
