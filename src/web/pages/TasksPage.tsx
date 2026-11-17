import { LayoutGrid, List, UserRound } from 'lucide-react'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { SegmentedControl } from '../ui'
import { BoardPage } from './BoardPage'
import { ListPage } from './ListPage'
import { MyTasksPage } from './MyTasksPage'

export type TaskView = 'my-work' | 'board' | 'list'
const VIEWS: TaskView[] = ['my-work', 'board', 'list']
const isView = (v: string | null): v is TaskView => VIEWS.includes(v as TaskView)

/** Tasks: one destination with My Work, Board and List views (`?view=`), filters kept in the URL. */
export function TasksPage() {
  const [params, setParams] = useSearchParams()
  const view: TaskView = isView(params.get('view')) ? (params.get('view') as TaskView) : 'board'
  const choose = (next: string) => {
    const p = new URLSearchParams(params)
    p.set('view', next)
    setParams(p)
  }
  return (
    <div className="tasks-area">
      <div className="tasks-viewbar">
        <SegmentedControl
          label="Task view"
          value={view}
          onValueChange={choose}
          options={[
            { value: 'my-work', label: 'My Work', icon: UserRound },
            { value: 'board', label: 'Board', icon: LayoutGrid },
            { value: 'list', label: 'List', icon: List },
          ]}
        />
      </div>
      {view === 'board' ? <BoardPage /> : view === 'list' ? <ListPage /> : <MyTasksPage />}
    </div>
  )
}

/** Old Board, List and My Tasks URLs open the matching Tasks view and keep their filters. */
export function LegacyTasksRedirect({ view }: { view: TaskView }) {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  params.set('view', view)
  return <Navigate to={`/tasks?${params.toString()}`} replace />
}
