import type { TaskRef, TaskRelations } from '../../shared/contracts'
import { AliceError } from '../../shared/errors'
import type { AppContext } from '../context'
import type { DB } from '../db/database'
import { mutate, type Mutation } from './activity'
import type { Actor } from './actors'
import { wouldCreateCycle } from './graph'
import { RELATIONS } from './task-context'
import { TASK_DECORATORS, TASK_FILTERS, afterTaskWrite, getTask, requireTaskRow, type TaskMutationResult } from './tasks'

const REF_COLUMNS = 't.id, t.title, t.status, t.archived_at'

function toRef(r: { id: string; title: string; status: TaskRef['status']; archived_at: string | null }): TaskRef {
  return { id: r.id, title: r.title, status: r.status, archivedAt: r.archived_at }
}

function refs(db: DB, sql: string, ...params: unknown[]): TaskRef[] {
  return (db.prepare(sql).all(...params) as Array<Parameters<typeof toRef>[0]>).map(toRef)
}

const parentOf = (db: DB) => (id: string) => {
  const row = db.prepare('SELECT parent_id FROM tasks WHERE id = ?').get(id) as { parent_id: string | null } | undefined
  return row?.parent_id ? [row.parent_id] : []
}
const blockersOf = (db: DB) => (id: string) => (db.prepare('SELECT blocker_id FROM task_blockers WHERE task_id = ?').all(id) as { blocker_id: string }[]).map((r) => r.blocker_id)

export function getRelations(ctx: AppContext, taskId: string): TaskRelations {
  const task = requireTaskRow(ctx.db, ctx.workspaceId, taskId)
  return {
    parent: task.parent_id ? refs(ctx.db, `SELECT ${REF_COLUMNS} FROM tasks t WHERE t.id = ?`, task.parent_id)[0] ?? null : null,
    children: refs(ctx.db, `SELECT ${REF_COLUMNS} FROM tasks t WHERE t.parent_id = ? ORDER BY t.created_at, t.id`, taskId),
    blockers: refs(ctx.db, `SELECT ${REF_COLUMNS} FROM task_blockers b JOIN tasks t ON t.id = b.blocker_id WHERE b.task_id = ? ORDER BY b.created_at, t.id`, taskId),
    blocking: refs(ctx.db, `SELECT ${REF_COLUMNS} FROM task_blockers b JOIN tasks t ON t.id = b.task_id WHERE b.blocker_id = ? ORDER BY b.created_at, t.id`, taskId),
  }
}

/** Validates a prospective parent inside a mutation (used by create and set-parent). */
export function assertValidParent(m: Mutation, taskId: string | null, parentId: string): void {
  requireTaskRow(m.db, m.workspaceId, parentId)
  if (taskId === null) return
  if (taskId === parentId) throw new AliceError('INVALID_RELATIONSHIP', 'A task cannot be its own parent')
  if (wouldCreateCycle(taskId, parentId, parentOf(m.db))) {
    throw new AliceError('RELATIONSHIP_CYCLE', `Making ${parentId} the parent of ${taskId} would create a cycle`)
  }
}

