import { useId } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Dialog } from '../components/Dialog'
import { ErrorMessage, Loading } from '../components/ui'
import { useTask } from '../hooks'
import { TaskDetailView } from '../pages/TaskDetailPage'

/** Query parameter that opens the Task side peek, so the peek is linkable and Back closes it. */
export const PEEK_PARAM = 'task'

export function usePeek() {
  const [params, setParams] = useSearchParams()
  const open = (taskId: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        next.set(PEEK_PARAM, taskId)
        return next
      },
      { preventScrollReset: true },
    )
  const close = () =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        next.delete(PEEK_PARAM)
        return next
      },
      { preventScrollReset: true },
    )
  return { taskId: params.get(PEEK_PARAM), open, close }
}

/**
 * Task Detail in a side peek: the same Task Detail view and mutations as the full page, shown in a
 * modal drawer so a Pad stays in place underneath.
 */
export function TaskPeek() {
  const { taskId, close } = usePeek()
  const headingId = useId()
  const task = useTask(taskId ?? '')
  return (
    <Dialog open={Boolean(taskId)} onClose={close} title={<span className="sr-only">Task details</span>} className="side-peek">
      {taskId && (
        <div className="side-peek-content">
          <p className="small">
            <Link to={`/tasks/${taskId}`}>Open full page</Link>
          </p>
          {task.isLoading && <Loading />}
          <ErrorMessage error={task.error} />
          {task.data && <TaskDetailView task={task.data} variant="peek" headingId={headingId} />}
        </div>
      )}
    </Dialog>
  )
}
