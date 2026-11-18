import { keepPreviousData, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import type { TaskStatus } from '../../shared/contracts'
import { client } from '../api'

/**
 * Paged task list for any view. Changing filters keeps the previous results on screen until the
 * new ones arrive, so a live update or a new filter never blanks the view.
 */
export function useTaskPages(key: string, filters: Record<string, string>, pageSize = 50) {
  return useInfiniteQuery({
    queryKey: ['tasks', key, filters],
    queryFn: ({ pageParam }) => client.tasks.list({ ...filters, limit: pageSize, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  })
}

/** Status change from a row or card; the caller shows pending and error next to that task. */
export function useStatusChange() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => client.tasks.update(id, { status }),
    onSuccess: (res) => {
      qc.setQueryData(['task', res.task.id], res.task)
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export const FILTER_KEYS = ['projectId', 'assigneeId', 'status', 'priority', 'label', 'dueAfter', 'dueBefore', 'archived', 'q', 'sort', 'order'] as const
export type FilterKey = (typeof FILTER_KEYS)[number]

/** Filters live in the URL so every view, saved view and shared link agrees on them. */
export function useFilterParams(): [Partial<Record<FilterKey, string>>, (key: FilterKey, value: string) => void, () => void] {
  const [params, setParams] = useSearchParams()
  const values: Partial<Record<FilterKey, string>> = {}
  for (const key of FILTER_KEYS) {
    const v = params.get(key)
    if (v) values[key] = v
  }
  const set = (key: FilterKey, value: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true, preventScrollReset: true },
    )
  const clear = () =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        for (const key of FILTER_KEYS) next.delete(key)
        return next
      },
      { replace: true, preventScrollReset: true },
    )
  return [values, set, clear]
}
