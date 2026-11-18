import { useId } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTask } from '../hooks'
import { TaskDetail, errorText } from '../tasks/TaskDetail'
import { Banner, Button, Sheet, Skeleton } from '../ui'

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
 * Task Detail beside a Pad: the shared Task Detail in a full-height sheet, so the Pad stays in place
 * underneath. Closing it returns focus to the line that opened it.
 */
export function TaskPeek() {
  const { taskId, close } = usePeek()
  const headingId = useId()
  const task = useTask(taskId ?? '')
  return (
    <Sheet open={Boolean(taskId)} onOpenChange={(open) => !open && close()} title="Task details" hideTitle side="right" size="lg">
      {taskId && (
        <>
          {task.isLoading && <Skeleton lines={6} />}
          {task.error && (
            <Banner tone="danger" title="This task could not be opened" action={<Button size="sm" onClick={() => void task.refetch()}>Try again</Button>}>
              {errorText(task.error)}
            </Banner>
          )}
          {task.data && <TaskDetail task={task.data} mode="panel" headingId={headingId} />}
        </>
      )}
    </Sheet>
  )
}
