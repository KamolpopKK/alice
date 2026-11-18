import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { TASK_VIEWS, type TaskViewName } from '../../shared/saved-views'
import { client } from '../api'
import { useCapability } from '../hooks'

/** A named Tasks view (view + filters + sort) as the toolbar shows it. */
export type SavedView = { id: string; name: string; search: string }

const KEY = 'alice.tasks.savedViews'

function readLocal(): SavedView[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((v): v is SavedView => typeof v?.id === 'string' && typeof v?.name === 'string' && typeof v?.search === 'string') : []
  } catch {
    return []
  }
}

function writeLocal(views: SavedView[]) {
  try {
    if (views.length) localStorage.setItem(KEY, JSON.stringify(views))
    else localStorage.removeItem(KEY)
  } catch {
    /* storage unavailable: the view lasts for this page only */
  }
}

/** Query string worth saving: everything except the open task. */
export function savedSearch(search: string): string {
  const p = new URLSearchParams(search)
  p.delete('task')
  return p.toString()
}

/** Splits a Tasks query string into the stored view and the rest (filters, search, sort). */
function split(search: string): { view: TaskViewName; query: string } {
  const p = new URLSearchParams(savedSearch(search))
  const raw = p.get('view')
  p.delete('view')
  return { view: TASK_VIEWS.includes(raw as TaskViewName) ? (raw as TaskViewName) : 'board', query: p.toString() }
}

/**
 * Saved views follow the person to every device when the server supports it (`saved-views`);
 * older servers keep them on this device. Views saved on this device before are moved to the
 * server once.
 */
export function useSavedViews() {
  const remote = useCapability('saved-views')
  const qc = useQueryClient()
  const server = useQuery({ queryKey: ['saved-views'], queryFn: () => client.savedViews.list(), enabled: remote })
  const [local, setLocal] = useState(readLocal)

  // ย้ายของที่เคยเก็บในเครื่องขึ้น server ครั้งเดียว แล้วลบออกจากเครื่อง
  useEffect(() => {
    if (!remote || server.isLoading || server.error) return
    const pending = readLocal()
    if (!pending.length) return
    void Promise.allSettled(pending.map((v) => client.savedViews.save({ name: v.name, ...split(v.search) }))).then((results) => {
      writeLocal(pending.filter((_, i) => results[i].status === 'rejected'))
      setLocal(readLocal())
      void qc.invalidateQueries({ queryKey: ['saved-views'] })
    })
  }, [remote, server.isLoading, server.error, qc])

  const saveRemote = useMutation({
    mutationFn: ({ name, search }: { name: string; search: string }) => client.savedViews.save({ name, ...split(search) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-views'] }),
  })
  const removeRemote = useMutation({
    mutationFn: (id: string) => client.savedViews.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-views'] }),
  })

  const save = useCallback(
    (name: string, search: string) => {
      if (remote) return saveRemote.mutate({ name, search })
      const next = [...readLocal().filter((v) => v.name !== name), { id: `view_${Date.now().toString(36)}`, name, search: savedSearch(search) }]
      writeLocal(next)
      setLocal(next)
    },
    [remote, saveRemote],
  )
  const remove = useCallback(
    (id: string) => {
      if (remote) return removeRemote.mutate(id)
      const next = readLocal().filter((v) => v.id !== id)
      writeLocal(next)
      setLocal(next)
    },
    [remote, removeRemote],
  )

  const views: SavedView[] = remote
    ? (server.data ?? []).map((v) => ({ id: v.id, name: v.name, search: new URLSearchParams([['view', v.view], ...new URLSearchParams(v.query)]).toString() }))
    : local
  return { views, save, remove, onDevice: !remote, error: server.error ?? saveRemote.error ?? removeRemote.error, saving: saveRemote.isPending }
}
