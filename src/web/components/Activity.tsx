import { Link } from 'react-router-dom'
import { STATUS_LABELS, type ActivityEvent, type TaskStatus } from '../../shared/contracts'
import { formatDate } from './ui'
import { Avatar, Badge } from '../ui'

const FIELD_LABELS: Record<string, string> = {
  title: 'title',
  description: 'description',
  projectId: 'project',
  status: 'status',
  priority: 'priority',
  dueAt: 'due date',
  assigneeId: 'assignee',
  labels: 'labels',
  name: 'name',
  body: 'body',
  sourceUrl: 'source URL',
  parentId: 'parent',
  startDate: 'start date',
  targetDate: 'target date',
}

function describeValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'none'
  if (field === 'status') return STATUS_LABELS[value as TaskStatus] ?? String(value)
  if (field === 'dueAt') return formatDate(String(value), false)
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'none'
  const text = String(value)
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

const PLAN_VERBS: Record<string, (d: Record<string, unknown>) => string> = {
  'project.member_added': (d) => `added ${String(d.memberName)} to the project`,
  'project.member_removed': (d) => `removed ${String(d.memberName)} from the project`,
  'project.milestone_added': (d) => `added milestone “${String(d.title)}”`,
  'project.milestone_updated': (d) => `changed milestone “${String(d.title)}”`,
  'project.milestone_completed': (d) => `completed milestone “${String(d.title)}”`,
  'project.milestone_reopened': (d) => `reopened milestone “${String(d.title)}”`,
  'project.milestone_removed': (d) => `removed milestone “${String(d.title)}”`,
}

export function describeActivity(event: ActivityEvent): string {
  const plan = PLAN_VERBS[event.verb]
  if (plan) return plan(event.data)
  const changes = event.data.changes as Record<string, { from: unknown; to: unknown }> | undefined
  if (changes && Object.keys(changes).length) {
    const parts = Object.entries(changes).map(([field, c]) => {
      if (field === 'description' || field === 'body') return `edited the ${FIELD_LABELS[field]}`
      if (field === 'assigneeId' || field === 'projectId' || field === 'parentId') return `changed the ${FIELD_LABELS[field]}`
      return `changed ${FIELD_LABELS[field] ?? field} from ${describeValue(field, c.from)} to ${describeValue(field, c.to)}`
    })
    const prefix = event.verb === 'task.claimed' ? 'claimed the task: ' : event.verb === 'task.completed' ? 'completed the task: ' : ''
    return prefix + parts.join('; ')
  }
  const client = event.data.clientName ? `${String(event.data.clientName)} on ${String(event.data.deviceName)}` : 'a device'
  if (event.verb === 'client_session.approved') return `signed in ${client}`
  if (event.verb === 'client_session.revoked') return `ended a Desktop/CLI session (${String(event.data.reason ?? 'revoked').replace(/_/g, ' ')})`
  if (event.verb === 'device.denied') return `denied a sign-in request from ${client}`
  const [type, action] = event.verb.split('.')
  const label = (event.data.title ?? event.data.name ?? event.data.displayName) as string | undefined
  return `${action?.replace(/_/g, ' ') ?? event.verb} ${type.replace(/_/g, ' ')}${label ? ` “${label}”` : ''}`
}

export function resourceLink(event: ActivityEvent): string | null {
  switch (event.resourceType) {
    case 'task':
      return `/tasks/${event.resourceId}`
    case 'project':
      return `/projects/${event.resourceId}`
    case 'document':
      return `/documents/${event.resourceId}`
    default:
      return null
  }
}

const RESOURCE_LABEL: Record<string, string> = { task: 'task', project: 'project', document: 'document' }

/**
 * Who did what, newest first. People and agents are told apart by text ("Agent") and avatar shape,
 * never by colour alone; each event links to what it changed when that still exists.
 */
export function ActivityList({ events, showResource = false }: { events: ActivityEvent[]; showResource?: boolean }) {
  if (events.length === 0) return <p className="ui-text-muted">No activity yet.</p>
  return (
    <ol className="activity-list">
      {events.map((e) => {
        const link = showResource ? resourceLink(e) : null
        const agent = e.actor?.kind === 'agent'
        return (
          <li key={e.id} className="activity-item">
            <Avatar name={e.actor?.displayName ?? 'System'} kind={agent ? 'agent' : 'human'} size="sm" />
            <div className="activity-body">
              <p className="activity-text">
                <strong>{e.actor?.displayName ?? 'System'}</strong>
                {agent && (
                  <>
                    {' '}
                    <Badge tone="agent">Agent</Badge>
                  </>
                )}{' '}
                {describeActivity(e)}
                {link && (
                  <>
                    {' '}
                    <Link to={link}>Open {RESOURCE_LABEL[e.resourceType] ?? e.resourceType}</Link>
                  </>
                )}
              </p>
              <time className="activity-time" dateTime={e.createdAt}>
                {formatDate(e.createdAt)}
              </time>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
