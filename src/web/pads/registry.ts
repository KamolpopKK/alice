import { client } from '../api'
import { PadModel } from './model'
import { PadOutbox } from './outbox'

// One editor model per open Pad. A model that still has unsent intents stays alive after its editor
// closes (navigating to another Pad) and keeps sending in the background; its outbox is saved
// throughout, so a reload or restart replays whatever is left.

interface Entry {
  model: PadModel
  outbox: PadOutbox
  users: number
  imported: boolean
}

const entries = new Map<string, Entry>()

function save(entry: Entry, now = false): void {
  entry.outbox.save(entry.model.exportOutbox(), now)
}

function create(padId: string, actorId: string, archived: boolean): Entry {
  const model = new PadModel(padId, client, { archived })
  const entry: Entry = { model, outbox: new PadOutbox(actorId, padId), users: 0, imported: false }
  model.onChange = () => save(entry)
  model.onIdle = () => {
    if (entry.users === 0) close(padId, entry)
  }
  entries.set(padId, entry)
  return entry
}

function close(padId: string, entry: Entry): void {
  save(entry, true)
  entry.outbox.dispose()
  entry.model.dispose()
  if (entries.get(padId) === entry) entries.delete(padId)
}

export function acquirePad(padId: string, actorId: string, archived: boolean): Entry {
  let entry = entries.get(padId)
  if (entry && entry.model.opts.archived !== archived && !entry.model.hasPendingWork()) {
    close(padId, entry)
    entry = undefined
  }
  entry ??= create(padId, actorId, archived)
  entry.users++
  return entry
}

export function releasePad(padId: string, entry: Entry): void {
  entry.users = Math.max(0, entry.users - 1)
  if (entry.users > 0) return
  // ข้อความที่ยังรอ debounce ต้องกลายเป็น intent ก่อนปิด editor
  entry.model.flushAll()
  save(entry, true)
  if (!entry.model.hasPendingWork()) close(padId, entry)
}

/** The open (or still sending) model of a Pad. */
export function padModel(padId: string): PadModel | undefined {
  return entries.get(padId)?.model
}

/** Restores the saved outbox once per model (a reopened editor reuses the live model instead). */
export function importSavedOutbox(entry: Entry): number {
  if (entry.imported) return 0
  entry.imported = true
  const saved = entry.outbox.load()
  if (!saved) return 0
  entry.model.importOutbox(saved)
  return entry.model.restored
}

export function wakeAll(): void {
  for (const e of entries.values()) e.model.wake()
}

if (typeof window !== 'undefined') {
  const flush = () => {
    for (const e of entries.values()) {
      e.model.flushAll()
      e.outbox.release(e.model.exportOutbox())
    }
  }
  window.addEventListener('pagehide', flush)
  window.addEventListener('beforeunload', flush)
  window.addEventListener('online', wakeAll)
}
