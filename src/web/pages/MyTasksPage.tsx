import { STATUS_LABELS, TASK_STATUSES } from '../../shared/contracts'
import { TaskCard } from '../components/TaskCard'
import { Loading } from '../components/ui'
import { IllustratedState } from '../brand'
import { useTaskPages } from './ListPage'

export function MyTasksPage() {
  const query = useTaskPages('mine', { assigneeId: 'me', sort: 'due' }, 200)
  const tasks = query.data?.pages.flatMap((p) => p.items) ?? []
  const open = TASK_STATUSES.filter((s) => s !== 'done' && s !== 'canceled')
  return (
    <div className="page">
      <h1>My tasks</h1>
      {query.isLoading && <Loading />}
      {!query.isLoading && !query.error && tasks.every((t) => t.status === 'done' || t.status === 'canceled') && (
        <IllustratedState pose="neutral" copy="myTasksEmpty" title="Nothing assigned to you" />
      )}
      {open.map((status) => {
        const group = tasks.filter((t) => t.status === status)
        if (group.length === 0) return null
        return (
          <section key={status} className="section" aria-label={STATUS_LABELS[status]}>
            <h2>
              {STATUS_LABELS[status]} <span className="muted small">{group.length}</span>
            </h2>
            <div className="card-grid">
              {group.map((t) => (
                <TaskCard key={t.id} task={t} />
              ))}
            </div>
          </section>
        )
      })}
      {tasks.some((t) => t.status === 'done' || t.status === 'canceled') && (
        <details className="section">
          <summary>Done and canceled</summary>
          <div className="card-grid">
            {tasks
              .filter((t) => t.status === 'done' || t.status === 'canceled')
              .map((t) => (
                <TaskCard key={t.id} task={t} />
              ))}
          </div>
        </details>
      )}
      {query.hasNextPage && (
        <button type="button" onClick={() => void query.fetchNextPage()}>
          Load more
        </button>
      )}
    </div>
  )
}
