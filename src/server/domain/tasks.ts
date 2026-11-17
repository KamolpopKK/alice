import type * as z from 'zod'
import {
  PRIORITY_RANK,
  type ListTasksInput,
  type Page,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type createTaskInput,
  type updateTaskInput,
} from '../../shared/contracts'
import { AliceError } from '../../shared/errors'
import type { AppContext } from '../context'
import type { DB } from '../db/database'
import { newId } from '../ids'
import { mutate, type Mutation } from './activity'
import { requireActiveActor, type Actor } from './actors'
import { findProjectRow, systemProjectId } from './projects'
import { actorCols, actorRefFrom, decodeCursor, diff, encodeCursor } from './sql'
import { compileQuery, indexResource, matchClauses } from './search'

export const TASK_SELECT = `SELECT t.*, p.name AS project_name, p.system_key AS project_system_key, p.archived_at AS project_archived_at,
    ${actorCols('asg', 'assignee')}, ${actorCols('cb', 'created_by')}, ${actorCols('ub', 'updated_by')}
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  LEFT JOIN actors asg ON asg.id = t.assignee_id
  JOIN actors cb ON cb.id = t.created_by
  JOIN actors ub ON ub.id = t.updated_by`

export interface TaskRow {
  id: string
  workspace_id: string
  project_id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  priority_rank: number
  due_at: string | null
  assignee_id: string | null
  labels: string
  completed_at: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
  project_name: string
  project_system_key: string | null
  project_archived_at: string | null
  [key: string]: unknown
}

/** Extra fields appended to the task resource by later modules (e.g. relationships). */
export const TASK_DECORATORS: Array<(db: DB, row: TaskRow, task: Task) => void> = []

export function toTask(db: DB, row: TaskRow): Task {
  const task: Task = {
    id: row.id,
    title: row.title,
    description: row.description,
    project: { id: row.project_id, name: row.project_name, isSystem: row.project_system_key !== null, archivedAt: row.project_archived_at },
    status: row.status,
    priority: row.priority,
    dueAt: row.due_at,
    assignee: actorRefFrom(row, 'assignee'),
    labels: JSON.parse(row.labels) as string[],
    completedAt: row.completed_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: actorRefFrom(row, 'created_by')!,
    updatedBy: actorRefFrom(row, 'updated_by')!,
    parentId: null,
    childCount: 0,
    openBlockerCount: 0,
  }
  for (const decorate of TASK_DECORATORS) decorate(db, row, task)
  return task
}

export function findTaskRow(db: DB, workspaceId: string, id: string): TaskRow | undefined {
  return db.prepare(`${TASK_SELECT} WHERE t.id = ? AND t.workspace_id = ?`).get(id, workspaceId) as TaskRow | undefined
}

export function requireTaskRow(db: DB, workspaceId: string, id: string): TaskRow {
  const row = findTaskRow(db, workspaceId, id)
  if (!row) throw new AliceError('NOT_FOUND', `Task ${id} not found`)
  return row
}

export function getTask(ctx: AppContext, id: string): Task {
  return toTask(ctx.db, requireTaskRow(ctx.db, ctx.workspaceId, id))
}

/** Rule: a task's destination project must exist in the workspace and must not be archived. */
function resolveDestinationProject(db: DB, workspaceId: string, projectId: string | null | undefined): string {
  if (!projectId) return systemProjectId(db, workspaceId)
  const project = findProjectRow(db, workspaceId, projectId)
  if (!project) throw new AliceError('NOT_FOUND', `Project ${projectId} not found`)
  if (project.archived_at) throw new AliceError('INVALID_STATE', `Project ${projectId} is archived; restore it or choose an active project`)
  return project.id
}

function writeLabels(db: DB, taskId: string, labels: string[]): void {
  db.prepare('DELETE FROM task_labels WHERE task_id = ?').run(taskId)
  const insert = db.prepare('INSERT OR IGNORE INTO task_labels (task_id, label_key) VALUES (?, ?)')
  for (const label of labels) insert.run(taskId, label.toLowerCase())
}

/** Hooks invoked after a task row changes inside the transaction (e.g. search indexing). */
export const TASK_WRITE_HOOKS: Array<(m: Mutation, taskId: string) => void> = []

