import type * as z from 'zod'
import { TASK_STATUSES, taskTitleSchema, type Task, type TaskStatus } from '../../shared/contracts'
import { AliceError } from '../../shared/errors'
import type { PadBlock, PadBlockResult, PadSegment, PadTaskCandidate, bulkPadTasksInput, undoTaskCaptureInput } from '../../shared/pads'
import type { AppContext } from '../context'
import type { DB } from '../db/database'
import type { Actor } from './actors'
import {
  PAD_TASK_BLOCKS,
  PAD_TASK_CONVERSIONS,
  PAD_TASK_EDITS,
  PAD_TASK_LOADER,
  blockResult,
  indexBlock,
  insertBlock,
  mentionsFor,
  normalizeContent,
  padMutation,
  placeKeys,
  plainText,
  readBlock,
  removeBlock,
  requireHuman,
  requirePadRow,
  type BlockRow,
  type PadWrite,
} from './pads'
import { TASK_SELECT, TASK_WRITE_HOOKS, applyTaskArchive, applyTaskPatch, getTask, insertTask, listTasks, requireTaskRow, toTask, type TaskRow } from './tasks'

// Task Pad ↔ task integration. Task blocks reference one authoritative task; every task
// change goes through the normal task services and activity, tagged with source `task_pad`.

type PadRow = ReturnType<typeof requirePadRow>

const source = (padId: string) => ({ source: 'task_pad', padId })

PAD_TASK_LOADER.load = (db, workspaceId, ids) => {
  const rows = db.prepare(`${TASK_SELECT} WHERE t.workspace_id = ? AND t.id IN (${ids.map(() => '?').join(',')})`).all(workspaceId, ...ids) as TaskRow[]
  return new Map(rows.map((r) => [r.id, toTask(db, r)]))
}

/** Creates a task from a title with the Pad's defaults (Untitled / Backlog / Unassigned / no priority otherwise). */
function createPadTask(w: PadWrite, pad: PadRow, rawTitle: string): string {
  const parsed = taskTitleSchema.safeParse(rawTitle)
  if (!parsed.success) throw new AliceError('VALIDATION_ERROR', `title: ${parsed.error.issues[0].message}`)
  return insertTask(
    w.m,
    w.actor,
    {
      title: parsed.data,
      description: '',
      projectId: pad.default_project_id,
      status: pad.default_status ?? 'backlog',
      priority: 'none',
      assigneeId: pad.default_assignee_id,
      labels: [],
    },
    source(pad.id),
  )
}

function placedBlock(db: DB, taskId: string): { id: string; pad_id: string } | undefined {
  return db.prepare('SELECT id, pad_id FROM pad_blocks WHERE task_id = ?').get(taskId) as { id: string; pad_id: string } | undefined
}

PAD_TASK_BLOCKS.create = (w, pad, input, parentId, afterId) => {
  if (input.content?.length) throw new AliceError('VALIDATION_ERROR', 'Task blocks take a title, not content')
  if (input.taskId !== undefined && input.title !== undefined) throw new AliceError('VALIDATION_ERROR', 'Send either title or taskId, not both')
  if (input.taskId !== undefined) {
    requireTaskRow(w.db, w.actor.workspaceId, input.taskId)
    // task หนึ่งมี Task block ได้แค่ที่เดียว: ถ้าวางไว้แล้วให้แทรกเป็น mention แทนการย้าย
    if (placedBlock(w.db, input.taskId)) {
      return insertBlock(w, pad.id, { type: 'text', parentId, afterId, content: [{ type: 'mention', taskId: input.taskId }] })
    }
    return insertBlock(w, pad.id, { type: 'task', parentId, afterId, content: [], taskId: input.taskId })
  }
  if (input.title === undefined) throw new AliceError('VALIDATION_ERROR', 'A Task block needs a title or an existing taskId')
  // ตรวจตำแหน่งก่อนสร้าง task เพื่อไม่ให้เกิด task ค้างเมื่อวางไม่ได้ (ทั้งหมดอยู่ใน transaction เดียวอยู่แล้ว)
  const taskId = createPadTask(w, pad, input.title)
  return insertBlock(w, pad.id, { type: 'task', parentId, afterId, content: [], taskId })
}

