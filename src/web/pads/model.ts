import type { Task, TaskStatus } from '../../shared/contracts'
import type { PadBlock, PadBlockType, PadMentionInfo, PadSegment, PadTaskCandidate } from '../../shared/pads'
import { AliceClientError, type AliceClient } from '../../client'
import type { OutboxPayload } from './outbox'
import {
  PadTree,
  ROOT,
  blankBlock,
  newMutationId,
  plain,
  sameContent,
  type FlatRow,
  type LocalBlock,
  type MentionMap,
} from './store'

// Editor model for one Pad: local tree + ordered outbox of intents. Every user action updates the
// local tree immediately (no network wait) and appends an intent; intents are sent one at a time in
// order. Mutation ids make retries idempotent on the server.

export type OpKind = 'create' | 'update' | 'move' | 'convert' | 'delete' | 'complete' | 'reopen' | 'bulk' | 'undoCapture' | 'turnInto' | 'archiveTask' | 'restoreTask' | 'removeCompleted'

export interface Op {
  id: string
  kind: OpKind
  key: string
  keys?: string[]
  patch?: { content?: PadSegment[]; title?: string; description?: string; collapsed?: boolean }
  to?: PadBlockType
  mode?: 'promote' | 'subtree'
  targetTaskId?: string
  /** Frozen on first send so a retry repeats exactly the same request. */
  request?: { method: 'POST' | 'PATCH' | 'DELETE'; path: string; body: Record<string, unknown> } | null
}

export interface Snapshot {
  rev: number
  rows: FlatRow[]
  visible: FlatRow[]
  mentions: MentionMap
  focus: { key: string; field: 'title' | 'content' | 'description'; caret: 'start' | 'end' | number; seq: number } | null
  notice: { text: string; seq: number } | null
  pending: number
  failed: number
  offline: boolean
  undoLabel: string | null
}

interface UndoEntry {
  label: string
  run: () => void
}

const TRANSIENT = new Set(['NETWORK_ERROR', 'RATE_LIMITED', 'INTERNAL_ERROR', 'UNAUTHENTICATED'])
const DEBOUNCE_MS = 450
const enc = encodeURIComponent

export function isTransient(err: unknown): boolean {
  return !(err instanceof AliceClientError) || TRANSIENT.has(err.code)
}

export class PadModel {
  tree = new PadTree()
  private ops: Op[] = []
  private inflight: Op | null = null
  private parked = new Map<string, { ops: Op[]; error: string }>()
  private listeners = new Set<() => void>()
  private snapshot: Snapshot
  private rev = 0
  private focusSeq = 0
  private noticeSeq = 0
  private focusReq: Snapshot['focus'] = null
  private noticeVal: Snapshot['notice'] = null
  private mentions: MentionMap = {}
  private debounces = new Map<string, { timer: ReturnType<typeof setTimeout>; field: 'content' | 'title' | 'description' }>()
  /** Value last handed to the outbox per key+field (typing Undo restores it). */
  private baseline = new Map<string, unknown>()
  private undoStack: UndoEntry[] = []
  private replaying = false
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryDelay = 1000
  private offline = false
  private stale = false
  readonly ownMutations = new Set<string>()
  readonly expanded = new Set<string>()
  focusedKey: string | null = null
  private lastEdit = new Map<string, number>()
  disposed = false
  /** Called when the editor is quiet again and a server snapshot was skipped. */
  onNeedRefresh: (() => void) | null = null
  /** Called after every outbox change, so the outbox can be persisted. */
  onOutboxChange: (() => void) | null = null

  constructor(
    readonly padId: string,
    readonly client: AliceClient,
    readonly opts: { archived?: boolean } = {},
  ) {
    this.snapshot = this.build()
  }

  // ---------- subscription ----------

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  getSnapshot = () => this.snapshot

  private build(): Snapshot {
    const { rows, visible } = this.tree.flatten(this.expanded)
    let failed = 0
    for (const r of rows) if (r.block.sync === 'failed') failed++
    return {
      rev: this.rev,
      rows,
      visible,
      mentions: this.mentions,
      focus: this.focusReq,
      notice: this.noticeVal,
      pending: this.ops.length + (this.inflight ? 1 : 0) + this.debounces.size,
      failed,
      offline: this.offline,
      undoLabel: this.undoStack.at(-1)?.label ?? null,
    }
  }

  private emit(): void {
    this.rev++
    this.snapshot = this.build()
    for (const l of this.listeners) l()
    this.onChange?.()
  }

  /** Called when every intent has been acknowledged. */
  onIdle: (() => void) | null = null
  /** Called after every change (the outbox saves a throttled copy). */
  onChange: (() => void) | null = null

  notify(text: string): void {
    this.noticeVal = { text, seq: ++this.noticeSeq }
    this.emit()
  }

  requestFocus(key: string, field: 'title' | 'content' | 'description', caret: 'start' | 'end' | number = 'end'): void {
    this.focusReq = { key, field, caret, seq: ++this.focusSeq }
    this.emit()
  }

  // ---------- server snapshots ----------

  /** True when nothing local is waiting: safe to replace the tree with a server snapshot. */
  isQuiet(): boolean {
    return this.ops.length === 0 && this.inflight === null && this.debounces.size === 0
  }

