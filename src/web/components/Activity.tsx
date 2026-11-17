import { Link } from 'react-router-dom'
import { STATUS_LABELS, type ActivityEvent, type TaskStatus } from '../../shared/contracts'
import { ActorBadge, formatDate } from './ui'

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
}

function describeValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'none'
  if (field === 'status') return STATUS_LABELS[value as TaskStatus] ?? String(value)
  if (field === 'dueAt') return formatDate(String(value), false)
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'none'
  const text = String(value)
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

export function describeActivity(event: ActivityEvent): string {
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

export function ActivityList({ events, showResource = false }: { events: ActivityEvent[]; showResource?: boolean }) {
  if (events.length === 0) return <p className="muted">No activity yet.</p>
  return (
    <ol className="activity">
      {events.map((e) => {
        const link = showResource ? resourceLink(e) : null
        return (
          <li key={e.id}>
            <ActorBadge actor={e.actor} /> <span>{describeActivity(e)}</span>
            {link && (
              <>
                {' '}
                <Link to={link} className="small">
                  open {e.resourceType}
                </Link>
              </>
            )}
            <time className="muted small" dateTime={e.createdAt}>
              {formatDate(e.createdAt)}
            </time>
          </li>
        )
      })}
    </ol>
  )
}
