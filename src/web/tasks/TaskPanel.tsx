import { useEffect, useId, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { FullPageError, isRecoverable } from '../brand'
import { useTask } from '../hooks'
import { useMediaQuery } from '../pads/hooks'
import { Banner, Button, IconButton, Sheet, Skeleton } from '../ui'
import { TaskDetail, errorText } from './TaskDetail'
import { useTaskPanel } from './panel'

/** Wide enough for the work view and the panel side by side; narrower screens get a sheet. */
export const PANEL_QUERY = '(min-width: 1180px)'

function PanelBody({ taskId, headingId }: { taskId: string; headingId: string }) {
  const task = useTask(taskId)
  if (task.isLoading) return <Skeleton lines={6} />
  if (task.error || !task.data)
    return (
      <Banner tone="danger" title="This task could not be opened" action={<Button size="sm" onClick={() => void task.refetch()}>Try again</Button>}>
        {task.error ? errorText(task.error) : 'It may have been deleted.'}
      </Banner>
    )
  return <TaskDetail task={task.data} mode="panel" headingId={headingId} />
}

/**
 * Task Detail opened from a work view (`?task=` in the URL). Wide screens keep the view visible with
 * a non-modal side panel; narrow screens promote it to a full-height sheet. Closing puts focus back
 * on the task that opened it.
 */
export function TaskPanel() {
  const { taskId, close } = useTaskPanel()
  const wide = useMediaQuery(PANEL_QUERY)
  const headingId = useId()
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!taskId || !wide) return
    // โฟกัสไปที่หัวข้อเมื่อ task ใน panel เปลี่ยน (หัวข้อขึ้นหลังโหลดเสร็จ จึงลองซ้ำสั้น ๆ)
    let tries = 0
    let frame = 0
    const attempt = () => {
      const heading = document.getElementById(headingId)
      if (heading) {
        heading.tabIndex = -1
        heading.focus()
      } else if (++tries < 30) frame = requestAnimationFrame(attempt)
      else panel.current?.focus()
    }
    frame = requestAnimationFrame(attempt)
    return () => cancelAnimationFrame(frame)
  }, [taskId, wide, headingId])
  useEffect(() => {
    if (!taskId || !wide) return
    // panel ไม่ใช่ modal: Escape ปิดได้จากทุกที่ในหน้า ยกเว้นตอนพิมพ์ในช่อง หรือมี overlay อื่นเปิดอยู่
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]')) return
      e.preventDefault()
      close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })
  if (!taskId) return null
  if (wide)
    return (
      <aside
        ref={panel}
        className="task-panel"
        aria-label="Task details"
        tabIndex={-1}
      >
        <div className="task-panel-close">
          <IconButton icon={X} label="Close task details" size="sm" onClick={close} />
        </div>
        <PanelBody taskId={taskId} headingId={headingId} />
      </aside>
    )
  return (
    <Sheet open onOpenChange={(open) => !open && close()} title="Task details" hideTitle side="right" size="lg" onCloseAutoFocus={(e) => e.preventDefault()}>
      <PanelBody taskId={taskId} headingId={headingId} />
    </Sheet>
  )
}

/** `/tasks/:id`: the same Task Detail as a full page, for deep links and longer work. */
export function TaskDetailPage() {
  const { id = '' } = useParams()
  const task = useTask(id)
  const headingId = useId()
  if (task.isLoading)
    return (
      <div className="page task-page">
        <Skeleton lines={8} />
      </div>
    )
  if (task.error && isRecoverable(task.error)) return <FullPageError error={task.error} onRetry={() => void task.refetch()} />
  if (task.error || !task.data)
    return (
      <div className="page task-page">
        <Banner tone="danger" title="This task could not be opened">
          {task.error ? errorText(task.error) : 'Task not found'}
        </Banner>
      </div>
    )
  return (
    <div className="page task-page">
      <TaskDetail task={task.data} mode="page" headingId={headingId} />
    </div>
  )
}
