import { useCallback, useState } from 'react'

/** A named Tasks view (view + filters + sort), kept on this device only. */
export type SavedView = { id: string; name: string; search: string }

const KEY = 'alice.tasks.savedViews'

function read(): SavedView[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((v): v is SavedView => typeof v?.id === 'string' && typeof v?.name === 'string' && typeof v?.search === 'string') : []
  } catch {
    return []
  }
}

function write(views: SavedView[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(views))
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

export function useSavedViews() {
  const [views, setViews] = useState(read)
  const save = useCallback((name: string, search: string) => {
    const next = [...read().filter((v) => v.name !== name), { id: `view_${Date.now().toString(36)}`, name, search: savedSearch(search) }]
    write(next)
    setViews(next)
  }, [])
  const remove = useCallback((id: string) => {
    const next = read().filter((v) => v.id !== id)
    write(next)
    setViews(next)
  }, [])
  return { views, save, remove }
}
