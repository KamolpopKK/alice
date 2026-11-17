import type * as z from 'zod'
import { UNTITLED_PROJECT_NAME, type Project, type createProjectInput, type updateProjectInput } from '../../shared/contracts'
import { AliceError } from '../../shared/errors'
import type { AppContext } from '../context'
import type { DB } from '../db/database'
import { newId, nowIso } from '../ids'
import { mutate, type Mutation } from './activity'
import type { Actor } from './actors'
import { actorCols, actorRefFrom, diff } from './sql'

export const UNTITLED_SYSTEM_KEY = 'untitled'

const PROJECT_SELECT = `SELECT p.*, ${actorCols('cb', 'created_by')}, ${actorCols('ub', 'updated_by')}
  FROM projects p LEFT JOIN actors cb ON cb.id = p.created_by LEFT JOIN actors ub ON ub.id = p.updated_by`

interface ProjectRow {
  id: string
  workspace_id: string
  system_key: string | null
  name: string
  description: string
  labels: string
  archived_at: string | null
  created_at: string
  updated_at: string
  [key: string]: unknown
}

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    labels: JSON.parse(row.labels) as string[],
    isSystem: row.system_key !== null,
    systemKey: row.system_key,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: actorRefFrom(row, 'created_by'),
    updatedBy: actorRefFrom(row, 'updated_by'),
  }
}

/** Creates the protected `Untitled` project once per workspace (identified by system key, not name). */
export function ensureSystemProject(db: DB, workspaceId: string): string {
  const existing = db.prepare('SELECT id FROM projects WHERE workspace_id = ? AND system_key = ?').get(workspaceId, UNTITLED_SYSTEM_KEY) as { id: string } | undefined
  if (existing) return existing.id
  const id = newId('prj')
  const now = nowIso()
  db.prepare(
    `INSERT INTO projects (id, workspace_id, system_key, name, description, labels, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '[]', ?, ?)`,
  ).run(id, workspaceId, UNTITLED_SYSTEM_KEY, UNTITLED_PROJECT_NAME, 'Default home for tasks created without a project.', now, now)
  db.prepare(
    `INSERT INTO activity_events (id, workspace_id, actor_id, verb, resource_type, resource_id, data, created_at)
     VALUES (?, ?, NULL, 'project.created', 'project', ?, ?, ?)`,
  ).run(newId('act'), workspaceId, id, JSON.stringify({ name: UNTITLED_PROJECT_NAME, system: true }), now)
  return id
}

export function systemProjectId(db: DB, workspaceId: string): string {
  const row = db.prepare('SELECT id FROM projects WHERE workspace_id = ? AND system_key = ?').get(workspaceId, UNTITLED_SYSTEM_KEY) as { id: string } | undefined
  if (!row) throw new AliceError('INTERNAL_ERROR', 'System project is missing')
  return row.id
}

export function findProjectRow(db: DB, workspaceId: string, id: string): ProjectRow | undefined {
  return db.prepare(`${PROJECT_SELECT} WHERE p.id = ? AND p.workspace_id = ?`).get(id, workspaceId) as ProjectRow | undefined
}

export function getProject(ctx: AppContext, id: string): Project {
  const row = findProjectRow(ctx.db, ctx.workspaceId, id)
  if (!row) throw new AliceError('NOT_FOUND', `Project ${id} not found`)
  return toProject(row)
}

export function listProjects(ctx: AppContext, filter: { archived?: 'active' | 'archived' | 'all' } = {}): Project[] {
  const where = ['p.workspace_id = ?']
  if (filter.archived === 'archived') where.push('p.archived_at IS NOT NULL')
  else if (filter.archived !== 'all') where.push('p.archived_at IS NULL')
  // system project ขึ้นก่อนเสมอ จากนั้นเรียงตามชื่อ
  const rows = ctx.db
    .prepare(`${PROJECT_SELECT} WHERE ${where.join(' AND ')} ORDER BY (p.system_key IS NULL), p.name COLLATE NOCASE, p.id`)
    .all(ctx.workspaceId) as ProjectRow[]
  return rows.map(toProject)
}

export interface ProjectMutationResult {
  project: Project
  activityId: string | null
}

export function createProject(ctx: AppContext, actor: Actor, input: z.infer<typeof createProjectInput>): ProjectMutationResult {
  const { value: id, activityId } = mutate(ctx, actor, (m) => {
    const id = newId('prj')
    m.db
      .prepare(
        `INSERT INTO projects (id, workspace_id, name, description, labels, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, m.workspaceId, input.name, input.description, JSON.stringify(input.labels), actor.id, actor.id, m.now, m.now)
    m.record({ verb: 'project.created', resource: { type: 'project', id }, data: { name: input.name, labels: input.labels } })
    return id
  })
  return { project: getProject(ctx, id), activityId }
}

function loadForUpdate(m: Mutation, id: string): ProjectRow {
  const row = findProjectRow(m.db, m.workspaceId, id)
  if (!row) throw new AliceError('NOT_FOUND', `Project ${id} not found`)
  return row
}

export function updateProject(ctx: AppContext, actor: Actor, id: string, patch: z.infer<typeof updateProjectInput>): ProjectMutationResult {
  const { activityId } = mutate(ctx, actor, (m) => {
    const row = loadForUpdate(m, id)
    const before = toProject(row)
    if (row.system_key && patch.name !== undefined && patch.name !== row.name) {
      throw new AliceError('PROTECTED_RESOURCE', `The ${UNTITLED_PROJECT_NAME} project cannot be renamed`)
    }
    const changes = diff({ name: before.name, description: before.description, labels: before.labels }, patch)
    if (Object.keys(changes).length === 0) return
    const next = { name: patch.name ?? before.name, description: patch.description ?? before.description, labels: patch.labels ?? before.labels }
    m.db
      .prepare('UPDATE projects SET name = ?, description = ?, labels = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(next.name, next.description, JSON.stringify(next.labels), actor.id, m.now, id)
    m.record({ verb: 'project.updated', resource: { type: 'project', id }, data: { changes } })
  })
  return { project: getProject(ctx, id), activityId }
}

export function setProjectArchived(ctx: AppContext, actor: Actor, id: string, archived: boolean): ProjectMutationResult {
  const { activityId } = mutate(ctx, actor, (m) => {
    const row = loadForUpdate(m, id)
    if (row.system_key) throw new AliceError('PROTECTED_RESOURCE', `The ${UNTITLED_PROJECT_NAME} project cannot be archived`)
    if (archived === (row.archived_at !== null)) return
    m.db.prepare('UPDATE projects SET archived_at = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(archived ? m.now : null, actor.id, m.now, id)
    m.record({ verb: archived ? 'project.archived' : 'project.restored', resource: { type: 'project', id } })
  })
  return { project: getProject(ctx, id), activityId }
}