export function setParent(ctx: AppContext, actor: Actor, taskId: string, parentId: string | null): TaskMutationResult {
  const { activityId } = mutate(ctx, actor, (m) => {
    const task = requireTaskRow(m.db, m.workspaceId, taskId)
    if ((task.parent_id ?? null) === parentId) return
    if (parentId) assertValidParent(m, taskId, parentId)
    m.db.prepare('UPDATE tasks SET parent_id = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(parentId, actor.id, m.now, taskId)
    afterTaskWrite(m, taskId)
    const also = [task.parent_id, parentId].filter((x): x is string => !!x).map((id) => ({ type: 'task', id }))
    m.record({ verb: 'task.parent_changed', resource: { type: 'task', id: taskId }, data: { changes: { parentId: { from: task.parent_id ?? null, to: parentId } } }, alsoInvalidate: also })
  })
  return { task: getTask(ctx, taskId), activityId }
}

export function addBlocker(ctx: AppContext, actor: Actor, taskId: string, blockerId: string): TaskMutationResult {
  const { activityId } = mutate(ctx, actor, (m) => {
    requireTaskRow(m.db, m.workspaceId, taskId)
    const blocker = requireTaskRow(m.db, m.workspaceId, blockerId)
    if (taskId === blockerId) throw new AliceError('INVALID_RELATIONSHIP', 'A task cannot block itself')
    if (m.db.prepare('SELECT 1 FROM task_blockers WHERE task_id = ? AND blocker_id = ?').get(taskId, blockerId)) {
      throw new AliceError('INVALID_RELATIONSHIP', `${blockerId} already blocks ${taskId}`)
    }
    if (wouldCreateCycle(taskId, blockerId, blockersOf(m.db))) {
      throw new AliceError('RELATIONSHIP_CYCLE', `${blockerId} blocking ${taskId} would create a dependency cycle`)
    }
    m.db.prepare('INSERT INTO task_blockers (task_id, blocker_id, created_by, created_at) VALUES (?, ?, ?, ?)').run(taskId, blockerId, actor.id, m.now)
    m.record({ verb: 'task.blocker_added', resource: { type: 'task', id: taskId }, data: { blockerId, title: blocker.title }, alsoInvalidate: [{ type: 'task', id: blockerId }] })
  })
  return { task: getTask(ctx, taskId), activityId }
}

export function removeBlocker(ctx: AppContext, actor: Actor, taskId: string, blockerId: string): TaskMutationResult {
  const { activityId } = mutate(ctx, actor, (m) => {
    requireTaskRow(m.db, m.workspaceId, taskId)
    const blocker = requireTaskRow(m.db, m.workspaceId, blockerId)
    const res = m.db.prepare('DELETE FROM task_blockers WHERE task_id = ? AND blocker_id = ?').run(taskId, blockerId)
    if (res.changes === 0) throw new AliceError('NOT_FOUND', `${blockerId} does not block ${taskId}`)
    m.record({ verb: 'task.blocker_removed', resource: { type: 'task', id: taskId }, data: { blockerId, title: blocker.title }, alsoInvalidate: [{ type: 'task', id: blockerId }] })
  })
  return { task: getTask(ctx, taskId), activityId }
}

// ---------- integration with the task resource, listing and context ----------

TASK_DECORATORS.push((db, row, task) => {
  task.parentId = (row.parent_id as string | null) ?? null
  task.childCount = (db.prepare('SELECT count(*) AS n FROM tasks WHERE parent_id = ? AND archived_at IS NULL').get(row.id) as { n: number }).n
  task.openBlockerCount = (
    db
      .prepare(`SELECT count(*) AS n FROM task_blockers b JOIN tasks t ON t.id = b.blocker_id WHERE b.task_id = ? AND t.status NOT IN ('done', 'canceled')`)
      .get(row.id) as { n: number }
  ).n
})

TASK_FILTERS.push((input, where, params) => {
  if (input.parentId) {
    where.push('t.parent_id = ?')
    params.push(input.parentId)
  }
  if (input.blockersOf) {
    where.push('t.id IN (SELECT blocker_id FROM task_blockers WHERE task_id = ?)')
    params.push(input.blockersOf)
  }
  if (input.dependentsOf) {
    where.push('t.id IN (SELECT task_id FROM task_blockers WHERE blocker_id = ?)')
    params.push(input.dependentsOf)
  }
})

function slice(db: DB, countSql: string, listSql: string, id: string, limit: number) {
  return { total: (db.prepare(countSql).get(id) as { n: number }).n, items: refs(db, `${listSql} LIMIT ?`, id, limit) }
}

RELATIONS.parent = (db, id) => {
  const row = db.prepare('SELECT parent_id FROM tasks WHERE id = ?').get(id) as { parent_id: string | null }
  return row.parent_id ? refs(db, `SELECT ${REF_COLUMNS} FROM tasks t WHERE t.id = ?`, row.parent_id)[0] ?? null : null
}
RELATIONS.children = (db, id, limit) =>
  slice(db, 'SELECT count(*) AS n FROM tasks WHERE parent_id = ?', `SELECT ${REF_COLUMNS} FROM tasks t WHERE t.parent_id = ? ORDER BY t.created_at, t.id`, id, limit)
RELATIONS.blockers = (db, id, limit) =>
  slice(
    db,
    'SELECT count(*) AS n FROM task_blockers WHERE task_id = ?',
    `SELECT ${REF_COLUMNS} FROM task_blockers b JOIN tasks t ON t.id = b.blocker_id WHERE b.task_id = ? ORDER BY b.created_at, t.id`,
    id,
    limit,
  )
RELATIONS.blocking = (db, id, limit) =>
  slice(
    db,
    'SELECT count(*) AS n FROM task_blockers WHERE blocker_id = ?',
    `SELECT ${REF_COLUMNS} FROM task_blockers b JOIN tasks t ON t.id = b.task_id WHERE b.blocker_id = ? ORDER BY b.created_at, t.id`,
    id,
    limit,
  )