  /**
   * Rebuilds the tree from the server, keeping local-only blocks (drafts, failed lines) in place.
   * Blocks edited elsewhere get a new `version` so their editors remount with the new text.
   */
  applyServer(items: PadBlock[], mentions: Record<string, PadMentionInfo>, remoteChanged: Set<string> = new Set()): void {
    this.mentions = { ...this.mentions, ...mentions }
    if (!this.isQuiet()) {
      this.stale = true
      this.emit()
      return
    }
    this.stale = false
    const keyById = new Map<string, string>()
    for (const b of this.tree.blocks.values()) if (b.id) keyById.set(b.id, b.key)
    const next = PadTree.fromServer(items, (id) => keyById.get(id) ?? id)
    // local-only blocks: drafts and failed lines stay where the writer left them
    for (const row of this.tree.flatten().rows) {
      const b = row.block
      if (b.id) continue
      const parentKey = next.has(row.parentKey) ? row.parentKey : ROOT
      const prev = this.tree.prevSibling(b.key)
      if (prev === null) next.insert(b, parentKey, null)
      else if (next.has(prev) && next.parentOf(prev) === parentKey) next.insert(b, parentKey, prev)
      else next.insert(b, parentKey, next.kids(parentKey).at(-1) ?? null)
    }
    let noticed = false
    for (const [key, b] of next.blocks) {
      const old = this.tree.blocks.get(key)
      if (!old || !b.id) continue
      const changed =
        old.type !== b.type || !sameContent(old.content, b.content) || (b.type === 'task' && (old.title !== b.title || old.description !== b.description))
      next.blocks.set(key, { ...b, version: changed ? old.version + 1 : old.version })
      if (changed && b.id && remoteChanged.has(b.id) && key === this.focusedKey && Date.now() - (this.lastEdit.get(key) ?? 0) < 60_000) noticed = true
    }
    this.tree = next
    this.ensureCapture()
    if (noticed) this.noticeVal = { text: 'This line was updated on another device. The newer version is shown.', seq: ++this.noticeSeq }
    this.emit()
  }

  // ---------- capture line ----------

  /** Keeps one empty Task line at the end so typing can always start immediately. */
  ensureCapture(): string {
    if (this.opts.archived) return ''
    const roots = this.tree.kids(ROOT)
    const last = roots.at(-1)
    const lastBlock = last ? this.tree.blocks.get(last) : undefined
    if (lastBlock && lastBlock.sync === 'draft' && !lastBlock.id && this.tree.kids(last!).length === 0) return last!
    const draft = blankBlock('task')
    this.tree.insert(draft, ROOT, last ?? null)
    return draft.key
  }

  captureKey(): string {
    const key = this.ensureCapture()
    this.emit()
    return key
  }

  // ---------- outbox ----------

  private enqueue(op: Omit<Op, 'id'> & { id?: string }): Op {
    const full: Op = { ...op, id: op.id ?? newMutationId() }
    this.ownMutations.add(full.id)
    this.ops.push(full)
    this.markSync(full.key)
    this.onOutboxChange?.()
    queueMicrotask(() => this.pump())
    return full
  }

  private markSync(key: string): void {
    if (!this.tree.has(key)) return
    const b = this.tree.get(key)
    if (this.parked.has(key)) {
      this.tree.update(key, { sync: 'failed', error: this.parked.get(key)!.error })
      return
    }
    const busy = this.ops.some((o) => o.key === key || o.keys?.includes(key)) || this.inflight?.key === key || this.debounces.has(key)
    if (b.sync === 'draft' && !busy && !b.id) return
    this.tree.update(key, { sync: busy ? 'pending' : b.id ? 'synced' : b.sync, error: null })
  }

  // ---------- local outbox ----------

  /** Everything the server has not confirmed yet, in a JSON-safe form. */
  exportOutbox(): OutboxPayload {
    const drafts: OutboxPayload['drafts'] = []
    for (const row of this.tree.flatten().rows) {
      const b = row.block
      const meaningful = b.title.trim() !== '' || b.content.length > 0 || b.description !== '' || b.taskId !== null
      if (b.id === null && meaningful) drafts.push({ block: b, parentKey: row.parentKey, afterKey: this.tree.prevSibling(b.key) })
    }
    const dirty: OutboxPayload['dirty'] = []
    for (const [key, d] of this.debounces) {
      if (!this.tree.has(key)) continue
      const b = this.tree.get(key)
      dirty.push({ key, field: d.field, value: d.field === 'content' ? b.content : d.field === 'title' ? b.title : b.description })
    }
    const ops = [...(this.inflight ? [this.inflight] : []), ...this.ops]
    const parked = [...this.parked.entries()].map(([key, v]) => ({ key, ops: v.ops, error: v.error }))
    const referenced = new Set<string>()
    for (const op of [...ops, ...parked.flatMap((p) => p.ops)]) for (const k of [op.key, ...(op.keys ?? [])]) referenced.add(k)
    const ids: Array<[string, string]> = []
    for (const k of referenced) {
      const id = this.idOf(k)
      if (id && id !== k) ids.push([k, id])
    }
    return { ops, drafts, dirty, parked, ids }
  }

