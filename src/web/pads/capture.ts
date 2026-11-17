import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { client } from '../api'
import { defaultPadName, lastPadId } from './hooks'

export type CaptureIntent = 'open-last' | 'new-pad'
export interface CaptureRequest {
  id: string
  intent: CaptureIntent
}

const HANDLED_KEY = 'alice.capture.handled'
const WEB_SHORTCUTS_KEY = 'alice.webCaptureShortcuts'

function handledIds(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(HANDLED_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

/** Marks a capture request handled; false when it already was (history state survives reload). */
function claim(id: string): boolean {
  const ids = handledIds()
  if (ids.includes(id)) return false
  try {
    sessionStorage.setItem(HANDLED_KEY, JSON.stringify([...ids.slice(-50), id]))
  } catch {
    /* storage unavailable: still handle once in this page */
  }
  return true
}

/**
 * Turns a capture request (Desktop global shortcut or active-tab shortcut) into exactly one Pad
 * action: open the last Pad with a fresh capture line, or create one date-and-time Pad.
 */
export function useCaptureIntent(): void {
  const location = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const capture = (location.state as { capture?: CaptureRequest } | null)?.capture
  useEffect(() => {
    if (!capture || !claim(capture.id)) return
    const open = (padId: string) => navigate(`/pads/${padId}`, { replace: true, state: { focusCapture: true, focusToken: capture.id } })
    const create = async () => {
      const { pad } = await client.pads.create({ name: defaultPadName(), mutationId: `capture-${capture.id}`.replace(/[^A-Za-z0-9_.:-]/g, '-').slice(0, 128) })
      void qc.invalidateQueries({ queryKey: ['pads'] })
      open(pad.id)
    }
    void (async () => {
      if (capture.intent === 'new-pad') return create()
      const page = await client.pads.list('active', { limit: 200 })
      const remembered = lastPadId()
      const target = page.items.find((p) => p.id === remembered) ?? [...page.items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      if (target) open(target.id)
      else await create()
    })()
  }, [capture, navigate, qc])
}

export function webShortcutsEnabled(): boolean {
  try {
    return localStorage.getItem(WEB_SHORTCUTS_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setWebShortcutsEnabled(on: boolean): void {
  try {
    localStorage.setItem(WEB_SHORTCUTS_KEY, on ? 'on' : 'off')
  } catch {
    /* ignore */
  }
}

/** Active-tab equivalents: Alt+Shift+P (last pad) and Alt+Shift+N (new pad). Never OS-global. */
export function matchWebShortcut(e: KeyboardEvent): CaptureIntent | null {
  if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.repeat) return null
  if (e.code === 'KeyP') return 'open-last'
  if (e.code === 'KeyN') return 'new-pad'
  return null
}

export function useWebCaptureShortcuts(available = true): void {
  const navigate = useNavigate()
  useEffect(() => {
    if (!available) return
    const onKey = (e: KeyboardEvent) => {
      const intent = matchWebShortcut(e)
      if (!intent || !webShortcutsEnabled()) return
      // dialog ที่เปิดอยู่ (modal) มาก่อนเสมอ
      if (document.querySelector('dialog[open]')) return
      e.preventDefault()
      navigate('/pads', { state: { capture: { id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, intent } } })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, available])
}
