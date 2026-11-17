import type { Task } from '../../shared/contracts'
import { PAD_MAX_DEPTH, type PadBlock, type PadBlockType, type PadMentionInfo, type PadSegment } from '../../shared/pads'

// Local model of one open Pad. The server stays authoritative: every local change becomes an ordered
// intent in the outbox (see sync.ts), and a quiet editor rebuilds itself from server snapshots.

export const ROOT = ''

export type SyncState = 'synced' | 'pending' | 'failed' | 'draft'

export interface LocalBlock {
  /** Stable local key (the server id for blocks loaded from the server). */
  key: string
  /** Server id once the block exists on the server. */
  id: string | null
  type: PadBlockType
  content: PadSegment[]
  collapsed: boolean
  /** Authoritative task snapshot for Task blocks. */
  task: Task | null
  /** Task id for a Task block (known before the snapshot arrives when placing an existing task). */
  taskId: string | null
  /** Editable task title/description (Task blocks). */
  title: string
  description: string
  previousStatus: string | null
  sync: SyncState
  error: string | null
  /** Bumped whenever content changes from outside the editor so uncontrolled editors remount. */
  version: number
  /** Client mutation id of the last write the server applied to this block. */
  lastMutationId: string | null
}

export interface FlatRow {
  block: LocalBlock
  depth: number
  parentKey: string
  hasChildren: boolean
}

let counter = 0
export function localKey(): string {
  counter += 1
  return `local_${Date.now().toString(36)}_${counter}_${Math.random().toString(36).slice(2, 7)}`
}

