import type { LocalBlock } from './store'
import type { Op } from './model'

// Local loss-prevention buffer for unacknowledged Pad intents. It is not an offline copy of
// the Pad: it holds only intents the server has not confirmed, local-only lines and unsent typing.

export const OUTBOX_VERSION = 1
/** A serialized outbox larger than this is kept in memory only and reported to the user. */
export const OUTBOX_MAX_BYTES = 1_500_000
const HEARTBEAT_MS = 2_000
const LIVE_TAB_MS = 6_000

export interface SavedDraft {
  block: LocalBlock
  parentKey: string
  afterKey: string | null
}

export interface SavedOutbox {
  version: typeof OUTBOX_VERSION
  savedAt: number
  tabId: string
  heartbeat: number
  ops: Op[]
  drafts: SavedDraft[]
  dirty: Array<{ key: string; field: 'content' | 'title' | 'description'; value: unknown }>
  parked: Array<{ key: string; ops: Op[]; error: string }>
  /** Local key → server id for lines created by an earlier session. */
  ids: Array<[string, string]>
}

export type OutboxPayload = Omit<SavedOutbox, 'version' | 'savedAt' | 'tabId' | 'heartbeat'>

const tabId = Math.random().toString(36).slice(2, 12)

export function outboxKey(actorId: string, padId: string): string {
  return `alice.padOutbox.v${OUTBOX_VERSION}:${actorId}:${padId}`
}

function read(key: string): SavedOutbox | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SavedOutbox
    return parsed.version === OUTBOX_VERSION ? parsed : null
  } catch {
    return null
  }
}

export function isEmpty(p: OutboxPayload): boolean {
  return p.ops.length === 0 && p.drafts.length === 0 && p.dirty.length === 0 && p.parked.length === 0
}

/** Per-Pad, per-human outbox in browser storage (the Desktop WebView keeps it across restarts). */
export class PadOutbox {
  readonly key: string
  private timer: ReturnType<typeof setTimeout> | null = null
  private beat: ReturnType<typeof setInterval> | null = null
  private pending: OutboxPayload | null = null
  /** Set when the outbox no longer fits in storage; intents stay in memory and the user is told. */
  overflow = false

  constructor(actorId: string, padId: string) {
    this.key = outboxKey(actorId, padId)
  }

  /** Saved intents of an earlier session, unless another open tab is still working on them. */
  load(): SavedOutbox | null {
    const saved = read(this.key)
    if (!saved) return null
    if (saved.tabId !== tabId && Date.now() - saved.heartbeat < LIVE_TAB_MS) return null
    return saved
  }

  private released = false

  /** Throttled save; `now` writes immediately (page hide / unload). */
  save(payload: OutboxPayload, now = false): void {
    this.pending = payload
    this.released = false
    if (now) return this.write()
    if (this.timer) return
    this.timer = setTimeout(() => this.write(), 200)
  }

  write(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const payload = this.pending
    if (!payload) return
    try {
      if (isEmpty(payload)) {
        localStorage.removeItem(this.key)
        this.overflow = false
        this.stopHeartbeat()
        return
      }
      const value: SavedOutbox = { version: OUTBOX_VERSION, savedAt: Date.now(), tabId, heartbeat: this.released ? 0 : Date.now(), ...payload }
      const text = JSON.stringify(value)
      if (text.length > OUTBOX_MAX_BYTES) {
        this.overflow = true
        return
      }
      localStorage.setItem(this.key, text)
      this.overflow = false
      this.startHeartbeat()
    } catch {
      this.overflow = true
    }
  }

  /** The page is going away (reload, close): the next page load may take the outbox over at once. */
  release(payload: OutboxPayload): void {
    this.pending = payload
    this.released = true
    this.write()
    this.stopHeartbeat()
  }

  private startHeartbeat(): void {
    if (this.beat || this.released) return
    this.beat = setInterval(() => {
      const saved = read(this.key)
      if (!saved || saved.tabId !== tabId) return this.stopHeartbeat()
      try {
        localStorage.setItem(this.key, JSON.stringify({ ...saved, heartbeat: Date.now() }))
      } catch {
        /* ignore */
      }
    }, HEARTBEAT_MS)
  }

  private stopHeartbeat(): void {
    if (this.beat) clearInterval(this.beat)
    this.beat = null
  }

  dispose(): void {
    this.write()
    this.stopHeartbeat()
  }
}
