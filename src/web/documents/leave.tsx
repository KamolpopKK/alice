import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { useBlocker } from 'react-router-dom'
import { Button, Dialog } from '../ui'

/**
 * Leave coordinator: one place that knows whether any document draft is unsaved, and asks the person
 * before anything would throw it away (moving to another page, Back, reload, signing out, switching
 * workspace, and, in Alice Desktop, closing the window or quitting).
 *
 * Contract for other callers:
 * - `hasUnsavedDrafts()` — true while any registered editor has unsaved changes.
 * - `confirmLeave(action)` — resolves `true` at once when nothing is unsaved; otherwise shows the dialog and
 *   resolves `true` only after the person chooses to discard (their drafts are then cleared), `false` for Stay.
 * - `guarded(action, run)` — runs `run` only when `confirmLeave` resolves `true`.
 * - `subscribeUnsaved(listener)` — notified when the unsaved state changes (Desktop mirrors it natively).
 * It lives outside the React tree, above Alice Desktop's shell and sign-in, so it survives them remounting.
 * Drafts stay in memory only: a force quit, crash or killed process loses them.
 */
type Entry = { dirty: boolean; discard: () => void }
const editors = new Map<string, Entry>()
const listeners = new Set<() => void>()
type Ask = { action: string; resolve: (discard: boolean) => void }
let ask: ((request: Ask) => void) | null = null

function notify() {
  for (const l of listeners) l()
}

export function hasUnsavedDrafts(): boolean {
  for (const e of editors.values()) if (e.dirty) return true
  return false
}

export function subscribeUnsaved(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function discardAll() {
  for (const e of editors.values()) if (e.dirty) e.discard()
}

export function confirmLeave(action: string): Promise<boolean> {
  if (!hasUnsavedDrafts()) return Promise.resolve(true)
  // ไม่มีที่แสดง dialog (ไม่ควรเกิด): ไม่ทิ้งงานของคน
  if (!ask) return Promise.resolve(false)
  return new Promise((resolve) =>
    ask!({
      action,
      resolve: (discard) => {
        if (discard) discardAll()
        resolve(discard)
      },
    }),
  )
}

export async function guarded(action: string, run: () => void | Promise<void>): Promise<void> {
  if (await confirmLeave(action)) await run()
}

/**
 * Registers one editor. `dirty` says whether it has unsaved changes; `discard` throws the draft away when
 * the person confirms. Guards in-app navigation and Back (router blocker) and reload/closing the tab.
 * Call `allowNext()` right before navigating after a successful save or a confirmed cancel.
 */
export function useLeaveGuard(dirty: boolean, discard: () => void) {
  const id = useId()
  const bypass = useRef(false)
  const discardRef = useRef(discard)
  discardRef.current = discard
  useEffect(() => {
    editors.set(id, { dirty, discard: () => discardRef.current() })
    notify()
  }, [id, dirty])
  useEffect(
    () => () => {
      editors.delete(id)
      notify()
    },
    [id],
  )
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (bypass.current || !dirty) return false
    return currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search
  })
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    void confirmLeave('leave this page').then((ok) => {
      if (ok) {
        bypass.current = true
        blocker.proceed()
      } else blocker.reset()
    })
  }, [blocker])
  useEffect(() => {
    if (!dirty) return
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [dirty])
  return {
    allowNext: () => {
      bypass.current = true
    },
  }
}

export function useHasUnsavedDrafts(): boolean {
  return useSyncExternalStore(subscribeUnsaved, hasUnsavedDrafts)
}

/** The one confirmation dialog. Rendered once near the root of the app. */
export function LeaveDialogHost() {
  const [request, setRequest] = useState<Ask | null>(null)
  useEffect(() => {
    ask = (r) => setRequest(r)
    return () => {
      ask = null
    }
  }, [])
  const answer = (discard: boolean) => {
    request?.resolve(discard)
    setRequest(null)
  }
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && answer(false)} title="Discard unsaved changes?">
      <p>You have changes to a document that are not saved. If you {request?.action ?? 'continue'}, they will be lost.</p>
      <div className="resource-actions">
        <Button variant="primary" data-autofocus onClick={() => answer(false)}>
          Stay and keep editing
        </Button>
        <Button variant="danger" onClick={() => answer(true)}>
          Discard changes
        </Button>
      </div>
    </Dialog>
  )
}