export function newMutationId(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return `pm_${c.randomUUID()}`
  return `pm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

export function blankBlock(type: PadBlockType, partial: Partial<LocalBlock> = {}): LocalBlock {
  return {
    key: localKey(),
    id: null,
    type,
    content: [],
    collapsed: false,
    task: null,
    taskId: null,
    title: '',
    description: '',
    previousStatus: null,
    sync: type === 'task' ? 'draft' : 'pending',
    error: null,
    version: 0,
    lastMutationId: null,
    ...partial,
  }
}

export function fromServer(b: PadBlock, key = b.id): LocalBlock {
  return {
    key,
    id: b.id,
    type: b.type,
    content: b.content,
    collapsed: b.collapsed,
    task: b.task,
    taskId: b.task?.id ?? null,
    title: b.task?.title ?? '',
    description: b.task?.description ?? '',
    previousStatus: b.previousStatus,
    sync: 'synced',
    error: null,
    version: 0,
    lastMutationId: b.lastMutationId,
  }
}

export function sameContent(a: PadSegment[], b: PadSegment[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function plain(segments: PadSegment[]): string {
  return segments.map((s) => (s.type === 'text' ? s.text : '')).join('')
}

/** Inserts `key` after `afterKey` (null = first; an unknown anchor appends). */
function placeIn(list: string[], key: string, afterKey: string | null): void {
  if (afterKey === null) {
    list.unshift(key)
    return
  }
  const i = list.indexOf(afterKey)
  if (i < 0) list.push(key)
  else list.splice(i + 1, 0, key)
}

/** Tree of local blocks with ordered children; flattening gives document order with depth. */
export class PadTree {
  readonly blocks = new Map<string, LocalBlock>()
  readonly children = new Map<string, string[]>([[ROOT, []]])
  readonly parent = new Map<string, string>()

  clone(): PadTree {
    const t = new PadTree()
    for (const [k, v] of this.blocks) t.blocks.set(k, v)
    for (const [k, v] of this.children) t.children.set(k, [...v])
    for (const [k, v] of this.parent) t.parent.set(k, v)
    return t
  }

  kids(key: string): string[] {
    let list = this.children.get(key)
    if (!list) {
      list = []
      this.children.set(key, list)
    }
    return list
  }

  has(key: string): boolean {
    return this.blocks.has(key)
  }

  get(key: string): LocalBlock {
    const b = this.blocks.get(key)
    if (!b) throw new Error(`unknown block ${key}`)
    return b
  }

  set(block: LocalBlock): void {
    this.blocks.set(block.key, block)
  }

  update(key: string, patch: Partial<LocalBlock>): LocalBlock {
    const next = { ...this.get(key), ...patch }
    this.blocks.set(key, next)
    return next
  }

  /** Inserts after `afterKey` among `parentKey`'s children (null = first). */
  insert(block: LocalBlock, parentKey: string, afterKey: string | null): void {
    this.blocks.set(block.key, block)
    this.parent.set(block.key, parentKey)
    placeIn(this.kids(parentKey), block.key, afterKey)
  }

  detach(key: string): void {
    const p = this.parent.get(key) ?? ROOT
    const list = this.kids(p)
    const i = list.indexOf(key)
    if (i >= 0) list.splice(i, 1)
  }

  move(key: string, parentKey: string, afterKey: string | null): void {
    this.detach(key)
    this.parent.set(key, parentKey)
    placeIn(this.kids(parentKey), key, afterKey)
  }

  /** Removes the block and its subtree; returns removed keys (pre-order). */
  removeSubtree(key: string): string[] {
    const removed = this.subtree(key)
    this.detach(key)
    for (const k of removed) {
      this.blocks.delete(k)
      this.parent.delete(k)
      this.children.delete(k)
    }
    return removed
  }

  /** Removes one block, promoting its children into its place. */
  removePromote(key: string): string[] {
    const p = this.parentOf(key)
    const kids = [...this.kids(key)]
    const list = this.kids(p)
    const at = list.indexOf(key)
    list.splice(at, 1, ...kids)
    for (const k of kids) this.parent.set(k, p)
    this.blocks.delete(key)
    this.parent.delete(key)
    this.children.delete(key)
    return kids
  }

  parentOf(key: string): string {
    return this.parent.get(key) ?? ROOT
  }

  siblingsOf(key: string): string[] {
    return this.kids(this.parentOf(key))
  }

  prevSibling(key: string): string | null {
    const list = this.siblingsOf(key)
    const i = list.indexOf(key)
    return i > 0 ? list[i - 1] : null
  }

  nextSibling(key: string): string | null {
    const list = this.siblingsOf(key)
    const i = list.indexOf(key)
    return i >= 0 && i < list.length - 1 ? list[i + 1] : null
  }

  depth(key: string): number {
    let d = 0
    let k: string = key
    while (k !== ROOT) {
      d++
      k = this.parentOf(k)
      if (d > 64) break
    }
    return d
  }

  height(key: string): number {
    const kids = this.kids(key)
    return 1 + (kids.length ? Math.max(...kids.map((k) => this.height(k))) : 0)
  }

  subtree(key: string): string[] {
    const out = [key]
    for (const k of this.kids(key)) out.push(...this.subtree(k))
    return out
  }

  isAncestor(ancestor: string, key: string): boolean {
    let k = this.parentOf(key)
    while (k !== ROOT) {
      if (k === ancestor) return true
      k = this.parentOf(k)
    }
    return false
  }

  /** Can `key` (with its subtree) be placed under `parentKey`? Mirrors the server rules. */
  canPlace(key: string, parentKey: string): string | null {
    if (parentKey === ROOT) return null
    if (parentKey === key || this.isAncestor(key, parentKey)) return 'A block cannot move inside itself'
    if (this.get(parentKey).type === 'task') return 'Nothing can be nested under a Task. Use a Heading or Text line to group tasks.'
    if (this.depth(parentKey) + this.height(key) > PAD_MAX_DEPTH) return `Pads allow at most ${PAD_MAX_DEPTH} levels`
    return null
  }

  flatten(expanded: Set<string> = new Set()): { rows: FlatRow[]; visible: FlatRow[] } {
    const rows: FlatRow[] = []
    const visible: FlatRow[] = []
    const walk = (parentKey: string, depth: number, hidden: boolean) => {
      for (const key of this.kids(parentKey)) {
        const block = this.blocks.get(key)
        if (!block) continue
        const kids = this.kids(key)
        const row = { block, depth, parentKey, hasChildren: kids.length > 0 }
        rows.push(row)
        if (!hidden) visible.push(row)
        walk(key, depth + 1, hidden || (block.type === 'heading' && block.collapsed && !expanded.has(key)))
      }
    }
    walk(ROOT, 1, false)
    return { rows, visible }
  }

  static fromServer(items: PadBlock[], keyFor: (id: string) => string = (id) => id): PadTree {
    const tree = new PadTree()
    for (const b of items) {
      const key = keyFor(b.id)
      const parentKey = b.parentId ? keyFor(b.parentId) : ROOT
      tree.blocks.set(key, fromServer(b, key))
      tree.parent.set(key, parentKey)
      tree.kids(parentKey).push(key)
    }
    return tree
  }
}

export type MentionMap = Record<string, PadMentionInfo>