PAD_TASK_EDITS.apply = (w, block, patch) => {
  const row = requireTaskRow(w.db, w.actor.workspaceId, block.task_id!)
  applyTaskPatch(w.m, w.actor, row, { title: patch.title, description: patch.description }, 'task.updated', source(block.pad_id))
}

PAD_TASK_CONVERSIONS.convert = (w, pad, block, to) => {
  if (block.type === 'task') {
    // Task → Text/Heading: เก็บชื่อที่เห็นไว้เป็นข้อความ เอา block ออก แต่ task ไม่ถูกแตะ
    const task = requireTaskRow(w.db, w.actor.workspaceId, block.task_id!)
    const content = normalizeContent(w.db, w.actor.workspaceId, to, [{ type: 'text', text: task.title }])
    w.db.prepare(`UPDATE pad_blocks SET type = ?, task_id = NULL, content = ?, previous_status = NULL, collapsed = 0 WHERE id = ?`).run(to, JSON.stringify(content), block.id)
  } else {
    const hasChildren = w.db.prepare('SELECT 1 FROM pad_blocks WHERE parent_id = ? LIMIT 1').get(block.id)
    if (hasChildren) throw new AliceError('INVALID_RELATIONSHIP', 'Nothing can be nested under a Task; move the nested blocks out before converting')
    const title = plainText(JSON.parse(block.content) as PadSegment[]).replace(/\s+/g, ' ').trim()
    if (!title) throw new AliceError('VALIDATION_ERROR', 'Write a title before turning this block into a Task')
    const taskId = createPadTask(w, pad, title)
    w.db.prepare(`UPDATE pad_blocks SET type = 'task', task_id = ?, content = '[]', collapsed = 0 WHERE id = ?`).run(taskId, block.id)
  }
  indexBlock(w.db, w.actor.id, w.getBlock(pad.id, block.id))
}

// Pad search เก็บชื่อ task ของ Task block: ชื่อเปลี่ยนจากที่ไหนก็ต้อง index ใหม่
TASK_WRITE_HOOKS.push((m, taskId) => {
  const block = m.db.prepare('SELECT b.*, p.owner_id FROM pad_blocks b JOIN pads p ON p.id = b.pad_id WHERE b.task_id = ?').get(taskId) as (BlockRow & { owner_id: string }) | undefined
  if (block) indexBlock(m.db, block.owner_id, block)
})

function requireTaskBlock(w: PadWrite, padId: string, blockId: string): { block: BlockRow; task: TaskRow } {
  const block = w.getBlock(padId, blockId)
  if (block.type !== 'task') throw new AliceError('VALIDATION_ERROR', 'This action applies only to Task blocks')
  return { block, task: requireTaskRow(w.db, w.actor.workspaceId, block.task_id!) }
}

function requireEditablePad(w: PadWrite, actor: Actor, padId: string): PadRow {
  const pad = requirePadRow(w.db, actor, padId)
  if (pad.archived_at) throw new AliceError('INVALID_STATE', 'This Pad is archived; restore it before editing')
  return pad
}

/** Completion from a Pad remembers the previous status so Reopen can restore it. */
export function completeFromPad(ctx: AppContext, actor: Actor, padId: string, blockId: string, mutationId?: string): PadBlockResult {
  return padMutation(ctx, actor, mutationId, ['block.complete', padId, blockId], (w) => {
    requireEditablePad(w, actor, padId)
    const { block, task } = requireTaskBlock(w, padId, blockId)
    if (task.status !== 'done') {
      w.db.prepare('UPDATE pad_blocks SET previous_status = ? WHERE id = ?').run(task.status, block.id)
      applyTaskPatch(w.m, actor, task, { status: 'done' }, 'task.updated', source(padId))
    }
    w.stamp(block.id)
    w.block(padId, block.id, 'pad.block.updated')
    return blockResult(w.db, actor.workspaceId, padId, block.id)
  })
}

