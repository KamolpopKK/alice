import type { ReactNode } from 'react'
import { ArrowUp, CalendarClock, ChevronsUp, FolderClosed, Lock } from 'lucide-react'
import { Avatar, Badge } from './display'
import { Icon } from './Icon'

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

/** Only priorities worth interrupting a scan for; lower ones live in Task Detail. */
export type MeaningfulPriority = 'urgent' | 'high'
export type DueTone = 'neutral' | 'warning' | 'danger'

export function PriorityBadge({ priority }: { priority: MeaningfulPriority }) {
  return (
    <Badge tone={priority === 'urgent' ? 'danger' : 'warning'} icon={priority === 'urgent' ? ChevronsUp : ArrowUp}>
      {priority === 'urgent' ? 'Urgent' : 'High'}
    </Badge>
  )
}

/** Due date as text first ("Today", "Overdue · 3 Feb"); the tone only reinforces it. */
export function DueLabel({ label, tone = 'neutral' }: { label: string; tone?: DueTone }) {
  return (
    <span className={cx('ui-task-due', `ui-task-due--${tone}`)}>
      <Icon icon={CalendarClock} size="sm" />
      <span>{label}</span>
    </span>
  )
}

export function BlockedBadge({ children = 'Blocked' }: { children?: ReactNode }) {
  return (
    <Badge tone="danger" icon={Lock}>
      {children}
    </Badge>
  )
}

export function AssigneeChip({ name, kind }: { name: string | null; kind?: 'human' | 'agent' }) {
  if (!name) return <span className="ui-task-assignee ui-text-muted">Unassigned</span>
  return (
    <span className="ui-task-assignee">
      <Avatar name={name} kind={kind} size="sm" />
      <span className="ui-task-assignee-name">{name}</span>
    </span>
  )
}

export function ProjectLabel({ name }: { name: string }) {
  return (
    <span className="ui-task-project">
      <Icon icon={FolderClosed} size="sm" />
      <span>{name}</span>
    </span>
  )
}

export type TaskItemProps = {
  /** The task title, usually a link that opens Task Detail. */
  title: ReactNode
  /** Status shown as a control or badge; omit where the context already states it (a Board column). */
  status?: ReactNode
  assignee?: { name: string | null; kind?: 'human' | 'agent' }
  priority?: MeaningfulPriority | null
  due?: { label: string; tone?: DueTone } | null
  /** Only when the surrounding view is not already scoped to one project. */
  project?: string | null
  /** Text such as "Blocked" or "Blocked by 2"; shown last so it is read after the title. */
  blocked?: string | null
  layout?: 'card' | 'row'
  selected?: boolean
  /** Pending or failed mutation feedback shown next to this task. */
  feedback?: ReactNode
  /** A selection checkbox shown before the title (rows only). */
  select?: ReactNode
}

/**
 * One task in a scan-friendly view. The content budget is fixed: title, status, assignee, meaningful
 * priority, relevant due date, project when needed and blocked state. Everything else is in Task Detail.
 */
export function TaskItem({ title, status, assignee, priority, due, project, blocked, layout = 'card', selected, feedback, select }: TaskItemProps) {
  return (
    <div className={cx('ui-task', `ui-task--${layout}`, selected && 'is-selected')}>
      <div className="ui-task-title">
        {select}
        {title}
      </div>
      <div className="ui-task-meta">
        {status}
        {priority && <PriorityBadge priority={priority} />}
        {assignee && <AssigneeChip name={assignee.name} kind={assignee.kind} />}
        {project && <ProjectLabel name={project} />}
        {due && <DueLabel label={due.label} tone={due.tone} />}
        {blocked && <BlockedBadge>{blocked}</BlockedBadge>}
      </div>
      {feedback && <div className="ui-task-feedback">{feedback}</div>}
    </div>
  )
}
