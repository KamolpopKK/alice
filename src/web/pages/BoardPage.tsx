import { Link } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { STATUS_LABELS, TASK_STATUSES, type Page, type Task, type TaskStatus } from '../../shared/contracts'
import { client } from '../api'
import { TaskCard } from '../components/TaskCard'
import { TaskFilters, useFilterParams } from '../components/TaskFilters'
import { Loading } from '../components/ui'

const COLUMN_PAGE = 25

function Column({ status, filters }: { status: TaskStatus; filters: Record<string, string> }) {
  const query = useInfiniteQuery({
    queryKey: ['tasks', 'board', status, filters],
    queryFn: ({ pageParam }) => client.tasks.list({ ...filters, status: [status], sort: 'priority', limit: COLUMN_PAGE, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
  const tasks = query.data?.pages.flatMap((p) => p.items) ?? []
  const headingId = `col-${status}`
  return (
    <section className="board-column" aria-labelledby={headingId}>
      <header className="board-column-head">
        <h2 id={headingId}>{STATUS_LABELS[status]}</h2>
        <span className="muted small">{query.hasNextPage ? `${tasks.length}+` : tasks.length}</span>
      </header>
      {query.isLoading ? (
        <Loading />
      ) : (
        <div className="board-column-body">
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
          {tasks.length === 0 && <p className="muted small">No tasks</p>}
          {query.hasNextPage && (
            <button type="button" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              Load more
            </button>
          )}
        </div>
      )}
    </section>
  )
}

export function BoardPage() {
  const [filters] = useFilterParams()
  const { status: _ignored, ...rest } = filters
  return (
    <div className="page wide">
      <div className="page-head">
        <h1>Board</h1>
        <Link className="button primary" to="/tasks/new">
          New task
        </Link>
      </div>
      <details className="filters-toggle">
        <summary>Filters</summary>
        <TaskFilters showStatus={false} />
      </details>
      {/* เลื่อนแนวนอนได้ด้วยคีย์บอร์ดแม้คอลัมน์ว่าง (axe: scrollable-region-focusable) */}
      <div className="board" tabIndex={0} role="region" aria-label="Board columns">
        {TASK_STATUSES.map((s) => (
          <Column key={s} status={s} filters={rest} />
        ))}
      </div>
    </div>
  )
}
