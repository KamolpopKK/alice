import { createHash } from 'node:crypto'
import type * as z from 'zod'
import { HIGHLIGHT_END, HIGHLIGHT_START, type Page, type TaskStatus } from '../../shared/contracts'
import { AliceError } from '../../shared/errors'
import {
  PAD_BLOCK_TEXT_MAX,
  PAD_MAX_DEPTH,
  type Pad,
  type PadBlock,
  type PadBlockPage,
  type PadBlockResult,
  type PadBlockType,
  type PadExport,
  type PadMentionInfo,
  type PadSearchResult,
  type PadSegment,
  type convertPadBlockInput,
  type createPadBlockInput,
  type createPadInput,
  type deletePadBlockInput,
  type listPadsInput,
  type movePadBlockInput,
  type padSearchInput,
  type updatePadBlockInput,
  type updatePadInput,
} from '../../shared/pads'
import type { AppContext } from '../context'
import type { DB } from '../db/database'
import { newId } from '../ids'
import { mutate, type Mutation } from './activity'
import { requireActiveActor, type Actor } from './actors'
import { findProjectRow } from './projects'
import { compileQuery } from './search'
import { actorCols, actorRefFrom, decodeCursor, encodeCursor } from './sql'
import { MAX_KEY_LENGTH, evenKeys, keyBetween, keysBetween } from './order-keys'

// ---------- Rows and mapping ----------

const PAD_SELECT = `SELECT pd.*, dp.name AS default_project_name, dp.system_key AS default_project_system_key, dp.archived_at AS default_project_archived_at,
    ${actorCols('da', 'default_assignee')},
    (SELECT count(*) FROM pad_blocks b WHERE b.pad_id = pd.id) AS block_count
  FROM pads pd
  LEFT JOIN projects dp ON dp.id = pd.default_project_id
  LEFT JOIN actors da ON da.id = pd.default_assignee_id`

interface PadRow {
  id: string
  workspace_id: string
  owner_id: string
  name: string
  default_project_id: string | null
  default_status: TaskStatus | null
  default_assignee_id: string | null
  pinned_at: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
  default_project_name: string | null
  default_project_system_key: string | null
  default_project_archived_at: string | null
  block_count: number
  [key: string]: unknown
}

export interface BlockRow {
  id: string
  pad_id: string
  type: PadBlockType
  parent_id: string | null
  order_key: string
  content: string
  task_id: string | null
  collapsed: number
  previous_status: TaskStatus | null
  revision: number
  last_mutation_id: string | null
  created_at: string
  updated_at: string
}

