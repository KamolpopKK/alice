import { useEffect, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Pad, PadBlockPage } from '../../shared/pads'
import { client } from '../api'

/** Editable default name for a new Pad, in the viewer's locale and time zone (e.g. "15 Nov 2026, 09:30"). */
export function defaultPadName(now = new Date(), locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(now)
}

const LAST_PAD_KEY = 'alice.taskPads.lastPadId'

/** The Pad opened most recently on this device (a convenience only; the server list is authoritative). */
export function rememberLastPad(id: string): void {
  try {
    localStorage.setItem(LAST_PAD_KEY, id)
  } catch {
    /* storage unavailable */
  }
}

export function lastPadId(): string | null {
  try {
    return localStorage.getItem(LAST_PAD_KEY)
  } catch {
    return null
  }
}

export function usePads(archived: 'active' | 'archived' = 'active', enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['pads', archived],
    queryFn: async () => {
      // รายการ Pad ของคนหนึ่งคนมีขนาดเล็ก: โหลดครบทุกหน้าเพื่อเรียง Pinned/Recent ได้ถูกต้อง
      const items: Pad[] = []
      let cursor: string | null = null
      do {
        const page = await client.pads.list(archived, { cursor, limit: 200 })
        items.push(...page.items)
        cursor = page.nextCursor
      } while (cursor && items.length < 2000)
      return items
    },
  })
}

export function usePad(id: string | undefined) {
  return useQuery({ queryKey: ['pad', id], queryFn: () => client.pads.get(id!), enabled: Boolean(id) })
}

export const BLOCK_PAGE_SIZE = 200

/**
 * Blocks in document order. The first window renders immediately; later windows load in the
 * background so search targets and keyboard navigation reach the whole Pad.
 */
export function usePadBlocks(padId: string | undefined) {
  const query = useInfiniteQuery({
    queryKey: ['pad-blocks', padId],
    queryFn: ({ pageParam }) => client.pads.blocks(padId!, { cursor: pageParam, limit: BLOCK_PAGE_SIZE }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: PadBlockPage) => last.nextCursor,
    enabled: Boolean(padId),
  })
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])
  return query
}

export function usePadSearch(q: string) {
  const [debounced, setDebounced] = useState(q)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200)
    return () => clearTimeout(t)
  }, [q])
  return useQuery({ queryKey: ['pad-search', debounced], queryFn: () => client.pads.search(debounced, { limit: 30 }), enabled: debounced.length > 0 })
}

export function usePadMutations() {
  const qc = useQueryClient()
  const refresh = (pad?: Pad) => {
    if (pad) qc.setQueryData(['pad', pad.id], pad)
    void qc.invalidateQueries({ queryKey: ['pads'] })
    void qc.invalidateQueries({ queryKey: ['pad-search'] })
  }
  return {
    create: useMutation({ mutationFn: (name: string) => client.pads.create({ name }).then((r) => r.pad), onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof client.pads.update>[1] }) => client.pads.update(id, patch).then((r) => r.pad),
      onSuccess: refresh,
    }),
    archive: useMutation({ mutationFn: (id: string) => client.pads.archive(id).then((r) => r.pad), onSuccess: refresh }),
    restore: useMutation({ mutationFn: (id: string) => client.pads.restore(id).then((r) => r.pad), onSuccess: refresh }),
    remove: useMutation({
      mutationFn: (id: string) => client.pads.delete(id),
      onSuccess: (res) => {
        qc.removeQueries({ queryKey: ['pad', res.id] })
        qc.removeQueries({ queryKey: ['pad-blocks', res.id] })
        refresh()
      },
    }),
  }
}

export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false)
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const on = () => setMatches(mql.matches)
    on()
    mql.addEventListener('change', on)
    return () => mql.removeEventListener('change', on)
  }, [query])
  return matches
}

/** Below this width the list and the editor are separate screens. */
export const NARROW_QUERY = '(max-width: 859px)'
