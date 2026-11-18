import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Archive, X } from 'lucide-react'
import { STATUS_LABELS, TASK_STATUSES, type Task, type TaskStatus } from '../../shared/contracts'
import { client } from '../api'
import { useActors } from '../hooks'
import { Button, FieldMessage, IconButton } from '../ui'

type Selection = {
  selected: ReadonlySet<string>
  toggle: (id: string) => void
  setMany: (ids: string[], on: boolean) => void
  clear: () => void
}

const SelectionContext = createContext<Selection | null>(null)
/** The current List selection, or null where tasks cannot be selected (Board, My Work, Projects). */
export const useTaskSelection = () => useContext(SelectionContext)

export function useSelectionState(visibleIds: string[]): Selection {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  // งานที่หายไปจากรายการ (ถูกกรองออกหรือถูกลบ) ไม่ค้างอยู่ใน selection
  const key = visibleIds.join(',')
  useEffect(() => {
    setSelected((prev) => {
      const visible = new Set(visibleIds)
      const next = new Set([...prev].filter((id) => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const toggle = useCallback((id: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }), [])
  const setMany = useCallback((ids: string[], on: boolean) => setSelected((prev) => {
    const next = new Set(prev)
    for (const id of ids) if (on) next.add(id)
    else next.delete(id)
    return next
  }), [])
  const clear = useCallback(() => setSelected(new Set()), [])
  return useMemo(() => ({ selected, toggle, setMany, clear }), [selected, toggle, setMany, clear])
}

export function SelectionProvider({ value, children }: { value: Selection; children: ReactNode }) {
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}

/** Checkbox for one task; checked state is the only thing it shows. */
export function SelectTask({ task }: { task: Pick<Task, 'id' | 'title'> }) {
  const sel = useTaskSelection()
  if (!sel) return null
  return <input type="checkbox" className="ui-checkbox tasks-select" aria-label={`Select ${task.title}`} checked={sel.selected.has(task.id)} onChange={() => sel.toggle(task.id)} />
}

/** "Select all" for the tasks currently shown; mixed when only some are selected. */
export function SelectAll({ ids }: { ids: string[] }) {
  const sel = useTaskSelection()
  if (!sel) return null
  const count = ids.filter((id) => sel.selected.has(id)).length
  return (
    <input
      type="checkbox"
      className="ui-checkbox tasks-select"
      aria-label="Select all shown tasks"
      checked={count > 0 && count === ids.length}
      ref={(el) => {
        if (el) el.indeterminate = count > 0 && count < ids.length
      }}
      onChange={() => sel.setMany(ids, count !== ids.length)}
    />
  )
}

type Outcome = { done: number; failed: number; action: string } | null

/**
 * Actions for the selected tasks. Each task is changed through the normal API (one request each), so
 * permissions, activity and attribution are exactly as if the person changed them one by one.
 */
export function BulkBar({ tasks }: { tasks: Task[] }) {
  const sel = useTaskSelection()
  const qc = useQueryClient()
  const actors = useActors()
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>(null)
  if (!sel || (sel.selected.size === 0 && !outcome)) return null
  const chosen = tasks.filter((t) => sel.selected.has(t.id))
  const run = async (action: string, fn: (t: Task) => Promise<unknown>) => {
    setBusy(true)
    const results = await Promise.allSettled(chosen.map(fn))
    setBusy(false)
    const failed = results.filter((r) => r.status === 'rejected').length
    setOutcome({ done: results.length - failed, failed, action })
    // สำเร็จแล้วล้าง selection; ที่ล้มเหลวยังเลือกไว้ให้ลองใหม่
    sel.setMany(
      chosen.filter((_, i) => results[i].status === 'fulfilled').map((t) => t.id),
      false,
    )
    void qc.invalidateQueries({ queryKey: ['tasks'] })
    for (const t of chosen) void qc.invalidateQueries({ queryKey: ['task', t.id] })
  }
  const people = (actors.data ?? []).filter((a) => !a.deactivatedAt)
  return (
    <div className="tasks-bulk" role="region" aria-label="Selected tasks">
      {sel.selected.size > 0 ? (
        <>
          <strong aria-live="polite">{sel.selected.size} selected</strong>
          <label className="tasks-bulk-field">
            <span className="ui-visually-hidden">Set status of selected tasks</span>
            <select
              className="ui-input ui-select"
              value=""
              disabled={busy}
              onChange={(e) => {
                const status = e.target.value as TaskStatus
                if (status) void run(`Status set to ${STATUS_LABELS[status]}`, (t) => client.tasks.update(t.id, { status }))
              }}
            >
              <option value="">Set status…</option>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="tasks-bulk-field">
            <span className="ui-visually-hidden">Assign selected tasks</span>
            <select
              className="ui-input ui-select"
              value=""
              disabled={busy}
              onChange={(e) => {
                const v = e.target.value
                if (!v) return
                const assigneeId = v === 'none' ? null : v
                const who = assigneeId ? people.find((a) => a.id === assigneeId)?.displayName : 'nobody'
                void run(`Assigned to ${who}`, (t) => client.tasks.update(t.id, { assigneeId }))
              }}
            >
              <option value="">Assign to…</option>
              <option value="none">Unassigned</option>
              {people.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                  {a.kind === 'agent' ? ' (agent)' : ''}
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" icon={Archive} loading={busy} onClick={() => void run('Archived', (t) => client.tasks.archive(t.id))}>
            Archive
          </Button>
          <Button size="sm" variant="ghost" onClick={sel.clear} disabled={busy}>
            Clear selection
          </Button>
        </>
      ) : null}
      {outcome && (
        <span className="tasks-bulk-outcome">
          {outcome.failed > 0 ? (
            <FieldMessage tone="error">
              {outcome.action}: {outcome.done} done, {outcome.failed} could not be changed and stay selected.
            </FieldMessage>
          ) : (
            <span role="status">
              {outcome.action}: {outcome.done} task{outcome.done === 1 ? '' : 's'}.
            </span>
          )}
          <IconButton icon={X} size="sm" label="Dismiss" onClick={() => setOutcome(null)} />
        </span>
      )}
    </div>
  )
}
