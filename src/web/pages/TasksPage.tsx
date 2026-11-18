import { Plus } from 'lucide-react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { LinkButton } from '../ui'
import { useFilterParams } from '../tasks/hooks'
import { TaskPanel } from '../tasks/TaskPanel'
import { TaskPanelHost } from '../tasks/panel'
import { TaskToolbar, viewFilters, type TaskView } from '../tasks/TaskToolbar'
import { BoardView, ListView, MyWorkView } from '../tasks/views'

export type { TaskView }
const VIEWS: TaskView[] = ['my-work', 'board', 'list']
const isView = (v: string | null): v is TaskView => VIEWS.includes(v as TaskView)

/**
 * Tasks: My Work, Board and List as views of the same task data (`?view=`), sharing one toolbar,
 * the filters in the URL and Task Detail beside the view (`?task=`).
 */
export function TasksPage() {
  const [params, setParams] = useSearchParams()
  const [values] = useFilterParams()
  const view: TaskView = isView(params.get('view')) ? (params.get('view') as TaskView) : 'board'
  const filters = viewFilters(view, values)
  const choose = (next: TaskView) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        n.set('view', next)
        return n
      },
      { preventScrollReset: true },
    )
  const panelOpen = params.has('task')
  return (
    <TaskPanelHost.Provider value={true}>
    <div className={`tasks-layout${panelOpen ? ' has-panel' : ''}`}>
      <div className={`page tasks-page tasks-page--${view}`}>
        <div className="tasks-head">
          <h1>Tasks</h1>
          <LinkButton as={Link as never} to="/tasks/new" variant="primary" icon={Plus}>
            New task
          </LinkButton>
        </div>
        <TaskToolbar view={view} onView={choose} />
        {view === 'board' ? <BoardView filters={filters} /> : view === 'list' ? <ListView filters={filters} /> : <MyWorkView filters={filters} />}
      </div>
      <TaskPanel />
    </div>
    </TaskPanelHost.Provider>
  )
}

/** Old Board, List and My Tasks URLs open the matching Tasks view and keep their filters. */
export function LegacyTasksRedirect({ view }: { view: TaskView }) {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  params.set('view', view)
  return <Navigate to={`/tasks?${params.toString()}`} replace />
}
