import { Link } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import type { Page, Task } from '../../shared/contracts'
import { client } from '../api'
import { Labels } from '../components/LabelsInput'
import { InlineStatus } from '../components/TaskCard'
import { TaskFilters, useFilterParams } from '../components/TaskFilters'
import { PriorityPill } from '../components/TaskFields'
import { RelationIndicators } from '../components/Relations'
import { ActorBadge, Empty, ErrorMessage, Loading, formatDate } from '../components/ui'

export function useTaskPages(key: string, filters: Record<string, string>, pageSize = 50) {
  return useInfiniteQuery({
    queryKey: ['tasks', key, filters],
    queryFn: ({ pageParam }) => client.tasks.list({ ...filters, limit: pageSize, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
}

export function TaskTable({ tasks, showProject = true }: { tasks: Task[]; showProject?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="table task-table">
        <thead>
          <tr>
            <th>Title</th>
            {showProject && <th>Project</th>}
            <th>Status</th>
            <th>Assignee</th>
            <th>Priority</th>
            <th>Due</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id}>
              <td>
                <Link to={`/tasks/${t.id}`}>{t.title}</Link> <RelationIndicators task={t} /> {t.archivedAt && <span className="pill pill-archived">archived</span>} <Labels labels={t.labels} />
              </td>
              {showProject && (
                <td>
                  <Link to={`/projects/${t.project.id}`} className="muted">
                    {t.project.name}
                  </Link>
                </td>
              )}
              <td>
                <InlineStatus task={t} label={`Status of ${t.title}`} />
              </td>
              <td>{t.assignee ? <ActorBadge actor={t.assignee} /> : <span className="muted">—</span>}</td>
              <td>
                <PriorityPill priority={t.priority} />
              </td>
              <td>{formatDate(t.dueAt, false)}</td>
              <td className="muted small">{formatDate(t.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ListPage() {
  const [filters] = useFilterParams()
  const query = useTaskPages('list', filters)
  const tasks = query.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <div className="page wide">
      <div className="page-head">
        <h1>Tasks</h1>
        <Link className="button primary" to="/tasks/new">
          New task
        </Link>
      </div>
      <TaskFilters showSort showArchived />
      <ErrorMessage error={query.error} />
      {query.isLoading ? <Loading /> : tasks.length === 0 ? <Empty>No tasks match these filters.</Empty> : <TaskTable tasks={tasks} />}
      {query.hasNextPage && (
        <button type="button" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
          Load more
        </button>
      )}
    </div>
  )
}