export function reopenFromPad(ctx: AppContext, actor: Actor, padId: string, blockId: string, mutationId?: string): PadBlockResult {
  return padMutation(ctx, actor, mutationId, ['block.reopen', padId, blockId], (w) => {
    requireEditablePad(w, actor, padId)
    const { block, task } = requireTaskBlock(w, padId, blockId)
    if (task.status === 'done') {
      const remembered = block.previous_status
      const status: TaskStatus = remembered && remembered !== 'done' && (TASK_STATUSES as readonly string[]).includes(remembered) ? remembered : 'backlog'
      applyTaskPatch(w.m, actor, task, { status }, 'task.updated', source(padId))
    }
    w.db.prepare('UPDATE pad_blocks SET previous_status = NULL WHERE id = ?').run(block.id)
    w.stamp(block.id)
    w.block(padId, block.id, 'pad.block.updated')
    return blockResult(w.db, actor.workspaceId, padId, block.id)
  })
}

/** Removes Task blocks whose task is Done. The tasks stay exactly as they are. */
export function removeCompleted(ctx: AppContext, actor: Actor, padId: string): { removed: string[] } {
  return padMutation(ctx, actor, undefined, null, (w) => {
    requireEditablePad(w, actor, padId)
    const ids = (
      w.db.prepare(`SELECT b.id FROM pad_blocks b JOIN tasks t ON t.id = b.task_id WHERE b.pad_id = ? AND t.status = 'done'`).all(padId) as Array<{ id: string }>
    ).map((r) => r.id)
    for (const id of ids) removeBlock(w, padId, id, 'promote')
    return { removed: ids }
  })
}

/**
 * Explicit demotion: appends the Task block's visible title to another task's description and removes
 * the source block. The source task is neither archived nor edited.
 */
export function turnIntoDescription(ctx: AppContext, actor: Actor, padId: string, blockId: string, targetTaskId: string, mutationId?: string): { task: Task; removedBlockId: string } {
  const result = padMutation(ctx, actor, mutationId, ['block.turn-into-description', padId, blockId, targetTaskId], (w) => {
    requireEditablePad(w, actor, padId)
    const { block, task } = requireTaskBlock(w, padId, blockId)
    if (targetTaskId === task.id) throw new AliceError('VALIDATION_ERROR', 'Choose a different task to receive the description')
    const target = requireTaskRow(w.db, actor.workspaceId, targetTaskId)
    const description = target.description.trimEnd()
    const line = `- ${task.title}`
    applyTaskPatch(w.m, actor, target, { description: description ? `${description}\n${line}` : line }, 'task.updated', source(padId))
    removeBlock(w, padId, block.id, 'promote')
    return { taskId: target.id, removedBlockId: block.id }
  })
  return { task: getTask(ctx, result.taskId), removedBlockId: result.removedBlockId }
}

/** Splits pasted text into task titles: blank lines dropped, each remaining line validated up front. */
export function bulkTitles(lines: string[]): { titles: string[]; errors: Array<{ line: number; message: string }> } {
  const titles: string[] = []
  const errors: Array<{ line: number; message: string }> = []
  lines.forEach((raw, i) => {
    const title = raw.replace(/\s+/g, ' ').trim()
    if (!title) return
    const parsed = taskTitleSchema.safeParse(title)
    if (!parsed.success) errors.push({ line: i + 1, message: parsed.error.issues[0].message })
    else titles.push(parsed.data)
  })
  return { titles, errors }
}