  /**
   * Restores an earlier session's outbox on top of a fresh server snapshot: local-only lines go back
   * where they were, unsent typing is reapplied, and intents replay in their original order.
   */
  importOutbox(saved: OutboxPayload): void {
    const ids = new Map(saved.ids)
    // intent ที่ server ทำไปแล้ว (แต่คำตอบไม่ทันกลับก่อน reload) ดูได้จาก lastMutationId ของ block:
    // คิวส่งทีละตัวตามลำดับ จึงถือว่าทุกตัวก่อนหน้านั้นสำเร็จด้วย
    const opIndex = new Map(saved.ops.map((o, i) => [o.id, i]))
    const serverByOp = new Map<string, string[]>()
    for (const row of this.tree.flatten().rows) {
      const m = row.block.lastMutationId
      if (m && opIndex.has(m)) serverByOp.set(m, [...(serverByOp.get(m) ?? []), row.block.key])
    }
    let appliedUpTo = -1
    for (const [opId, keys] of serverByOp) {
      const i = opIndex.get(opId)!
      appliedUpTo = Math.max(appliedUpTo, i)
      const op = saved.ops[i]
      if (op.kind === 'bulk') op.keys?.forEach((k, j) => keys[j] && ids.set(k, keys[j]))
      else if (keys[0]) ids.set(op.key, keys[0])
    }
    saved = { ...saved, ops: saved.ops.slice(appliedUpTo + 1), drafts: saved.drafts.filter((d) => !ids.has(d.block.key) || !this.tree.has(ids.get(d.block.key)!)) }
    const keyFor = (k: string) => {
      if (this.tree.has(k)) return k
      const id = ids.get(k)
      if (id && this.tree.has(id)) return id
      return k
    }
    // บรรทัดว่างที่สร้างให้พิมพ์ต่อจะถูกสร้างใหม่หลังกู้คืน
    for (const b of [...this.tree.blocks.values()]) {
      if (!b.id && b.sync === 'draft' && !b.title && this.tree.kids(b.key).length === 0) this.tree.removePromote(b.key)
    }
    for (const d of saved.drafts) {
      if (this.tree.has(d.block.key)) continue
      const parentKey = d.parentKey === ROOT ? ROOT : keyFor(d.parentKey)
      if (parentKey !== ROOT && !this.tree.has(parentKey)) continue
      const after = d.afterKey ? keyFor(d.afterKey) : null
      this.tree.insert({ ...d.block, version: d.block.version + 1 }, parentKey, after && this.tree.has(after) ? after : null)
    }
    const translate = (op: Op): Op => ({ ...op, key: keyFor(op.key), keys: op.keys?.map(keyFor) })
    for (const [k, id] of ids) if (!this.tree.has(k)) this.removedIds.set(k, id)
    for (const op of saved.ops) {
      const t = translate(op)
      for (const k of [op.key, ...(op.keys ?? [])]) {
        const id = ids.get(k)
        if (id && !this.tree.has(keyFor(k))) this.removedIds.set(keyFor(k), id)
      }
      this.ownMutations.add(t.id)
      this.ops.push(t)
    }
    for (const p of saved.parked) this.parked.set(keyFor(p.key), { ops: p.ops.map(translate), error: p.error })
    for (const d of saved.dirty) {
      const key = keyFor(d.key)
      if (!this.tree.has(key)) continue
      const b = this.tree.get(key)
      this.tree.update(key, { [d.field]: d.value, version: b.version + 1 } as Partial<LocalBlock>)
      this.schedule(key, d.field)
    }
    for (const b of this.tree.blocks.values()) this.markSync(b.key)
    this.ensureCapture()
    this.restored = saved.ops.length + saved.drafts.length + saved.dirty.length + saved.parked.length
    // คำตอบของ intent ที่ replay อาจเป็นผลที่ server เก็บไว้ตั้งแต่ครั้งแรก: refetch เมื่อส่งครบ
    if (saved.ops.length) this.stale = true
    this.emit()
    queueMicrotask(() => this.pump())
  }

  restored = 0

