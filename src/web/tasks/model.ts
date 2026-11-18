import { STATUS_LABELS, TASK_STATUSES, type Task, type TaskStatus } from '../../shared/contracts'
import type { DueTone, MeaningfulPriority, SelectOption } from '../ui'

/** Status tone for badges and the inline status control (always paired with the status text). */
export const STATUS_TONE: Record<TaskStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  backlog: 'neutral',
  ready: 'neutral',
  in_progress: 'info',
  blocked: 'danger',
  done: 'success',
  canceled: 'neutral',
}

export const STATUS_OPTIONS: SelectOption[] = TASK_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))

export const isOpen = (t: Pick<Task, 'status'>) => t.status !== 'done' && t.status !== 'canceled'

export function meaningfulPriority(task: Pick<Task, 'priority'>): MeaningfulPriority | null {
  return task.priority === 'urgent' || task.priority === 'high' ? task.priority : null
}

const localDay = (d: Date) => d.toLocaleDateString('en-CA')

/** The due date only while it still matters (open tasks), phrased relative to today. */
export function dueInfo(task: Pick<Task, 'dueAt' | 'status'>, now = new Date()): { label: string; tone: DueTone } | null {
  if (!task.dueAt || !isOpen(task)) return null
  const due = new Date(task.dueAt)
  const today = localDay(now)
  const tomorrow = localDay(new Date(now.getTime() + 86_400_000))
  const day = localDay(due)
  const short = due.toLocaleDateString([], { day: 'numeric', month: 'short' })
  if (day === today) return { label: 'Today', tone: 'warning' }
  if (day < today) return { label: `Overdue · ${short}`, tone: 'danger' }
  if (day === tomorrow) return { label: 'Tomorrow', tone: 'neutral' }
  return { label: short, tone: 'neutral' }
}

/** Open blockers, which the status alone does not show (a "Blocked" status is already on the item). */
export function blockedLabel(task: Pick<Task, 'openBlockerCount'>): string | null {
  return task.openBlockerCount > 0 ? `Blocked by ${task.openBlockerCount}` : null
}
