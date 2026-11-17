import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { STATUS_LABELS } from '../../shared/contracts'
import type { PadTaskCandidate } from '../../shared/pads'
import { client } from '../api'

export interface PickerState {
  key: string
  mode: 'place' | 'mention' | 'markdown'
  query: string
}

export const PICKER_ID = 'pad-task-picker'
export const optionId = (i: number) => `${PICKER_ID}-opt-${i}`

/** Task results for `@`: title or id, with Project, Status and Assignee to tell similar tasks apart. */
export function usePickerResults(state: PickerState | null) {
  const [q, setQ] = useState(state?.query ?? '')
  useEffect(() => {
    const t = setTimeout(() => setQ(state?.query ?? ''), 120)
    return () => clearTimeout(t)
  }, [state?.query])
  const query = useQuery({
    queryKey: ['pad-task-search', q],
    queryFn: () => client.pads.taskSearch(q, 8),
    enabled: state !== null,
    staleTime: 5_000,
  })
  // ระหว่าง debounce ผลลัพธ์ยังเป็นของคำค้นเก่า: ห้ามให้ Enter เลือกจากผลเก่า
  const current = state !== null && q === state.query
  return { data: current ? query.data : undefined, isFetching: query.isFetching || !current, error: query.error }
}

export function MentionPicker({
  state,
  items,
  active,
  loading,
  onPick,
  onHover,
}: {
  state: PickerState
  items: PadTaskCandidate[]
  active: number
  loading: boolean
  onPick: (c: PadTaskCandidate) => void
  onHover: (i: number) => void
}) {
  return (
    <div className="mention-picker">
      <ul id={PICKER_ID} role="listbox" aria-label={state.mode === 'place' ? 'Place an existing task' : 'Mention a task'}>
        {items.map((c, i) => (
          <li
            key={c.task.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            className={i === active ? 'is-active' : undefined}
            onMouseDown={(e) => {
              // อย่าให้ editor เสีย focus ก่อนเลือก
              e.preventDefault()
              onPick(c)
            }}
            onMouseEnter={() => onHover(i)}
          >
            <span className="mention-picker-title">{c.task.title}</span>
            <span className="mention-picker-meta">
              {c.task.project.name} · {STATUS_LABELS[c.task.status]} · {c.task.assignee?.displayName ?? 'Unassigned'}
              {state.mode === 'place' && c.placed && ' · already in a pad, adds a mention'}
            </span>
          </li>
        ))}
      </ul>
      {!loading && items.length === 0 && <p className="muted small mention-picker-empty">No matching tasks</p>}
      <p className="sr-only" role="status">
        {loading ? 'Searching tasks' : `${items.length} task${items.length === 1 ? '' : 's'} found`}
      </p>
    </div>
  )
}