  hasPendingWork(): boolean {
    return !this.isQuiet()
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.disposed) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.pump()
    }, this.retryDelay)
    this.retryDelay = Math.min(this.retryDelay * 2, 30_000)
  }

  /** Connectivity returned: retry immediately. */
  wake(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.retryDelay = 1000
    this.pump()
  }

  private idOf(key: string | null): string | null {
    if (key === null || key === ROOT) return null
    return this.tree.blocks.get(key)?.id ?? this.removedIds.get(key) ?? null
  }

  private hasUnsentCreate(key: string): boolean {
    return this.ops.some((o) => o.key === key && o.kind === 'create' && o.request === undefined)
  }

  /** The block exists on the server or its create is on the wire. */
  private serverKnows(key: string): boolean {
    if (this.idOf(key)) return true
    const inflight = this.inflight
    return inflight !== null && (inflight.key === key || inflight.keys?.includes(key) === true) && (inflight.kind === 'create' || inflight.kind === 'bulk')
  }

  /** Server placement for a block: its parent's id and the nearest previous sibling that exists. */
  private placement(key: string): { parentId: string | null; afterId: string | null } | { blocked: string } {
    const parentKey = this.tree.parentOf(key)
    const parentId = parentKey === ROOT ? null : this.idOf(parentKey)
    if (parentKey !== ROOT && !parentId) return { blocked: 'The line this belongs under has not been saved yet' }
    const siblings = this.tree.kids(parentKey)
    let afterId: string | null = null
    for (let i = siblings.indexOf(key) - 1; i >= 0; i--) {
      const id = this.idOf(siblings[i])
      if (id) {
        afterId = id
        break
      }
    }
    return { parentId, afterId }
  }

  private buildRequest(op: Op): Op['request'] | { blocked: string } {
    const base = `/pads/${enc(this.padId)}`
    const blockPath = (key: string) => {
      const id = this.idOf(key)
      return id ? `${base}/blocks/${enc(id)}` : null
    }
    if (!this.tree.has(op.key) && op.kind !== 'delete' && op.kind !== 'undoCapture' && op.kind !== 'bulk') return null
    switch (op.kind) {
      case 'create': {
        const b = this.tree.get(op.key)
        const pos = this.placement(op.key)
        if ('blocked' in pos) return pos
        const body: Record<string, unknown> = { type: b.type, ...pos, mutationId: op.id }
        if (b.type === 'task') {
          if (b.taskId && !b.id) body.taskId = b.taskId
          else body.title = b.title
        } else body.content = b.content
        return { method: 'POST', path: `${base}/blocks`, body }
      }
      case 'bulk': {
        const keys = (op.keys ?? []).filter((k) => this.tree.has(k))
        if (keys.length === 0) return null
        const pos = this.placement(keys[0])
        if ('blocked' in pos) return pos
        return { method: 'POST', path: `${base}/blocks/bulk`, body: { ...pos, titles: keys.map((k) => this.tree.get(k).title), mutationId: op.id } }
      }
      case 'update': {
        const path = blockPath(op.key)
        if (!path) return { blocked: 'This line has not been saved yet' }
        return { method: 'PATCH', path, body: { ...op.patch, mutationId: op.id } }
      }
      case 'move': {
        const path = blockPath(op.key)
        if (!path) return { blocked: 'This line has not been saved yet' }
        const pos = this.placement(op.key)
        if ('blocked' in pos) return pos
        return { method: 'POST', path: `${path}/move`, body: { ...pos, mutationId: op.id } }
      }
      case 'convert': {
        const path = blockPath(op.key)
        if (!path) return { blocked: 'This line has not been saved yet' }
        return { method: 'POST', path: `${path}/convert`, body: { type: op.to, mutationId: op.id } }
      }
      case 'complete':
      case 'reopen': {
        const path = blockPath(op.key)
        if (!path) return { blocked: 'This task has not been saved yet' }
        return { method: 'POST', path: `${path}/${op.kind}`, body: { mutationId: op.id } }
      }
      case 'archiveTask':
      case 'restoreTask': {
        const taskId = this.tree.get(op.key).taskId
        if (!taskId) return null
        return { method: 'POST', path: `/tasks/${enc(taskId)}/${op.kind === 'archiveTask' ? 'archive' : 'restore'}`, body: {} }
      }
      case 'delete': {
        // block ถูกเอาออกจาก tree แล้ว: ใช้ id ที่จำไว้ตอนลบ
        const id = this.idOf(op.key)
        return id ? { method: 'DELETE', path: `${base}/blocks/${enc(id)}`, body: { mode: op.mode ?? 'promote', mutationId: op.id } } : null
      }
      case 'undoCapture': {
        const ids = (op.keys ?? []).map((k) => this.idOf(k)).filter((id): id is string => Boolean(id))
        return ids.length ? { method: 'POST', path: `${base}/undo-task-capture`, body: { blockIds: ids, mutationId: op.id } } : null
      }
      default:
        return null
    }
  }

  private async pump(): Promise<void> {
    if (this.inflight || this.disposed) return
    const op = this.ops[0]
    if (!op) {
      this.retryDelay = 1000
      if (this.stale) this.onNeedRefresh?.()
      if (this.debounces.size === 0) this.onIdle?.()
      return
    }
    if (op.request === undefined) {
      const built = this.buildRequest(op)
      if (built && 'blocked' in built) {
        this.ops.shift()
        this.park(op, built.blocked)
        this.emit()
        return this.pump()
      }
      op.request = built
      this.onOutboxChange?.()
    }
    this.ops.shift()
    this.inflight = op
    if (!op.request) {
      this.inflight = null
      this.markSync(op.key)
      this.emit()
      return this.pump()
    }
    try {
      const res = await this.client.call<any>(op.request.method, op.request.path, { body: op.request.body })
      this.inflight = null
      if (this.offline) {
        this.offline = false
      }
      this.retryDelay = 1000
      this.applyResult(op, res)
    } catch (err) {
      this.inflight = null
      if (op.kind === 'delete' && err instanceof AliceClientError && err.code === 'NOT_FOUND') {
        // ลบไปแล้ว (เช่น replay ซ้ำหลัง reload) ถือว่าสำเร็จ
      } else if (isTransient(err)) {
        this.ops.unshift(op)
        this.offline = true
        // การส่งซ้ำอาจได้ผลลัพธ์เก่าที่ server เก็บไว้: ขอ snapshot ใหม่เมื่อส่งครบ
        this.stale = true
        this.emit()
        this.scheduleRetry()
        return
      } else {
        this.park(op, err instanceof Error ? err.message : String(err))
      }
    }
    this.onOutboxChange?.()
    for (const k of [op.key, ...(op.keys ?? [])]) this.markSync(k)
    this.emit()
    void this.pump()
  }

  /** A rejected intent keeps its text and waits for Retry or Discard, with the intents after it for the same line. */
  private park(op: Op, error: string): void {
    const key = op.key
    const later = this.ops.filter((o) => o.key === key)
    this.ops = this.ops.filter((o) => o.key !== key)
    const existing = this.parked.get(key)
    this.parked.set(key, { ops: [...(existing?.ops ?? []), op, ...later], error })
    if (this.tree.has(key)) this.tree.update(key, { sync: 'failed', error })
    for (const k of op.keys ?? []) if (this.tree.has(k)) this.tree.update(k, { sync: 'failed', error })
    this.onOutboxChange?.()
  }

  retry(key: string): void {
    const parked = this.parked.get(key)
    if (!parked) return
    this.parked.delete(key)
    for (const op of parked.ops) this.enqueue({ ...op, id: newMutationId(), request: undefined })
    this.markSync(key)
    this.emit()
  }

  discard(key: string): void {
    const parked = this.parked.get(key)
    this.parked.delete(key)
    const b = this.tree.blocks.get(key)
    if (b && !b.id) {
      for (const k of this.tree.removeSubtree(key)) this.parked.delete(k)
      this.ensureCapture()
    } else {
      this.stale = true
      if (this.isQuiet()) this.onNeedRefresh?.()
    }
    if (parked) for (const op of parked.ops) for (const k of op.keys ?? []) if (this.tree.has(k) && !this.tree.get(k).id) this.tree.removeSubtree(k)
    this.onOutboxChange?.()
    this.emit()
  }

  private applyResult(op: Op, res: any): void {
    const setFromServer = (key: string, block: PadBlock) => {
      if (!this.tree.has(key)) {
        // block ถูกลบในเครื่องระหว่างที่ create กำลังส่ง: จำ id ไว้ให้ delete ที่ตามมา
        this.removedIds.set(key, block.id)
        return
      }
      const cur = this.tree.get(key)
      // replay หลัง reload: server ส่ง block เดิมกลับมา ซึ่งอาจถูกโหลดมาแล้วอีกชุดหนึ่ง
      if (key !== block.id && this.tree.has(block.id)) this.tree.removePromote(block.id)
      const busy = this.ops.some((o) => o.key === key) || this.debounces.has(key)
      this.tree.set({
        ...cur,
        id: block.id,
        type: block.type,
        task: block.task,
        taskId: block.task?.id ?? null,
        previousStatus: block.previousStatus,
        content: busy || cur.type !== block.type ? (cur.type !== block.type ? block.content : cur.content) : block.content,
        title: busy ? cur.title : (block.task?.title ?? cur.title),
        description: busy ? cur.description : (block.task?.description ?? cur.description),
        version: cur.type !== block.type ? cur.version + 1 : cur.version,
      })
    }
    if (res?.mentions) this.mentions = { ...this.mentions, ...res.mentions }
    switch (op.kind) {
      case 'create':
      case 'update':
      case 'move':
      case 'convert':
      case 'complete':
      case 'reopen':
        if (res?.block) setFromServer(op.key, res.block)
        break
      case 'bulk':
        ;(op.keys ?? []).forEach((k, i) => res?.blocks?.[i] && setFromServer(k, res.blocks[i]))
        break
      case 'archiveTask':
      case 'restoreTask':
        if (res?.task && this.tree.has(op.key)) this.tree.update(op.key, { task: res.task })
        break
      default:
        break
    }
  }

  // ---------- typing ----------

  private touch(key: string): void {
    this.lastEdit.set(key, Date.now())
  }

  private schedule(key: string, field: 'content' | 'title' | 'description'): void {
    const prev = this.debounces.get(key)
    if (prev) clearTimeout(prev.timer)
    if (prev && prev.field !== field) this.flushField(key, prev.field)
    this.debounces.set(key, { field, timer: setTimeout(() => this.flush(key), DEBOUNCE_MS) })
  }

  /** Hands any typing waiting on the debounce to the outbox now (Enter, blur, structural actions). */
  flush(key: string): void {
    const d = this.debounces.get(key)
    if (!d) return
    clearTimeout(d.timer)
    this.debounces.delete(key)
    this.flushField(key, d.field)
    this.markSync(key)
    this.emit()
  }

  flushAll(): void {
    for (const key of [...this.debounces.keys()]) this.flush(key)
  }

  private flushField(key: string, field: 'content' | 'title' | 'description'): void {
    if (!this.tree.has(key)) return
    const b = this.tree.get(key)
    const value = field === 'content' ? b.content : field === 'title' ? b.title : b.description
    const baseKey = `${key}:${field}`
    const before = this.baseline.has(baseKey) ? this.baseline.get(baseKey) : field === 'content' ? b.content : field === 'title' ? (b.task?.title ?? '') : (b.task?.description ?? '')
    if (JSON.stringify(before) === JSON.stringify(value)) return
    // draft ยังไม่ถูกสร้าง: เนื้อหาจะไปกับ create
    const unsentCreate = this.ops.find((o) => o.key === key && o.kind === 'create' && o.request === undefined)
    if (b.type === 'task' && b.sync === 'draft' && !b.id && field !== 'description') return
    if (field === 'title' && !b.title.trim()) return
    this.baseline.set(baseKey, value)
    if (!this.replaying) {
      this.pushUndo('Typing', () => this.setField(key, field, before, true))
    }
    if (unsentCreate && field !== 'description') return
    const unsentUpdate = [...this.ops].reverse().find((o) => o.key === key && o.kind === 'update' && o.request === undefined)
    if (unsentUpdate && unsentUpdate === this.ops.at(-1)) {
      unsentUpdate.patch = { ...unsentUpdate.patch, [field]: field === 'title' ? b.title.trim() : value }
      this.onOutboxChange?.()
      return
    }
    this.enqueue({ kind: 'update', key, patch: { [field]: field === 'title' ? b.title.trim() : value } })
  }

  private setField(key: string, field: 'content' | 'title' | 'description', value: unknown, external: boolean): void {
    if (!this.tree.has(key)) return
    const b = this.tree.get(key)
    // ค่าก่อนเริ่มพิมพ์รอบนี้: ใช้เทียบว่ามีการเปลี่ยนจริงและเป็นจุดย้อนของ Undo
    const baseKey = `${key}:${field}`
    if (!this.baseline.has(baseKey)) this.baseline.set(baseKey, field === 'content' ? b.content : field === 'title' ? b.title : b.description)
    this.tree.update(key, { [field]: value, version: external ? b.version + 1 : b.version } as Partial<LocalBlock>)
    this.schedule(key, field)
    if (external) {
      this.flush(key)
      this.requestFocus(key, field)
    }
    this.markSync(key)
    this.emit()
  }

  setContent(key: string, content: PadSegment[]): void {
    this.touch(key)
    this.setField(key, 'content', content, false)
  }

  setTitle(key: string, title: string): void {
    this.touch(key)
    const b = this.tree.get(key)
    if (b.type === 'task' && !this.serverKnows(key) && !this.hasUnsentCreate(key)) {
      // draft ยังไม่ถูกสร้าง: ชื่ออยู่ในเครื่องจนกว่าจะกด Enter หรือออกจากบรรทัด
      this.tree.update(key, { title })
      this.emit()
      return
    }
    this.setField(key, 'title', title, false)
  }

  setDescription(key: string, description: string): void {
    this.touch(key)
    if (!this.serverKnows(key) && !this.ops.some((o) => o.key === key && o.kind === 'create')) {
      // draft: description ไปกับ commit ของ task
      this.tree.update(key, { description })
      this.emit()
      return
    }
    this.setField(key, 'description', description, false)
  }

  // ---------- undo ----------

  private pushUndo(label: string, run: () => void): void {
    if (this.replaying) return
    this.undoStack.push({ label, run })
    if (this.undoStack.length > 200) this.undoStack.shift()
  }

  undo(): boolean {
    this.flushAll()
    const entry = this.undoStack.pop()
    if (!entry) return false
    this.replaying = true
    try {
      entry.run()
    } finally {
      this.replaying = false
    }
    this.notify(`Undone: ${entry.label}`)
    return true
  }

  // ---------- structure ----------

  /** Creates a block right after `key` (or as the first child of an expanded Heading / Text with children). */
  insertAfter(key: string, type: PadBlockType, init: Partial<LocalBlock> = {}, opts: { asChild?: boolean } = {}): string {
    const ref = this.tree.get(key)
    const kids = this.tree.kids(key)
    const intoSection = opts.asChild ?? ((ref.type === 'heading' && !ref.collapsed && this.tree.depth(key) < 4) || (ref.type === 'text' && kids.length > 0))
    const block = blankBlock(type, init)
    if (intoSection) this.tree.insert(block, key, null)
    else this.tree.insert(block, this.tree.parentOf(key), key)
    if (type !== 'task' || block.title.trim()) this.createRemote(block.key)
    // บรรทัด Task ว่างไม่ต้องมี Undo ของตัวเอง (การสร้าง task จริงมี Undo ตอน commit)
    if (type !== 'task') this.pushUndo(`New ${type}`, () => this.removeLocal(block.key))
    this.emit()
    return block.key
  }

  /** Sends the create intent for a local block (Task drafts need a title). */
  private createRemote(key: string): void {
    const b = this.tree.get(key)
    if (this.serverKnows(key) || this.ops.some((o) => o.key === key && o.kind === 'create')) return
    if (b.type === 'task' && !b.title.trim() && !b.taskId) return
    if (b.type === 'task') this.tree.update(key, { title: b.title.replace(/\s+/g, ' ').trim(), sync: 'pending' })
    this.baseline.set(`${key}:title`, this.tree.get(key).title)
    this.baseline.set(`${key}:content`, b.content)
    this.enqueue({ kind: 'create', key })
  }

  /** Enter/blur on a Task line: a titled draft becomes a real task (optimistically). */
  commitTask(key: string): void {
    if (!this.tree.has(key)) return
    const b = this.tree.get(key)
    this.flush(key)
    if (b.type !== 'task') return
    if (!this.serverKnows(key) && !this.ops.some((o) => o.key === key && o.kind === 'create')) {
      if (!b.title.trim()) return
      this.createRemote(key)
      this.pushUndo('Task capture', () => this.undoCapture([key]))
      if (b.description) this.enqueue({ kind: 'update', key, patch: { description: b.description } })
      this.emit()
    }
  }

  /** Removes a block that exists only locally, or removes it remotely too. */
  private removeLocal(key: string): void {
    if (!this.tree.has(key)) return
    if (this.serverKnows(key) && !this.hasUnsentCreate(key)) return this.remove(key, 'promote', true)
    this.ops = this.ops.filter((o) => o.key !== key)
    this.tree.removePromote(key)
    this.ensureCapture()
    this.onOutboxChange?.()
    this.emit()
  }

  /** Undo of task capture: unsent intents are cancelled; confirmed tasks are archived and their blocks removed. */
  undoCapture(keys: string[]): void {
    const confirmed: string[] = []
    for (const key of keys) {
      if (!this.tree.has(key)) continue
      const unsentBulk = this.ops.find((o) => o.kind === 'bulk' && o.request === undefined && o.keys?.includes(key))
      if (unsentBulk) {
        unsentBulk.keys = unsentBulk.keys!.filter((k) => k !== key)
        if (unsentBulk.keys.length === 0) this.ops = this.ops.filter((o) => o !== unsentBulk)
        else unsentBulk.key = unsentBulk.keys[0]
      }
      if (this.hasUnsentCreate(key) || unsentBulk) {
        this.ops = this.ops.filter((o) => o.key !== key)
      } else if (this.serverKnows(key)) {
        confirmed.push(key)
      }
      this.rememberIds([key])
      this.tree.removePromote(key)
    }
    if (confirmed.length) {
      this.enqueue({ kind: 'undoCapture', key: confirmed[0], keys: confirmed })
    }
    this.ensureCapture()
    this.onOutboxChange?.()
    this.emit()
  }

  private removedIds = new Map<string, string>()

  /** Keeps server ids of blocks leaving the local tree, for intents sent after the removal. */
  private rememberIds(keys: string[]): void {
    for (const k of keys) {
      const id = this.tree.blocks.get(k)?.id
      if (id) this.removedIds.set(k, id)
    }
  }



  indent(key: string): void {
    const prev = this.tree.prevSibling(key)
    if (!prev) return this.notify('There is no line above to nest under')
    const problem = this.tree.canPlace(key, prev)
    if (problem) return this.notify(problem)
    const from = { parent: this.tree.parentOf(key), after: this.tree.prevSibling(key) }
    const lastChild = this.tree.kids(prev).at(-1) ?? null
    this.tree.move(key, prev, lastChild)
    if (this.tree.get(prev).collapsed) {
      this.tree.update(prev, { collapsed: false })
      this.queueCollapse(prev)
    }
    this.afterMove(key, 'Indent', from)
  }

  outdent(key: string): void {
    const parent = this.tree.parentOf(key)
    if (parent === ROOT) return
    const from = { parent, after: this.tree.prevSibling(key) }
    this.tree.move(key, this.tree.parentOf(parent), parent)
    this.afterMove(key, 'Outdent', from)
  }

  moveUp(key: string): void {
    const prev = this.tree.prevSibling(key)
    if (!prev) return this.notify('Already first in this section')
    const from = { parent: this.tree.parentOf(key), after: prev }
    this.tree.move(key, this.tree.parentOf(key), this.tree.prevSibling(prev))
    this.afterMove(key, 'Move up', from)
  }

  moveDown(key: string): void {
    const next = this.tree.nextSibling(key)
    if (!next) return this.notify('Already last in this section')
    const from = { parent: this.tree.parentOf(key), after: this.tree.prevSibling(key) }
    this.tree.move(key, this.tree.parentOf(key), next)
    this.afterMove(key, 'Move down', from)
  }

  /** Drag and drop / keyboard equivalent: place `key` before or after `target` at the target's level. */
  moveRelative(key: string, target: string, position: 'before' | 'after'): void {
    if (key === target || this.tree.isAncestor(key, target)) return
    const parent = this.tree.parentOf(target)
    const problem = this.tree.canPlace(key, parent)
    if (problem) return this.notify(problem)
    const from = { parent: this.tree.parentOf(key), after: this.tree.prevSibling(key) }
    const after = position === 'after' ? target : this.tree.prevSibling(target) === key ? this.tree.prevSibling(key) : this.tree.prevSibling(target)
    this.tree.move(key, parent, after)
    this.afterMove(key, 'Move', from)
  }

  private afterMove(key: string, label: string, from: { parent: string; after: string | null }): void {
    const b = this.tree.get(key)
    if (!this.hasUnsentCreate(key) && this.serverKnows(key)) this.enqueue({ kind: 'move', key })
    this.pushUndo(label, () => {
      if (!this.tree.has(key)) return
      if (from.parent !== ROOT && !this.tree.has(from.parent)) return
      this.tree.move(key, from.parent, from.after)
      this.afterMove(key, label, from)
    })
    this.requestFocus(key, b.type === 'task' ? 'title' : 'content')
    this.ensureCapture()
    this.emit()
  }

  private queueCollapse(key: string): void {
    const b = this.tree.get(key)
    if (this.serverKnows(key) || this.hasUnsentCreate(key)) this.enqueue({ kind: 'update', key, patch: { collapsed: b.collapsed } })
  }

  toggleCollapse(key: string): void {
    const b = this.tree.get(key)
    if (b.type !== 'heading') return
    this.tree.update(key, { collapsed: !b.collapsed })
    this.expanded.delete(key)
    this.queueCollapse(key)
    this.emit()
  }

  /** Search targets override collapse visually without changing the stored state. */
  reveal(keys: string[]): void {
    for (const k of keys) this.expanded.add(k)
    this.emit()
  }

  /**
   * Removes a block. `promote` lifts children one level; `subtree` removes nested blocks too.
   * Task blocks are only removed from the Pad: the task itself is never deleted or archived.
   */
  remove(key: string, mode: 'promote' | 'subtree' = 'promote', fromUndo = false): void {
    if (!this.tree.has(key)) return
    this.flush(key)
    const b = this.tree.get(key)
    const parent = this.tree.parentOf(key)
    const after = this.tree.prevSibling(key)
    const children = [...this.tree.kids(key)]
    const snapshot = mode === 'subtree' ? this.tree.subtree(key).map((k) => ({ block: this.tree.get(k), parent: this.tree.parentOf(k) })) : [{ block: b, parent }]
    const knows = this.serverKnows(key)
    this.rememberIds(this.tree.subtree(key))
    const removedKeys = mode === 'subtree' ? this.tree.removeSubtree(key) : (this.tree.removePromote(key), [key])
    // intent ที่ยังไม่ส่งของ block ที่หายไปแล้วไม่ต้องส่ง
    this.ops = this.ops.filter((o) => !(removedKeys.includes(o.key) && o.request === undefined && o.kind !== 'delete' && o.kind !== 'undoCapture'))
    if (knows) this.enqueue({ kind: 'delete', key, mode })
    if (!fromUndo) this.pushUndo(b.type === 'task' ? 'Remove from pad' : 'Delete', () => this.restoreRemoved(snapshot, after, mode === 'promote' ? children : []))
    this.ensureCapture()
    this.onOutboxChange?.()
    this.emit()
  }

  /** Undo of a removal: blocks come back as new blocks; Task blocks re-place their task. */
  private restoreRemoved(snapshot: Array<{ block: LocalBlock; parent: string }>, after: string | null, promotedChildren: string[]): void {
    const keyMap = new Map<string, string>()
    snapshot.forEach(({ block, parent }, i) => {
      const parentKey = i === 0 ? parent : (keyMap.get(parent) ?? parent)
      if (parentKey !== ROOT && !this.tree.has(parentKey)) return
      const fresh = blankBlock(block.type, {
        content: block.content,
        title: block.task?.title ?? block.title,
        taskId: block.taskId,
        task: block.task,
        description: block.description,
        collapsed: block.collapsed,
        sync: 'pending',
      })
      keyMap.set(block.key, fresh.key)
      const anchor = i === 0 ? (after && this.tree.has(after) ? after : null) : (this.tree.kids(parentKey).at(-1) ?? null)
      this.tree.insert(fresh, parentKey, anchor)
      this.enqueue({ kind: 'create', key: fresh.key })
    })
    const restored = keyMap.get(snapshot[0].block.key)
    if (restored) {
      for (const child of promotedChildren) {
        if (!this.tree.has(child)) continue
        this.tree.move(child, restored, this.tree.kids(restored).at(-1) ?? null)
        this.enqueue({ kind: 'move', key: child })
      }
      this.requestFocus(restored, snapshot[0].block.type === 'task' ? 'title' : 'content')
    }
    this.ensureCapture()
    this.emit()
  }

  // ---------- conversion ----------

  convert(key: string, to: PadBlockType): void {
    this.flush(key)
    const b = this.tree.get(key)
    if (b.type === to) return
    if (to === 'task' && this.tree.kids(key).length > 0) return this.notify('Nothing can be nested under a Task. Move the nested lines out first.')
    const before = { ...b }
    let patch: Partial<LocalBlock>
    if (to === 'task') {
      const title = plain(b.content).replace(/\s+/g, ' ').trim()
      if (!title) return this.notify('Write a title before turning this line into a Task')
      patch = { type: 'task', title, content: [], collapsed: false }
    } else if (b.type === 'task') {
      patch = { type: to, content: b.title ? [{ type: 'text', text: b.title }] : [], task: null, taskId: null, title: '', description: '' }
    } else {
      patch = { type: to, collapsed: false }
    }
    this.tree.update(key, { ...patch, version: b.version + 1 })
    if (this.hasUnsentCreate(key)) {
      // create ยังไม่ออก: ส่งเป็นชนิดใหม่ได้เลย
    } else if (this.serverKnows(key)) {
      this.enqueue({ kind: 'convert', key, to })
    } else {
      this.createRemote(key)
    }
    this.pushUndo(`Turn into ${to}`, () => this.revertConversion(key, before))
    this.requestFocus(key, to === 'task' ? 'title' : 'content')
    this.emit()
  }

  private revertConversion(key: string, before: LocalBlock): void {
    if (!this.tree.has(key)) return
    const now = this.tree.get(key)
    if (before.type === 'task' && before.taskId && now.type !== 'task') {
      // Task → Text: task ยังอยู่ วางกลับด้วย task เดิม
      const parent = this.tree.parentOf(key)
      const after = this.tree.prevSibling(key)
      this.remove(key, 'promote', true)
      const fresh = blankBlock('task', { taskId: before.taskId, task: before.task, title: before.title, description: before.description, sync: 'pending' })
      this.tree.insert(fresh, parent, after)
      this.enqueue({ kind: 'create', key: fresh.key })
      this.requestFocus(fresh.key, 'title')
    } else if (now.type === 'task' && before.type !== 'task') {
      // Text → Task: archive task ที่เพิ่งสร้าง แล้ววางข้อความเดิมกลับ
      const parent = this.tree.parentOf(key)
      const after = this.tree.prevSibling(key)
      this.undoCapture([key])
      const fresh = blankBlock(before.type, { content: before.content, sync: 'pending' })
      this.tree.insert(fresh, parent, after && this.tree.has(after) ? after : null)
      this.enqueue({ kind: 'create', key: fresh.key })
      this.requestFocus(fresh.key, 'content')
    } else {
      this.tree.update(key, { type: before.type, collapsed: before.collapsed, version: now.version + 1 })
      if (now.id) this.enqueue({ kind: 'convert', key, to: before.type })
    }
    this.emit()
  }

  // ---------- tasks ----------

  toggleComplete(key: string): void {
    const b = this.tree.get(key)
    if (!b.task) return
    const done = b.task.status === 'done'
    const previous = b.previousStatus as TaskStatus | null
    const status: TaskStatus = done ? (previous && previous !== 'done' ? previous : 'backlog') : 'done'
    this.tree.update(key, { task: { ...b.task, status }, previousStatus: done ? null : b.task.status })
    this.enqueue({ kind: done ? 'reopen' : 'complete', key })
    this.pushUndo(done ? 'Reopen' : 'Complete', () => this.toggleComplete(key))
    this.emit()
  }

  setTaskArchived(key: string, archived: boolean): void {
    const b = this.tree.get(key)
    if (!b.task) return
    this.tree.update(key, { task: { ...b.task, archivedAt: archived ? new Date().toISOString() : null } })
    this.enqueue({ kind: archived ? 'archiveTask' : 'restoreTask', key })
    this.emit()
  }

  /** Server-confirmed task data changed elsewhere (side peek, Board): reflect it without remounting editors. */
  updateTaskSnapshot(task: Task): void {
    for (const b of this.tree.blocks.values()) {
      if (b.taskId === task.id) this.tree.update(b.key, { task, title: this.debounces.has(b.key) ? b.title : task.title })
    }
    this.emit()
  }

  removeCompleted(): string[] {
    const keys = this.tree
      .flatten()
      .rows.filter((r) => r.block.task?.status === 'done')
      .map((r) => r.block.key)
    for (const k of keys) this.remove(k)
    return keys
  }

  turnIntoDescription(key: string, targetTaskId: string): void {
    const b = this.tree.get(key)
    if (!b.id) return this.notify('This task has not been saved yet')
    const id = b.id
    this.tree.removePromote(key)
    this.ensureCapture()
    const op = this.enqueue({ kind: 'turnInto', key, targetTaskId, request: null })
    op.request = { method: 'POST', path: `/pads/${enc(this.padId)}/blocks/${enc(id)}/turn-into-description`, body: { targetTaskId, mutationId: op.id } }
    this.emit()
  }

  // ---------- existing tasks and mentions ----------

  /** `@` on a Task line: place the task here, or insert a mention when it already has a Task block. */
  placeTask(key: string, candidate: PadTaskCandidate): void {
    const b = this.tree.get(key)
    if (candidate.placed) {
      this.tree.update(key, { type: 'text', title: '', content: [{ type: 'mention', taskId: candidate.task.id }], sync: 'pending', version: b.version + 1 })
      this.mentions = { ...this.mentions, [candidate.task.id]: { id: candidate.task.id, title: candidate.task.title, status: candidate.task.status, archivedAt: candidate.task.archivedAt } }
      this.createRemote(key)
      this.notify(`“${candidate.task.title}” already has a Task line${candidate.placement ? ` in ${candidate.placement.padName}` : ''}, so a mention was added instead`)
    } else {
      this.tree.update(key, { taskId: candidate.task.id, task: candidate.task, title: candidate.task.title, description: candidate.task.description, sync: 'pending', version: b.version + 1 })
      this.createRemote(key)
      this.pushUndo('Place task', () => this.remove(key, 'promote', true))
    }
    const next = this.insertAfter(key, 'task')
    this.requestFocus(next, 'title')
    this.emit()
  }

  addMentionInfo(task: Task): void {
    this.mentions = { ...this.mentions, [task.id]: { id: task.id, title: task.title, status: task.status, archivedAt: task.archivedAt } }
  }

  // ---------- paste ----------

  /** Multiline paste confirmed as tasks: one atomic, idempotent batch; Undo removes the whole batch. */
  pasteTasks(key: string, titles: string[]): void {
    const b = this.tree.get(key)
    const replaceDraft = b.type === 'task' && !b.id && !b.title.trim() && b.sync === 'draft'
    const parent = this.tree.parentOf(key)
    let after: string | null = replaceDraft ? this.tree.prevSibling(key) : key
    if (replaceDraft) this.tree.removePromote(key)
    const keys: string[] = []
    for (const title of titles) {
      const block = blankBlock('task', { title, sync: 'pending' })
      this.tree.insert(block, parent, after)
      after = block.key
      keys.push(block.key)
    }
    this.enqueue({ kind: 'bulk', key: keys[0], keys })
    this.pushUndo(`Paste ${keys.length} tasks`, () => this.undoCapture(keys))
    const next = this.ensureCapture()
    this.requestFocus(next, 'title')
    this.emit()
  }

  /** Multiline paste as plain text: one Text line per non-empty line. */
  pasteText(key: string, lines: string[]): void {
    const b = this.tree.get(key)
    const parent = this.tree.parentOf(key)
    let after: string | null = key
    const keys: string[] = []
    const reuse = !b.id && b.sync === 'draft' && !b.title.trim()
    lines.forEach((line, i) => {
      if (i === 0 && reuse) {
        this.tree.update(key, { type: 'text', content: line ? [{ type: 'text', text: line }] : [], sync: 'pending', version: b.version + 1 })
        this.createRemote(key)
        keys.push(key)
        return
      }
      const block = blankBlock('text', { content: line ? [{ type: 'text', text: line }] : [], sync: 'pending' })
      this.tree.insert(block, parent, after)
      after = block.key
      keys.push(block.key)
      this.enqueue({ kind: 'create', key: block.key })
    })
    this.pushUndo('Paste', () => keys.forEach((k) => this.remove(k, 'promote', true)))
    this.requestFocus(keys.at(-1)!, 'content')
    this.ensureCapture()
    this.emit()
  }

  dispose(): void {
    this.disposed = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    for (const d of this.debounces.values()) clearTimeout(d.timer)
  }

  static fromServerBlocks(padId: string, client: AliceClient, items: PadBlock[], mentions: MentionMap, opts: { archived?: boolean } = {}): PadModel {
    const model = new PadModel(padId, client, opts)
    model.tree = PadTree.fromServer(items)
    model.mentions = { ...mentions }
    model.ensureCapture()
    model.emit()
    return model
  }
}