/** All-or-nothing creation of tasks and Task blocks from pasted lines; idempotent by mutationId. */
export function bulkCreateTasks(ctx: AppContext, actor: Actor, padId: string, input: z.infer<typeof bulkPadTasksInput>): { blocks: PadBlock[]; mentions: PadBlockResult['mentions'] } {
  return padMutation(ctx, actor, input.mutationId, ['block.bulk', padId, input], (w) => {
    const pad = requireEditablePad(w, actor, padId)
    const { titles, errors } = bulkTitles(input.titles)
    if (errors.length) throw new AliceError('VALIDATION_ERROR', `${errors.length} line(s) cannot become tasks`, errors)
    if (titles.length === 0) throw new AliceError('VALIDATION_ERROR', 'There are no non-blank lines to create')
    const parentId = input.parentId ?? null
    const keys = placeKeys(w.db, padId, parentId, input.afterId ?? null, titles.length)
    const ids = titles.map((title, i) => {
      const taskId = createPadTask(w, pad, title)
      return insertBlock(w, padId, { type: 'task', parentId, afterId: null, content: [], taskId, orderKey: keys[i] })
    })
    const blocks = ids.map((id) => readBlock(w.db, actor.workspaceId, padId, id))
    return { blocks, mentions: mentionsFor(w.db, actor.workspaceId, blocks) }
  })
}

/** Undo of task capture: archive each task and remove its block in one transaction (never deletes tasks). */
export function undoTaskCapture(ctx: AppContext, actor: Actor, padId: string, input: z.infer<typeof undoTaskCaptureInput>): { archived: string[]; removed: string[] } {
  return padMutation(ctx, actor, input.mutationId, ['block.undo-capture', padId, input], (w) => {
    requireEditablePad(w, actor, padId)
    const archived: string[] = []
    const removed: string[] = []
    for (const blockId of input.blockIds) {
      const { block, task } = requireTaskBlock(w, padId, blockId)
      applyTaskArchive(w.m, actor, task, true, source(padId))
      archived.push(task.id)
      removeBlock(w, padId, block.id, 'promote')
      removed.push(block.id)
    }
    return { archived, removed }
  })
}

/**
 * `@` search: active tasks by title or id, with placement. Placement detail (Pad name, block) is shown
 * only when the Pad belongs to the requester; another human's Pad is reported only as `placed`.
 */
export function searchTasksForPad(ctx: AppContext, actor: Actor, q: string, limit = 10): { items: PadTaskCandidate[] } {
  requireHuman(actor)
  const tasks: Task[] = []
  const seen = new Set<string>()
  const add = (t: Task) => {
    if (seen.has(t.id) || tasks.length >= limit) return
    seen.add(t.id)
    tasks.push(t)
  }
  const query = q.trim()
  if (/^tsk_[0-9a-z]+$/i.test(query)) {
    const rows = ctx.db.prepare(`${TASK_SELECT} WHERE t.workspace_id = ? AND t.archived_at IS NULL AND t.id LIKE ? ORDER BY t.id LIMIT ?`).all(actor.workspaceId, `${query.toLowerCase()}%`, limit) as TaskRow[]
    for (const r of rows) add(toTask(ctx.db, r))
  }
  for (const t of listTasks(ctx, { archived: 'active', q: query || undefined, sort: 'updated', limit }, actor).items) add(t)
  const items = tasks.map((task): PadTaskCandidate => {
    const placed = ctx.db
      .prepare('SELECT b.id AS block_id, p.id AS pad_id, p.name AS pad_name, p.owner_id FROM pad_blocks b JOIN pads p ON p.id = b.pad_id WHERE b.task_id = ?')
      .get(task.id) as { block_id: string; pad_id: string; pad_name: string; owner_id: string } | undefined
    return {
      task,
      placed: placed !== undefined,
      placement: placed && placed.owner_id === actor.id ? { padId: placed.pad_id, padName: placed.pad_name, blockId: placed.block_id } : null,
    }
  })
  return { items }
}
