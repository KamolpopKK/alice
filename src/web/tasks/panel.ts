import { createContext, useContext } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

/** Query parameter that opens Task Detail as a panel over a work view; linkable, and Back closes it. */
export const TASK_PARAM = 'task'

type PanelState = { taskPanel?: true } | null

/** Puts focus back on the task that opened the panel, once the view has re-rendered. */
export function focusTaskTrigger(taskId: string) {
  let tries = 0
  const attempt = () => {
    const el = document.querySelector<HTMLElement>(`[data-task-link="${CSS.escape(taskId)}"]`)
    if (el) el.focus()
    else if (++tries < 10) requestAnimationFrame(attempt)
  }
  requestAnimationFrame(attempt)
}

/** True inside a view that shows Task Detail beside itself; elsewhere task links navigate to the page. */
export const TaskPanelHost = createContext(false)
export const useHasTaskPanel = () => useContext(TaskPanelHost)

export function useTaskPanel() {
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const taskId = params.get(TASK_PARAM)
  const withTask = (id: string | null) => {
    const next = new URLSearchParams(location.search)
    if (id) next.set(TASK_PARAM, id)
    else next.delete(TASK_PARAM)
    const search = next.toString()
    return `${location.pathname}${search ? `?${search}` : ''}`
  }
  /** Opening adds a history entry so Back closes the panel; switching tasks replaces it. */
  const open = (id: string) => {
    navigate(withTask(id), { replace: Boolean(taskId), state: { taskPanel: true }, preventScrollReset: true })
  }
  const close = () => {
    const id = taskId
    if ((location.state as PanelState)?.taskPanel) navigate(-1)
    else navigate(withTask(null), { replace: true, preventScrollReset: true })
    if (id) focusTaskTrigger(id)
  }
  return { taskId, open, close }
}