function toPad(row: PadRow): Pad {
  return {
    id: row.id,
    name: row.name,
    pinned: row.pinned_at !== null,
    pinnedAt: row.pinned_at,
    archivedAt: row.archived_at,
    defaults: {
      project: row.default_project_id
        ? { id: row.default_project_id, name: row.default_project_name!, isSystem: row.default_project_system_key !== null, archivedAt: row.default_project_archived_at }
        : null,
      status: row.default_status,
      assignee: actorRefFrom(row, 'default_assignee'),
    },
    blockCount: row.block_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Decorates Task blocks with authoritative task data; installed by the task integration. */
export const PAD_TASK_LOADER: { load: ((db: DB, workspaceId: string, taskIds: string[]) => Map<string, PadBlock['task']>) | null } = { load: null }

function toBlocks(db: DB, workspaceId: string, rows: Array<BlockRow & { depth: number }>): PadBlock[] {
  const taskIds = rows.map((r) => r.task_id).filter((id): id is string => id !== null)
  const tasks = taskIds.length && PAD_TASK_LOADER.load ? PAD_TASK_LOADER.load(db, workspaceId, taskIds) : new Map<string, PadBlock['task']>()
  return rows.map((r) => ({
    id: r.id,
    padId: r.pad_id,
    type: r.type,
    parentId: r.parent_id,
    depth: r.depth,
    content: JSON.parse(r.content) as PadSegment[],
    collapsed: r.collapsed === 1,
    task: r.task_id ? (tasks.get(r.task_id) ?? null) : null,
    previousStatus: r.previous_status,
    revision: r.revision,
    lastMutationId: r.last_mutation_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
}

/** Current title/status of every task mentioned in `blocks`. */
export function mentionsFor(db: DB, workspaceId: string, blocks: Array<Pick<PadBlock, 'content'>>): Record<string, PadMentionInfo> {
  const ids = new Set<string>()
  for (const b of blocks) for (const s of b.content) if (s.type === 'mention') ids.add(s.taskId)
  const out: Record<string, PadMentionInfo> = {}
  if (ids.size === 0) return out
  const list = [...ids]
  const rows = db
    .prepare(`SELECT id, title, status, archived_at FROM tasks WHERE workspace_id = ? AND id IN (${list.map(() => '?').join(',')})`)
    .all(workspaceId, ...list) as Array<{ id: string; title: string; status: TaskStatus; archived_at: string | null }>
  for (const r of rows) out[r.id] = { id: r.id, title: r.title, status: r.status, archivedAt: r.archived_at }
  return out
}

// ---------- Ownership ----------

/** Pads belong to humans only. Agents never reach these routes, but the domain refuses them too. */
export function requireHuman(actor: Actor): void {
  if (actor.kind !== 'human') throw new AliceError('FORBIDDEN', 'Task Pads are available to human accounts only')
}

function findPadRow(db: DB, actor: Actor, id: string): PadRow | undefined {
  return db.prepare(`${PAD_SELECT} WHERE pd.id = ? AND pd.workspace_id = ? AND pd.owner_id = ?`).get(id, actor.workspaceId, actor.id) as PadRow | undefined
}

/** Another human's Pad behaves exactly like an unknown id. */
export function requirePadRow(db: DB, actor: Actor, id: string): PadRow {
  requireHuman(actor)
  const row = findPadRow(db, actor, id)
  if (!row) throw new AliceError('NOT_FOUND', 'Pad not found')
  return row
}

export function requireBlockRow(db: DB, padId: string, id: string): BlockRow {
  const row = db.prepare('SELECT * FROM pad_blocks WHERE id = ? AND pad_id = ?').get(id, padId) as BlockRow | undefined
  if (!row) throw new AliceError('NOT_FOUND', 'Block not found')
  return row
}

export function blockDepth(db: DB, id: string): number {
  const row = db
    .prepare(
      `WITH RECURSIVE up(id, parent_id, depth) AS (
         SELECT id, parent_id, 1 FROM pad_blocks WHERE id = ?
         UNION ALL SELECT b.id, b.parent_id, up.depth + 1 FROM pad_blocks b JOIN up ON b.id = up.parent_id WHERE up.depth < 64
       ) SELECT max(depth) AS depth FROM up`,
    )
    .get(id) as { depth: number | null }
  return row.depth ?? 0
}

/** Ancestors from the top level down to the direct parent. */
function ancestorIds(db: DB, id: string): string[] {
  const rows = db
    .prepare(
      `WITH RECURSIVE up(id, parent_id, depth) AS (
         SELECT id, parent_id, 0 FROM pad_blocks WHERE id = ?
         UNION ALL SELECT b.id, b.parent_id, up.depth + 1 FROM pad_blocks b JOIN up ON b.id = up.parent_id WHERE up.depth < 64
       ) SELECT id FROM up WHERE depth > 0 ORDER BY depth DESC`,
    )
    .all(id) as Array<{ id: string }>
  return rows.map((r) => r.id)
}

/** Ids of `id` and every block nested inside it. */
export function subtreeIds(db: DB, id: string): string[] {
  return (
    db
      .prepare(
        `WITH RECURSIVE down(id, depth) AS (
           SELECT id, 1 FROM pad_blocks WHERE id = ?
           UNION ALL SELECT b.id, down.depth + 1 FROM pad_blocks b JOIN down ON b.parent_id = down.id WHERE down.depth < 64
         ) SELECT id FROM down`,
      )
      .all(id) as Array<{ id: string }>
  ).map((r) => r.id)
}

/** Levels in the subtree rooted at `id` (1 for a leaf). */
function subtreeHeight(db: DB, id: string): number {
  const row = db
    .prepare(
      `WITH RECURSIVE down(id, depth) AS (
         SELECT id, 1 FROM pad_blocks WHERE id = ?
         UNION ALL SELECT b.id, down.depth + 1 FROM pad_blocks b JOIN down ON b.parent_id = down.id WHERE down.depth < 64
       ) SELECT max(depth) AS h FROM down`,
    )
    .get(id) as { h: number | null }
  return row.h ?? 1
}

// ---------- Hierarchy and ordering ----------

/**
 * Validates placing a block (of `type`, with a subtree `height` levels tall) under `parentId`.
 * Rules: the parent is in the same Pad, is not a Task (Task blocks are leaves, so a Task can never
 * sit under a Task), no cycles, and nothing ends up deeper than PAD_MAX_DEPTH.
 */
export function assertPlacement(db: DB, padId: string, parentId: string | null, opts: { blockId?: string; height?: number } = {}): void {
  if (!parentId) {
    if ((opts.height ?? 1) > PAD_MAX_DEPTH) throw new AliceError('INVALID_RELATIONSHIP', `Pads allow at most ${PAD_MAX_DEPTH} levels`)
    return
  }
  const parent = requireBlockRow(db, padId, parentId)
  if (parent.type === 'task') {
    throw new AliceError('INVALID_RELATIONSHIP', 'Blocks cannot be nested under a Task block; use a Heading to group tasks, or Turn into description')
  }
  if (opts.blockId && (parentId === opts.blockId || subtreeIds(db, opts.blockId).includes(parentId))) {
    throw new AliceError('RELATIONSHIP_CYCLE', 'A block cannot be moved inside itself')
  }
  if (blockDepth(db, parentId) + (opts.height ?? 1) > PAD_MAX_DEPTH) {
    throw new AliceError('INVALID_RELATIONSHIP', `Pads allow at most ${PAD_MAX_DEPTH} levels`)
  }
}

function siblingRows(db: DB, padId: string, parentId: string | null, excludeId: string | null): Array<{ id: string; order_key: string }> {
  return db
    .prepare('SELECT id, order_key FROM pad_blocks WHERE pad_id = ? AND parent_id IS ? AND id IS NOT ? ORDER BY order_key, id')
    .all(padId, parentId, excludeId) as Array<{ id: string; order_key: string }>
}

/** Rewrites a sibling list with short, evenly spaced keys (invisible to clients: order is unchanged). */
function rebalance(db: DB, padId: string, parentId: string | null, excludeId: string | null): void {
  const rows = siblingRows(db, padId, parentId, excludeId)
  const keys = evenKeys(rows.length)
  const update = db.prepare('UPDATE pad_blocks SET order_key = ? WHERE id = ?')
  rows.forEach((r, i) => update.run(keys[i], r.id))
}

/** Gap where new blocks go: after `afterId` (or first) among `parentId`'s children. */
function gapFor(db: DB, padId: string, parentId: string | null, afterId: string | null, excludeId: string | null): { prev: string | null; next: string | null } {
  let prev: string | null = null
  if (afterId) {
    if (afterId === excludeId) throw new AliceError('VALIDATION_ERROR', 'A block cannot be placed after itself')
    const after = requireBlockRow(db, padId, afterId)
    if ((after.parent_id ?? null) !== (parentId ?? null)) throw new AliceError('VALIDATION_ERROR', 'afterId must be a sibling under the chosen parent')
    prev = after.order_key
  }
  const nextRow = db
    .prepare(`SELECT order_key FROM pad_blocks WHERE pad_id = ? AND parent_id IS ? AND id IS NOT ? ${prev === null ? '' : 'AND order_key > ?'} ORDER BY order_key LIMIT 1`)
    .get(...([padId, parentId, excludeId, ...(prev === null ? [] : [prev])] as unknown[])) as { order_key: string } | undefined
  return { prev, next: nextRow?.order_key ?? null }
}

/** `count` order keys for new or moved blocks, rebalancing the sibling list when keys grow long. */
export function placeKeys(db: DB, padId: string, parentId: string | null, afterId: string | null, count: number, excludeId: string | null = null): string[] {
  let gap = gapFor(db, padId, parentId, afterId, excludeId)
  // ช่องว่างที่ key เท่ากัน (ข้อมูลเก่าหรือ promote) ต้อง rebalance ก่อน
  if (gap.prev !== null && gap.next !== null && gap.prev >= gap.next) {
    rebalance(db, padId, parentId, excludeId)
    gap = gapFor(db, padId, parentId, afterId, excludeId)
  }
  let keys = keysBetween(gap.prev, gap.next, count)
  if (keys.some((k) => k.length > MAX_KEY_LENGTH)) {
    rebalance(db, padId, parentId, excludeId)
    gap = gapFor(db, padId, parentId, afterId, excludeId)
    keys = keysBetween(gap.prev, gap.next, count)
  }
  return keys
}

// ---------- Content ----------

// ตัวควบคุมที่ไม่ใช่ขึ้นบรรทัด/แท็บ ถูกตัดทิ้ง; Heading เป็นบรรทัดเดียว
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

export function normalizeContent(db: DB, workspaceId: string, type: PadBlockType, segments: PadSegment[] | undefined): PadSegment[] {
  if (type === 'task') return []
  const out: PadSegment[] = []
  let length = 0
  for (const s of segments ?? []) {
    if (s.type === 'mention') {
      const task = db.prepare('SELECT id FROM tasks WHERE id = ? AND workspace_id = ?').get(s.taskId, workspaceId)
      if (!task) throw new AliceError('NOT_FOUND', `Task ${s.taskId} not found`)
      out.push({ type: 'mention', taskId: s.taskId })
      continue
    }
    let text = s.text.replace(/\r\n?/g, '\n').replace(CONTROL, '')
    if (type === 'heading') text = text.replace(/[\n\t]+/g, ' ')
    if (!text) continue
    length += text.length
    const last = out[out.length - 1]
    if (last?.type === 'text') last.text += text
    else out.push({ type: 'text', text })
  }
  if (length > PAD_BLOCK_TEXT_MAX) throw new AliceError('VALIDATION_ERROR', `Block text is limited to ${PAD_BLOCK_TEXT_MAX} characters`)
  return out
}

export function plainText(segments: PadSegment[]): string {
  return segments.map((s) => (s.type === 'text' ? s.text : '')).join('')
}

// ---------- Private search index ----------

function upsertPadSearch(db: DB, ownerId: string, padId: string, blockId: string | null, body: string): void {
  const existing = db.prepare('SELECT rowid FROM pad_search_docs WHERE pad_id = ? AND block_id IS ?').get(padId, blockId) as { rowid: number } | undefined
  let rowid: number
  if (existing) {
    rowid = existing.rowid
    db.prepare('DELETE FROM pad_search_index WHERE rowid = ?').run(rowid)
  } else {
    rowid = Number(db.prepare('INSERT INTO pad_search_docs (owner_id, pad_id, block_id) VALUES (?, ?, ?)').run(ownerId, padId, blockId).lastInsertRowid)
  }
  db.prepare('INSERT INTO pad_search_index (rowid, body) VALUES (?, ?)').run(rowid, body)
}

export function removePadSearch(db: DB, blockIds: string[]): void {
  for (const id of blockIds) {
    const row = db.prepare('SELECT rowid FROM pad_search_docs WHERE block_id = ?').get(id) as { rowid: number } | undefined
    if (!row) continue
    db.prepare('DELETE FROM pad_search_index WHERE rowid = ?').run(row.rowid)
    db.prepare('DELETE FROM pad_search_docs WHERE rowid = ?').run(row.rowid)
  }
}

/** Re-indexes one block: Text/Heading by their plain text, Task blocks by the task title. */
export function indexBlock(db: DB, ownerId: string, block: BlockRow): void {
  if (block.type === 'task') {
    const task = db.prepare('SELECT title FROM tasks WHERE id = ?').get(block.task_id) as { title: string } | undefined
    upsertPadSearch(db, ownerId, block.pad_id, block.id, task?.title ?? '')
  } else {
    upsertPadSearch(db, ownerId, block.pad_id, block.id, plainText(JSON.parse(block.content) as PadSegment[]))
  }
}

// ---------- Mutations ----------

/** Shared helpers for one Pad mutation: private invalidations and recency. */
export class PadWrite {
  constructor(
    readonly m: Mutation,
    readonly actor: Actor,
    readonly origin: string | null,
  ) {}
  get db(): DB {
    return this.m.db
  }
  get now(): string {
    return this.m.now
  }
  pad(padId: string, verb: string, touch = true): void {
    if (touch) this.db.prepare('UPDATE pads SET updated_at = ? WHERE id = ?').run(this.now, padId)
    this.m.invalidatePrivate({ type: 'pad', id: padId }, this.actor.id, verb, this.origin)
  }
  block(padId: string, blockId: string, verb: string): void {
    this.m.invalidatePrivate({ type: 'pad_block', id: blockId }, this.actor.id, verb, this.origin)
    this.pad(padId, verb)
  }
  getBlock(padId: string, id: string): BlockRow {
    return requireBlockRow(this.db, padId, id)
  }
  /** Marks a block written by this mutation (revision and origin for last-write-wins). */
  stamp(id: string): void {
    this.db.prepare('UPDATE pad_blocks SET revision = revision + 1, last_mutation_id = ?, updated_at = ? WHERE id = ?').run(this.origin, this.now, id)
  }
}

function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/**
 * Runs a Pad mutation in one transaction. With a `mutationId`, the first accepted result is stored
 * and an identical retry returns it unchanged, so replaying an outbox can never duplicate work.
 */
export function padMutation<T>(ctx: AppContext, actor: Actor, mutationId: string | undefined, request: unknown, fn: (w: PadWrite) => T): T {
  requireHuman(actor)
  const hash = mutationId ? requestHash(request) : ''
  if (mutationId) {
    const prior = ctx.db.prepare('SELECT request_hash, response FROM pad_mutations WHERE owner_id = ? AND mutation_id = ?').get(actor.id, mutationId) as
      | { request_hash: string; response: string }
      | undefined
    if (prior) {
      if (prior.request_hash !== hash) throw new AliceError('IDEMPOTENCY_CONFLICT', 'This mutationId was already used for a different change')
      return JSON.parse(prior.response) as T
    }
  }
  return mutate(ctx, actor, (m) => {
    const result = fn(new PadWrite(m, actor, mutationId ?? null))
    if (mutationId) {
      m.db.prepare('INSERT INTO pad_mutations (owner_id, mutation_id, request_hash, response, created_at) VALUES (?, ?, ?, ?, ?)').run(actor.id, mutationId, hash, JSON.stringify(result), m.now)
    }
    return result
  }).value
}

export function prunePadMutations(ctx: AppContext, before: string): void {
  ctx.db.prepare('DELETE FROM pad_mutations WHERE created_at < ?').run(before)
}

// ---------- Pads ----------

function readPad(db: DB, actor: Actor, id: string): Pad {
  return toPad(requirePadRow(db, actor, id))
}

export function getPad(ctx: AppContext, actor: Actor, id: string): Pad {
  return readPad(ctx.db, actor, id)
}

type PadDefaultsPatch = Pick<z.infer<typeof updatePadInput>, 'defaultProjectId' | 'defaultStatus' | 'defaultAssigneeId'>

/** Defaults are validated when set; task creation re-validates them (a project may be archived later). */
function validateDefaults(db: DB, workspaceId: string, patch: PadDefaultsPatch): void {
  if (patch.defaultProjectId) {
    const project = findProjectRow(db, workspaceId, patch.defaultProjectId)
    if (!project) throw new AliceError('NOT_FOUND', `Project ${patch.defaultProjectId} not found`)
    if (project.archived_at) throw new AliceError('INVALID_STATE', `Project ${patch.defaultProjectId} is archived; choose an active project`)
  }
  if (patch.defaultAssigneeId) requireActiveActor(db, workspaceId, patch.defaultAssigneeId)
}

export function createPad(ctx: AppContext, actor: Actor, input: z.infer<typeof createPadInput>): { pad: Pad } {
  return padMutation(ctx, actor, input.mutationId, ['pad.create', input], (w) => {
    validateDefaults(w.db, actor.workspaceId, input)
    const id = newId('pad')
    w.db
      .prepare(
        `INSERT INTO pads (id, workspace_id, owner_id, name, default_project_id, default_status, default_assignee_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, actor.workspaceId, actor.id, input.name, input.defaultProjectId ?? null, input.defaultStatus ?? null, input.defaultAssigneeId ?? null, w.now, w.now)
    upsertPadSearch(w.db, actor.id, id, null, input.name)
    w.pad(id, 'pad.created')
    return { pad: readPad(w.db, actor, id) }
  })
}

export function updatePad(ctx: AppContext, actor: Actor, id: string, patch: z.infer<typeof updatePadInput>): { pad: Pad } {
  return padMutation(ctx, actor, patch.mutationId, ['pad.update', id, patch], (w) => {
    const row = requirePadRow(w.db, actor, id)
    validateDefaults(w.db, actor.workspaceId, patch)
    const sets: string[] = []
    const params: unknown[] = []
    const set = (column: string, value: unknown) => {
      sets.push(`${column} = ?`)
      params.push(value)
    }
    if (patch.name !== undefined && patch.name !== row.name) {
      set('name', patch.name)
      upsertPadSearch(w.db, actor.id, id, null, patch.name)
    }
    if (patch.pinned !== undefined && patch.pinned !== (row.pinned_at !== null)) set('pinned_at', patch.pinned ? w.now : null)
    if (patch.defaultProjectId !== undefined) set('default_project_id', patch.defaultProjectId)
    if (patch.defaultStatus !== undefined) set('default_status', patch.defaultStatus)
    if (patch.defaultAssigneeId !== undefined) set('default_assignee_id', patch.defaultAssigneeId)
    if (sets.length) {
      w.db.prepare(`UPDATE pads SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
      // pin เป็นสถานะส่วนตัว ไม่ทำให้ Pad ขึ้นไปเป็น "ล่าสุด"
      const onlyPin = patch.name === undefined && patch.defaultProjectId === undefined && patch.defaultStatus === undefined && patch.defaultAssigneeId === undefined
      w.pad(id, 'pad.updated', !onlyPin)
    }
    return { pad: readPad(w.db, actor, id) }
  })
}

export function setPadArchived(ctx: AppContext, actor: Actor, id: string, archived: boolean): { pad: Pad } {
  return padMutation(ctx, actor, undefined, null, (w) => {
    const row = requirePadRow(w.db, actor, id)
    if (archived !== (row.archived_at !== null)) {
      w.db.prepare('UPDATE pads SET archived_at = ? WHERE id = ?').run(archived ? w.now : null, id)
      w.pad(id, archived ? 'pad.archived' : 'pad.restored', false)
    }
    return { pad: readPad(w.db, actor, id) }
  })
}

/** Permanently removes the Pad and its private blocks. Referenced tasks are never touched. */
export function deletePad(ctx: AppContext, actor: Actor, id: string): { deleted: true; id: string } {
  return padMutation(ctx, actor, undefined, null, (w) => {
    requirePadRow(w.db, actor, id)
    const docs = w.db.prepare('SELECT rowid FROM pad_search_docs WHERE pad_id = ?').all(id) as Array<{ rowid: number }>
    for (const d of docs) w.db.prepare('DELETE FROM pad_search_index WHERE rowid = ?').run(d.rowid)
    w.db.prepare('DELETE FROM pad_search_docs WHERE pad_id = ?').run(id)
    w.db.prepare('DELETE FROM pad_blocks WHERE pad_id = ?').run(id)
    w.db.prepare('DELETE FROM pads WHERE id = ?').run(id)
    w.pad(id, 'pad.deleted', false)
    return { deleted: true as const, id }
  })
}

/** Pinned first, then most recently updated. Archived listings are newest-archived first. */
export function listPads(ctx: AppContext, actor: Actor, input: z.infer<typeof listPadsInput>): Page<Pad> {
  requireHuman(actor)
  const limit = input.limit ?? 50
  const where = ['pd.workspace_id = ?', 'pd.owner_id = ?']
  const params: unknown[] = [actor.workspaceId, actor.id]
  if (input.archived === 'active') where.push('pd.archived_at IS NULL')
  else if (input.archived === 'archived') where.push('pd.archived_at IS NOT NULL')
  const pinnedExpr = input.archived === 'archived' ? '0' : '(pd.pinned_at IS NOT NULL)'
  const timeExpr = input.archived === 'archived' ? 'pd.archived_at' : 'pd.updated_at'
  const cursor = decodeCursor(input.cursor)
  if (cursor && cursor.length === 3) {
    where.push(`(${pinnedExpr}, ${timeExpr}, pd.id) < (?, ?, ?)`)
    params.push(...cursor)
  }
  const rows = ctx.db
    .prepare(`${PAD_SELECT.replace('SELECT pd.*,', `SELECT pd.*, ${pinnedExpr} AS sort_pinned, ${timeExpr} AS sort_time,`)} WHERE ${where.join(' AND ')}
      ORDER BY sort_pinned DESC, sort_time DESC, pd.id DESC LIMIT ?`)
    .all(...params, limit + 1) as Array<PadRow & { sort_pinned: number; sort_time: string }>
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return { items: page.map(toPad), nextCursor: rows.length > limit ? encodeCursor([last.sort_pinned, last.sort_time, last.id]) : null }
}

// ---------- Blocks ----------

/** Document order (depth-first) over the sibling-ordered tree; paths compare byte-wise. */
const TREE = `WITH RECURSIVE tree(id, path, depth) AS (
    SELECT id, order_key, 1 FROM pad_blocks WHERE pad_id = ? AND parent_id IS NULL
    UNION ALL
    SELECT b.id, tree.path || ' ' || b.order_key, tree.depth + 1 FROM pad_blocks b JOIN tree ON b.parent_id = tree.id WHERE tree.depth < 64
  )`

export function listBlocks(ctx: AppContext, actor: Actor, padId: string, input: { cursor?: string | null; limit?: number }): PadBlockPage {
  requirePadRow(ctx.db, actor, padId)
  const limit = input.limit ?? 200
  const cursor = decodeCursor(input.cursor)
  const after = cursor && typeof cursor[0] === 'string' ? cursor[0] : null
  const rows = ctx.db
    .prepare(`${TREE} SELECT b.*, tree.path, tree.depth FROM tree JOIN pad_blocks b ON b.id = tree.id ${after === null ? '' : 'WHERE tree.path > ?'} ORDER BY tree.path LIMIT ?`)
    .all(...([padId, ...(after === null ? [] : [after]), limit + 1] as unknown[])) as Array<BlockRow & { path: string; depth: number }>
  const page = rows.slice(0, limit)
  const items = toBlocks(ctx.db, actor.workspaceId, page)
  return { items, mentions: mentionsFor(ctx.db, actor.workspaceId, items), nextCursor: rows.length > limit ? encodeCursor([page[page.length - 1].path]) : null }
}

export function readBlock(db: DB, workspaceId: string, padId: string, id: string): PadBlock {
  const row = requireBlockRow(db, padId, id)
  return toBlocks(db, workspaceId, [{ ...row, depth: blockDepth(db, id) }])[0]
}

export function blockResult(db: DB, workspaceId: string, padId: string, id: string, affected?: string[]): PadBlockResult {
  const block = readBlock(db, workspaceId, padId, id)
  return { block, ...(affected && affected.length ? { affected } : {}), mentions: mentionsFor(db, workspaceId, [block]) }
}

/** Inserts a block row at a validated position. Task-specific fields come from the task integration. */
export function insertBlock(
  w: PadWrite,
  padId: string,
  input: { type: PadBlockType; parentId: string | null; afterId: string | null; content: PadSegment[]; taskId?: string | null; orderKey?: string },
): string {
  assertPlacement(w.db, padId, input.parentId)
  const id = newId('blk')
  const key = input.orderKey ?? placeKeys(w.db, padId, input.parentId, input.afterId, 1)[0]
  w.db
    .prepare(
      `INSERT INTO pad_blocks (id, pad_id, type, parent_id, order_key, content, task_id, last_mutation_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, padId, input.type, input.parentId, key, JSON.stringify(input.content), input.taskId ?? null, w.origin, w.now, w.now)
  indexBlock(w.db, w.actor.id, w.getBlock(padId, id))
  w.block(padId, id, 'pad.block.created')
  return id
}

/** Task-block creation hook, installed by the task integration. */
export const PAD_TASK_BLOCKS: {
  create: ((w: PadWrite, pad: PadRow, input: z.infer<typeof createPadBlockInput>, parentId: string | null, afterId: string | null) => string) | null
} = { create: null }

export function createBlock(ctx: AppContext, actor: Actor, padId: string, input: z.infer<typeof createPadBlockInput>): PadBlockResult {
  return padMutation(ctx, actor, input.mutationId, ['block.create', padId, input], (w) => {
    const pad = requirePadRow(w.db, actor, padId)
    if (pad.archived_at) throw new AliceError('INVALID_STATE', 'This Pad is archived; restore it before editing')
    const parentId = input.parentId ?? null
    const afterId = input.afterId ?? null
    let id: string
    if (input.type === 'task') {
      if (!PAD_TASK_BLOCKS.create) throw new AliceError('VALIDATION_ERROR', 'Task blocks are not supported')
      id = PAD_TASK_BLOCKS.create(w, pad, input, parentId, afterId)
    } else {
      if (input.title !== undefined || input.taskId !== undefined) throw new AliceError('VALIDATION_ERROR', 'title and taskId apply only to Task blocks')
      id = insertBlock(w, padId, { type: input.type, parentId, afterId, content: normalizeContent(w.db, actor.workspaceId, input.type, input.content) })
    }
    return blockResult(w.db, actor.workspaceId, padId, id)
  })
}

/** Task title/description edits, installed by the task integration. */
export const PAD_TASK_EDITS: { apply: ((w: PadWrite, block: BlockRow, patch: { title?: string; description?: string }) => void) | null } = { apply: null }

export function updateBlock(ctx: AppContext, actor: Actor, padId: string, id: string, patch: z.infer<typeof updatePadBlockInput>): PadBlockResult {
  return padMutation(ctx, actor, patch.mutationId, ['block.update', padId, id, patch], (w) => {
    const pad = requirePadRow(w.db, actor, padId)
    const block = w.getBlock(padId, id)
    // collapse เป็นสถานะส่วนตัว ทำได้แม้ Pad ถูก archive
    const onlyCollapse = patch.content === undefined && patch.title === undefined && patch.description === undefined
    if (pad.archived_at && !onlyCollapse) throw new AliceError('INVALID_STATE', 'This Pad is archived; restore it before editing')
    if (patch.collapsed !== undefined) {
      if (block.type !== 'heading') throw new AliceError('VALIDATION_ERROR', 'Only Heading sections can be collapsed')
      w.db.prepare('UPDATE pad_blocks SET collapsed = ? WHERE id = ?').run(patch.collapsed ? 1 : 0, id)
    }
    if (patch.content !== undefined) {
      if (block.type === 'task') throw new AliceError('VALIDATION_ERROR', 'Task blocks take a title and description, not content')
      w.db.prepare('UPDATE pad_blocks SET content = ? WHERE id = ?').run(JSON.stringify(normalizeContent(w.db, actor.workspaceId, block.type, patch.content)), id)
      indexBlock(w.db, actor.id, w.getBlock(padId, id))
    }
    if (patch.title !== undefined || patch.description !== undefined) {
      if (block.type !== 'task' || !PAD_TASK_EDITS.apply) throw new AliceError('VALIDATION_ERROR', 'title and description apply only to Task blocks')
      PAD_TASK_EDITS.apply(w, block, { title: patch.title, description: patch.description })
    }
    w.stamp(id)
    if (onlyCollapse) w.m.invalidatePrivate({ type: 'pad_block', id }, actor.id, 'pad.block.updated', w.origin)
    else w.block(padId, id, 'pad.block.updated')
    return blockResult(w.db, actor.workspaceId, padId, id)
  })
}

export function moveBlock(ctx: AppContext, actor: Actor, padId: string, id: string, input: z.infer<typeof movePadBlockInput>): PadBlockResult {
  return padMutation(ctx, actor, input.mutationId, ['block.move', padId, id, input], (w) => {
    const pad = requirePadRow(w.db, actor, padId)
    if (pad.archived_at) throw new AliceError('INVALID_STATE', 'This Pad is archived; restore it before editing')
    w.getBlock(padId, id)
    const parentId = input.parentId ?? null
    // ย้าย block = ย้ายทั้ง subtree (children ติดไปกับ parent)
    assertPlacement(w.db, padId, parentId, { blockId: id, height: subtreeHeight(w.db, id) })
    const [key] = placeKeys(w.db, padId, parentId, input.afterId ?? null, 1, id)
    w.db.prepare('UPDATE pad_blocks SET parent_id = ?, order_key = ? WHERE id = ?').run(parentId, key, id)
    w.stamp(id)
    w.block(padId, id, 'pad.block.moved')
    return blockResult(w.db, actor.workspaceId, padId, id, subtreeIds(w.db, id).slice(1))
  })
}

/** Task conversions, installed by the task integration. */
export const PAD_TASK_CONVERSIONS: { convert: ((w: PadWrite, pad: PadRow, block: BlockRow, to: PadBlockType) => void) | null } = { convert: null }

export function convertBlock(ctx: AppContext, actor: Actor, padId: string, id: string, input: z.infer<typeof convertPadBlockInput>): PadBlockResult {
  return padMutation(ctx, actor, input.mutationId, ['block.convert', padId, id, input], (w) => {
    const pad = requirePadRow(w.db, actor, padId)
    if (pad.archived_at) throw new AliceError('INVALID_STATE', 'This Pad is archived; restore it before editing')
    const block = w.getBlock(padId, id)
    if (block.type !== input.type) {
      if (block.type === 'task' || input.type === 'task') {
        if (!PAD_TASK_CONVERSIONS.convert) throw new AliceError('VALIDATION_ERROR', 'Task conversion is not supported')
        PAD_TASK_CONVERSIONS.convert(w, pad, block, input.type)
      } else {
        const content = normalizeContent(w.db, actor.workspaceId, input.type, JSON.parse(block.content) as PadSegment[])
        w.db.prepare('UPDATE pad_blocks SET type = ?, content = ?, collapsed = 0 WHERE id = ?').run(input.type, JSON.stringify(content), id)
        indexBlock(w.db, actor.id, w.getBlock(padId, id))
      }
      w.stamp(id)
      w.block(padId, id, 'pad.block.converted')
    }
    return blockResult(w.db, actor.workspaceId, padId, id)
  })
}

/**
 * Removes a block. `promote` (default) lifts its children one level into its place; `subtree`
 * removes everything nested inside it too. Only private blocks are deleted — never tasks.
 */
export function removeBlock(w: PadWrite, padId: string, id: string, mode: 'promote' | 'subtree'): string[] {
  const block = w.getBlock(padId, id)
  let affected: string[] = []
  if (mode === 'subtree') {
    const ids = subtreeIds(w.db, id)
    removePadSearch(w.db, ids)
    // ลบจากใบขึ้นไปหา root เพื่อไม่ให้ foreign key ของ parent_id ค้าง
    const del = w.db.prepare('DELETE FROM pad_blocks WHERE id = ?')
    for (const blockId of [...ids].reverse()) {
      del.run(blockId)
      w.m.invalidatePrivate({ type: 'pad_block', id: blockId }, w.actor.id, 'pad.block.deleted', w.origin)
    }
  } else {
    const children = siblingRows(w.db, padId, id, null)
    if (children.length) {
      const next = w.db
        .prepare('SELECT order_key FROM pad_blocks WHERE pad_id = ? AND parent_id IS ? AND order_key > ? AND id <> ? ORDER BY order_key LIMIT 1')
        .get(padId, block.parent_id, block.order_key, id) as { order_key: string } | undefined
      const keys = keysBetween(block.order_key, next?.order_key ?? null, children.length)
      const update = w.db.prepare('UPDATE pad_blocks SET parent_id = ?, order_key = ? WHERE id = ?')
      children.forEach((c, i) => update.run(block.parent_id, keys[i], c.id))
      affected = subtreeIds(w.db, id).slice(1)
      for (const c of children) w.stamp(c.id)
    }
    removePadSearch(w.db, [id])
    w.db.prepare('DELETE FROM pad_blocks WHERE id = ?').run(id)
    w.m.invalidatePrivate({ type: 'pad_block', id }, w.actor.id, 'pad.block.deleted', w.origin)
  }
  w.pad(padId, 'pad.block.deleted')
  return affected
}

export function deleteBlock(ctx: AppContext, actor: Actor, padId: string, id: string, input: z.infer<typeof deletePadBlockInput>): { deleted: true; id: string } {
  return padMutation(ctx, actor, input.mutationId, ['block.delete', padId, id, input], (w) => {
    const pad = requirePadRow(w.db, actor, padId)
    if (pad.archived_at) throw new AliceError('INVALID_STATE', 'This Pad is archived; restore it before editing')
    removeBlock(w, padId, id, input.mode)
    return { deleted: true as const, id }
  })
}

// ---------- Search ----------

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** Owner-scoped search over Pad names, Text, Heading and Task-block titles. Never touches workspace search. */
export function searchPads(ctx: AppContext, actor: Actor, input: z.infer<typeof padSearchInput>): Page<PadSearchResult> {
  requireHuman(actor)
  const limit = input.limit ?? 20
  const compiled = compileQuery(input.q)
  const where = ['d.owner_id = ?', 'p.workspace_id = ?']
  const params: unknown[] = [actor.id, actor.workspaceId]
  if (compiled.match) {
    where.push('pad_search_index MATCH ?')
    params.push(compiled.match)
  }
  for (const term of compiled.shortTerms) {
    where.push(`s.body LIKE ? ESCAPE '\\'`)
    params.push(`%${escapeLike(term)}%`)
  }
  if (!compiled.match && compiled.shortTerms.length === 0) return { items: [], nextCursor: null }
  if (input.archived === 'active') where.push('p.archived_at IS NULL')
  const offset = Number(decodeCursor(input.cursor)?.[0] ?? 0) || 0
  const order = compiled.match ? 'bm25(pad_search_index), d.rowid' : 'd.rowid'
  const rows = ctx.db
    .prepare(
      `SELECT d.pad_id, d.block_id, p.name AS pad_name, p.archived_at AS pad_archived_at, b.type AS block_type,
         ${compiled.match ? `snippet(pad_search_index, 0, '${HIGHLIGHT_START}', '${HIGHLIGHT_END}', '…', 16)` : 'substr(s.body, 1, 160)'} AS snippet
       FROM pad_search_index s JOIN pad_search_docs d ON d.rowid = s.rowid JOIN pads p ON p.id = d.pad_id LEFT JOIN pad_blocks b ON b.id = d.block_id
       WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`,
    )
    .all(...params, limit + 1, offset) as Array<{ pad_id: string; block_id: string | null; pad_name: string; pad_archived_at: string | null; block_type: PadBlockType | null; snippet: string }>
  const page = rows.slice(0, limit)
  return {
    items: page.map((r) => ({
      padId: r.pad_id,
      padName: r.pad_name,
      padArchived: r.pad_archived_at !== null,
      blockId: r.block_id,
      blockType: r.block_type,
      snippet: r.snippet ?? '',
      ancestorIds: r.block_id ? ancestorIds(ctx.db, r.block_id) : [],
    })),
    nextCursor: rows.length > limit ? encodeCursor([offset + limit]) : null,
  }
}

// ---------- Owner export ----------

/** The requesting human's Pads only, with hierarchy and task references (task records are not duplicated). */
export function exportPads(ctx: AppContext, actor: Actor): PadExport {
  requireHuman(actor)
  const pads = ctx.db.prepare('SELECT * FROM pads WHERE workspace_id = ? AND owner_id = ? ORDER BY created_at, id').all(actor.workspaceId, actor.id) as PadRow[]
  return {
    format: 'alice-pad-export',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    owner: { id: actor.id, displayName: actor.displayName },
    pads: pads.map((p) => {
      const rows = ctx.db.prepare(`${TREE} SELECT b.*, tree.depth FROM tree JOIN pad_blocks b ON b.id = tree.id ORDER BY tree.path`).all(p.id) as Array<BlockRow & { depth: number }>
      return {
        id: p.id,
        name: p.name,
        pinnedAt: p.pinned_at,
        archivedAt: p.archived_at,
        defaults: { projectId: p.default_project_id, status: p.default_status, assigneeId: p.default_assignee_id },
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        blocks: rows.map((b) => ({
          id: b.id,
          type: b.type,
          parentId: b.parent_id,
          depth: b.depth,
          content: JSON.parse(b.content) as PadSegment[],
          taskId: b.task_id,
          collapsed: b.collapsed === 1,
        })),
      }
    }),
  }
}