export function afterTaskWrite(m: Mutation, taskId: string): void {
  const row = m.db.prepare('SELECT id, title, description, archived_at FROM tasks WHERE id = ?').get(taskId) as
    | { id: string; title: string; description: string; archived_at: string | null }
    | undefined
  if (row) {
    const archived = row.archived_at !== null
    indexResource(m.db, { kind: 'task', resourceId: row.id, taskId: row.id, displayTitle: row.title, title: row.title, body: row.description, archived })
    // comment ของ task แสดงชื่อ task และ archive ตาม task
    m.db.prepare(`UPDATE search_docs SET display_title = ?, archived = ? WHERE kind = 'comment' AND task_id = ?`).run(row.title, archived ? 1 : 0, row.id)
  }
  for (const hook of TASK_WRITE_HOOKS) hook(m, taskId)
}

export interface TaskMutationResult {
  task: Task
  activityId: string | null
}

/** Inserts a task inside an existing mutation and records `task.created` (with optional source metadata). */
export function insertTask(m: Mutation, actor: Actor, input: z.infer<typeof createTaskInput>, extraData: Record<string, unknown> = {}): string {
  const projectId = resolveDestinationProject(m.db, m.workspaceId, input.projectId)
  if (input.assigneeId) requireActiveActor(m.db, m.workspaceId, input.assigneeId)
  if (input.parentId) requireTaskRow(m.db, m.workspaceId, input.parentId)
  const id = newId('tsk')
  m.db
    .prepare(
      `INSERT INTO tasks (id, workspace_id, project_id, title, description, status, priority, priority_rank, due_at, assignee_id, labels,
         completed_at, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      m.workspaceId,
      projectId,
      input.title,
      input.description,
      input.status,
      input.priority,
      PRIORITY_RANK[input.priority],
      input.dueAt ?? null,
      input.assigneeId ?? null,
      JSON.stringify(input.labels),
      input.status === 'done' ? m.now : null,
      actor.id,
      actor.id,
      m.now,
      m.now,
    )
  if (input.parentId) m.db.prepare('UPDATE tasks SET parent_id = ? WHERE id = ?').run(input.parentId, id)
  writeLabels(m.db, id, input.labels)
  afterTaskWrite(m, id)
  m.record({
    verb: 'task.created',
    resource: { type: 'task', id },
    data: { title: input.title, projectId, status: input.status, priority: input.priority, assigneeId: input.assigneeId ?? null, parentId: input.parentId ?? null, ...extraData },
    alsoInvalidate: [{ type: 'project', id: projectId }, ...(input.parentId ? [{ type: 'task', id: input.parentId }] : [])],
  })
  return id
}

export function createTask(ctx: AppContext, actor: Actor, input: z.infer<typeof createTaskInput>): TaskMutationResult {
  if (actor.kind === 'agent' && input.status === 'done') {
    throw new AliceError('INVALID_STATE', 'Agents complete work with complete_task and a summary; create the task first')
  }
  const { value: id, activityId } = mutate(ctx, actor, (m) => insertTask(m, actor, input))
  return { task: getTask(ctx, id), activityId }
}

type TaskPatch = z.infer<typeof updateTaskInput>

/**
 * Applies a last-write-wins patch inside an existing mutation. Shared by update, claim and completion.
 * Returns the recorded field changes (empty when nothing changed).
 */
export function applyTaskPatch(m: Mutation, actor: Actor, row: TaskRow, patch: TaskPatch, verb = 'task.updated', extraData: Record<string, unknown> = {}) {
  if (row.archived_at) throw new AliceError('INVALID_STATE', `Task ${row.id} is archived; restore it before editing`)
  const current = {
    title: row.title,
    description: row.description,
    projectId: row.project_id,
    status: row.status,
    priority: row.priority,
    dueAt: row.due_at,
    assigneeId: row.assignee_id,
    labels: JSON.parse(row.labels) as string[],
  }
  const changes = diff(current, patch)
  if (Object.keys(changes).length === 0) return { changes, activityId: null as string | null }

  if (changes.projectId) resolveDestinationProject(m.db, m.workspaceId, patch.projectId)
  if (changes.assigneeId && patch.assigneeId) requireActiveActor(m.db, m.workspaceId, patch.assigneeId)

  const next = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as typeof current
  // done ⇒ ตั้งเวลา completion; ออกจาก done ⇒ ล้างเวลา (ประวัติยังอยู่ใน activity)
  let completedAt = row.completed_at
  if (changes.status) completedAt = next.status === 'done' ? m.now : null

  m.db
    .prepare(
      `UPDATE tasks SET title = ?, description = ?, project_id = ?, status = ?, priority = ?, priority_rank = ?, due_at = ?, assignee_id = ?,
         labels = ?, completed_at = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      next.title,
      next.description,
      next.projectId,
      next.status,
      next.priority,
      PRIORITY_RANK[next.priority],
      next.dueAt,
      next.assigneeId,
      JSON.stringify(next.labels),
      completedAt,
      actor.id,
      m.now,
      row.id,
    )
  if (changes.labels) writeLabels(m.db, row.id, next.labels)
  afterTaskWrite(m, row.id)
  const alsoInvalidate = [{ type: 'project', id: row.project_id }]
  if (changes.projectId) alsoInvalidate.push({ type: 'project', id: next.projectId })
  const activityId = m.record({ verb, resource: { type: 'task', id: row.id }, data: { changes, ...extraData }, alsoInvalidate })
  return { changes, activityId }
}

export function updateTask(ctx: AppContext, actor: Actor, id: string, patch: TaskPatch): TaskMutationResult {
  if (actor.kind === 'agent' && patch.status === 'done') {
    throw new AliceError('INVALID_STATE', 'Agents must use complete_task with a completion summary to mark work done')
  }
  const { activityId } = mutate(ctx, actor, (m) => {
    applyTaskPatch(m, actor, requireTaskRow(m.db, m.workspaceId, id), patch)
  })
  return { task: getTask(ctx, id), activityId }
}

/** Archives or restores inside an existing mutation; a no-op when already in that state. */
export function applyTaskArchive(m: Mutation, actor: Actor, row: TaskRow, archived: boolean, extraData: Record<string, unknown> = {}): void {
  if (archived === (row.archived_at !== null)) return
  m.db.prepare('UPDATE tasks SET archived_at = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(archived ? m.now : null, actor.id, m.now, row.id)
  afterTaskWrite(m, row.id)
  m.record({
    verb: archived ? 'task.archived' : 'task.restored',
    resource: { type: 'task', id: row.id },
    ...(Object.keys(extraData).length ? { data: extraData } : {}),
    alsoInvalidate: [{ type: 'project', id: row.project_id }],
  })
}

export function setTaskArchived(ctx: AppContext, actor: Actor, id: string, archived: boolean): TaskMutationResult {
  const { activityId } = mutate(ctx, actor, (m) => {
    applyTaskArchive(m, actor, requireTaskRow(m.db, m.workspaceId, id), archived)
  })
  return { task: getTask(ctx, id), activityId }
}

// ---------- Listing ----------

const SORT_EXPR: Record<ListTasksInput['sort'], string> = {
  updated: 't.updated_at',
  created: 't.created_at',
  priority: 't.priority_rank',
  due: `COALESCE(t.due_at, '9999-12-31T23:59:59.999Z')`,
  title: 't.title COLLATE NOCASE',
}
const DEFAULT_ORDER: Record<ListTasksInput['sort'], 'asc' | 'desc'> = { updated: 'desc', created: 'desc', priority: 'desc', due: 'asc', title: 'asc' }

/** Extra WHERE builders contributed by later modules (e.g. full-text search). */
export const TASK_FILTERS: Array<(input: ListTasksInput, where: string[], params: unknown[]) => void> = []

/**
 * Deterministic, keyset-paginated task listing. Never loads the whole table:
 * the cursor encodes (sort value, id) of the last row returned.
 */
export function listTasks(ctx: AppContext, input: ListTasksInput, actor?: Actor): Page<Task> {
  const limit = input.limit ?? 50
  const where = ['t.workspace_id = ?']
  const params: unknown[] = [ctx.workspaceId]
  const inList = (column: string, values: unknown[]) => {
    where.push(`${column} IN (${values.map(() => '?').join(',')})`)
    params.push(...values)
  }
  if (input.archived === 'active') where.push('t.archived_at IS NULL')
  else if (input.archived === 'archived') where.push('t.archived_at IS NOT NULL')
  if (input.projectId?.length) inList('t.project_id', input.projectId)
  if (input.status?.length) inList('t.status', input.status)
  if (input.priority?.length) inList('t.priority', input.priority)
  if (input.assigneeId?.length) {
    const ids = input.assigneeId.map((a) => (a === 'me' && actor ? actor.id : a))
    const real = ids.filter((a) => a !== 'none')
    const clauses: string[] = []
    if (real.length) {
      clauses.push(`t.assignee_id IN (${real.map(() => '?').join(',')})`)
      params.push(...real)
    }
    if (ids.includes('none')) clauses.push('t.assignee_id IS NULL')
    where.push(`(${clauses.join(' OR ')})`)
  }
  if (input.label?.length) {
    where.push(`EXISTS (SELECT 1 FROM task_labels tl WHERE tl.task_id = t.id AND tl.label_key IN (${input.label.map(() => '?').join(',')}))`)
    params.push(...input.label.map((l) => l.toLowerCase()))
  }
  if (input.dueBefore) {
    where.push('t.due_at IS NOT NULL AND t.due_at <= ?')
    params.push(input.dueBefore)
  }
  if (input.dueAfter) {
    where.push('t.due_at IS NOT NULL AND t.due_at >= ?')
    params.push(input.dueAfter)
  }
  if (input.q) {
    const { sql, params: matchParams } = matchClauses(compileQuery(input.q))
    if (sql.length) {
      where.push(`t.id IN (SELECT d.resource_id FROM search_index s JOIN search_docs d ON d.rowid = s.rowid WHERE d.kind = 'task' AND ${sql.join(' AND ')})`)
      params.push(...matchParams)
    }
  }
  for (const filter of TASK_FILTERS) filter(input, where, params)

  const expr = SORT_EXPR[input.sort]
  const order = input.order ?? DEFAULT_ORDER[input.sort]
  const cmp = order === 'desc' ? '<' : '>'
  const cursor = decodeCursor(input.cursor)
  if (cursor && cursor.length === 2) {
    where.push(`(${expr} ${cmp} ? OR (${expr} = ? AND t.id ${cmp} ?))`)
    params.push(cursor[0], cursor[0], cursor[1])
  }
  const select = TASK_SELECT.replace('SELECT t.*,', `SELECT t.*, ${expr} AS sort_value,`)
  const sql = `${select} WHERE ${where.join(' AND ')} ORDER BY ${expr} ${order}, t.id ${order} LIMIT ?`
  const rows = ctx.db.prepare(sql).all(...params, limit + 1) as Array<TaskRow & { sort_value: unknown }>
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return { items: page.map((r) => toTask(ctx.db, r)), nextCursor: rows.length > limit ? encodeCursor([last.sort_value, last.id]) : null }
}

/**
 * Atomic compare-and-set claim: succeeds only for an unarchived, unassigned `ready` task.
 * Success assigns the caller and moves the task to `in_progress` in one transaction.
 */
export function claimTask(ctx: AppContext, actor: Actor, id: string): TaskMutationResult {
  const { activityId } = mutate(ctx, actor, (m) => {
    const row = requireTaskRow(m.db, m.workspaceId, id)
    if (row.archived_at || row.status !== 'ready' || row.assignee_id !== null) {
      const reason = row.archived_at
        ? 'the task is archived'
        : row.assignee_id !== null
          ? row.assignee_id === actor.id
            ? 'you are already assigned to it'
            : 'it is already assigned to someone else'
          : `its status is ${row.status}, not ready`
      throw new AliceError('CLAIM_FAILED', `Task ${id} cannot be claimed because ${reason}`, {
        status: row.status,
        assigneeId: row.assignee_id,
        archived: row.archived_at !== null,
      })
    }
    applyTaskPatch(m, actor, row, { status: 'in_progress', assigneeId: actor.id }, 'task.claimed')
  })
  return { task: getTask(ctx, id), activityId }
}
