import type * as z from 'zod'
import type { Milestone, ProjectMember, ProjectProgress, createMilestoneInput, updateMilestoneInput } from '../../shared/contracts'
import { AliceError } from '../../shared/errors'
import type { AppContext } from '../context'
import type { DB } from '../db/database'
import { newId } from '../ids'
import { mutate, type Mutation } from './activity'
import type { Actor } from './actors'
import { findActorRow } from './actors'
import { findProjectRow } from './projects'
import { actorCols, actorRefFrom } from './sql'

/*
 * Project planning (capability `project-planning`): members, milestones and progress. Members are
 * informational, so adding or removing one never changes what anyone may see or do.
 */

function requireProject(db: DB, workspaceId: string, id: string, forWrite = false) {
  const row = findProjectRow(db, workspaceId, id)
  if (!row) throw new AliceError('NOT_FOUND', `Project ${id} not found`)
  if (forWrite && row.archived_at) throw new AliceError('INVALID_STATE', 'Restore the project before changing its plan')
  return row
}

// ---------- members ----------

export function listProjectMembers(ctx: AppContext, projectId: string): ProjectMember[] {
  requireProject(ctx.db, ctx.workspaceId, projectId)
  const rows = ctx.db
    .prepare(
      `SELECT pm.added_at, ${actorCols('a', 'actor')}, ${actorCols('b', 'added_by')}
       FROM project_members pm JOIN actors a ON a.id = pm.actor_id LEFT JOIN actors b ON b.id = pm.added_by
       WHERE pm.project_id = ? ORDER BY a.kind DESC, a.display_name COLLATE NOCASE, a.id`,
    )
    .all(projectId) as Array<Record<string, unknown>>
  return rows.map((r) => ({ actor: actorRefFrom(r, 'actor')!, addedAt: r.added_at as string, addedBy: actorRefFrom(r, 'added_by') }))
}

export function setProjectMember(ctx: AppContext, actor: Actor, projectId: string, memberId: string, member: boolean): { members: ProjectMember[]; changed: boolean } {
  const { value: changed } = mutate(ctx, actor, (m) => {
    requireProject(m.db, m.workspaceId, projectId, true)
    const target = findActorRow(m.db, memberId)
    if (!target || target.workspace_id !== m.workspaceId) throw new AliceError('NOT_FOUND', `Actor ${memberId} not found`)
    const exists = m.db.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND actor_id = ?').get(projectId, memberId) !== undefined
    if (exists === member) return false
    if (member) {
      if (target.deactivated_at) throw new AliceError('INVALID_STATE', 'A deactivated account cannot be added to a project')
      m.db.prepare('INSERT INTO project_members (project_id, actor_id, added_by, added_at) VALUES (?, ?, ?, ?)').run(projectId, memberId, actor.id, m.now)
    } else m.db.prepare('DELETE FROM project_members WHERE project_id = ? AND actor_id = ?').run(projectId, memberId)
    m.record({
      verb: member ? 'project.member_added' : 'project.member_removed',
      resource: { type: 'project', id: projectId },
      data: { memberId, memberName: target.display_name, memberKind: target.kind },
    })
    return true
  })
  return { members: listProjectMembers(ctx, projectId), changed }
}

// ---------- milestones ----------

interface MilestoneRow {
  id: string
  project_id: string
  title: string
  due_date: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  [key: string]: unknown
}

const MILESTONE_SELECT = `SELECT ms.*, ${actorCols('cb', 'created_by')}, ${actorCols('ub', 'updated_by')}
  FROM milestones ms LEFT JOIN actors cb ON cb.id = ms.created_by LEFT JOIN actors ub ON ub.id = ms.updated_by`

const toMilestone = (r: MilestoneRow): Milestone => ({
  id: r.id,
  projectId: r.project_id,
  title: r.title,
  dueDate: r.due_date,
  completedAt: r.completed_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  createdBy: actorRefFrom(r, 'created_by'),
  updatedBy: actorRefFrom(r, 'updated_by'),
})

function milestoneRow(db: DB, workspaceId: string, id: string): MilestoneRow {
  const row = db.prepare(`${MILESTONE_SELECT} WHERE ms.id = ? AND ms.workspace_id = ?`).get(id, workspaceId) as MilestoneRow | undefined
  if (!row) throw new AliceError('NOT_FOUND', `Milestone ${id} not found`)
  return row
}

/** Milestones in date order; undated ones last. */
export function listMilestones(ctx: AppContext, projectId: string): Milestone[] {
  requireProject(ctx.db, ctx.workspaceId, projectId)
  const rows = ctx.db.prepare(`${MILESTONE_SELECT} WHERE ms.project_id = ? ORDER BY ms.due_date IS NULL, ms.due_date, ms.created_at, ms.id`).all(projectId) as MilestoneRow[]
  return rows.map(toMilestone)
}

function recordMilestone(m: Mutation, verb: string, row: { id: string; project_id: string; title: string }, data: Record<string, unknown> = {}) {
  m.record({ verb, resource: { type: 'project', id: row.project_id }, data: { milestoneId: row.id, title: row.title, ...data } })
}

export function createMilestone(ctx: AppContext, actor: Actor, projectId: string, input: z.infer<typeof createMilestoneInput>): { milestone: Milestone } {
  const { value: id } = mutate(ctx, actor, (m) => {
    requireProject(m.db, m.workspaceId, projectId, true)
    const id = newId('mst')
    m.db
      .prepare('INSERT INTO milestones (id, workspace_id, project_id, title, due_date, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, m.workspaceId, projectId, input.title, input.dueDate ?? null, actor.id, actor.id, m.now, m.now)
    recordMilestone(m, 'project.milestone_added', { id, project_id: projectId, title: input.title }, { dueDate: input.dueDate ?? null })
    return id
  })
  return { milestone: toMilestone(milestoneRow(ctx.db, ctx.workspaceId, id)) }
}

export function updateMilestone(ctx: AppContext, actor: Actor, id: string, patch: z.infer<typeof updateMilestoneInput>): { milestone: Milestone } {
  mutate(ctx, actor, (m) => {
    const row = milestoneRow(m.db, m.workspaceId, id)
    requireProject(m.db, m.workspaceId, row.project_id, true)
    const title = patch.title ?? row.title
    const dueDate = patch.dueDate === undefined ? row.due_date : patch.dueDate
    const completedAt = patch.completed === undefined ? row.completed_at : patch.completed ? (row.completed_at ?? m.now) : null
    if (title === row.title && dueDate === row.due_date && completedAt === row.completed_at) return
    m.db.prepare('UPDATE milestones SET title = ?, due_date = ?, completed_at = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(title, dueDate, completedAt, actor.id, m.now, id)
    const verb = completedAt !== row.completed_at ? (completedAt ? 'project.milestone_completed' : 'project.milestone_reopened') : 'project.milestone_updated'
    recordMilestone(m, verb, { id, project_id: row.project_id, title }, verb === 'project.milestone_updated' ? { changes: { ...(title !== row.title ? { title: { from: row.title, to: title } } : {}), ...(dueDate !== row.due_date ? { dueDate: { from: row.due_date, to: dueDate } } : {}) } } : {})
  })
  return { milestone: toMilestone(milestoneRow(ctx.db, ctx.workspaceId, id)) }
}

export function deleteMilestone(ctx: AppContext, actor: Actor, id: string): { deleted: true; id: string } {
  mutate(ctx, actor, (m) => {
    const row = milestoneRow(m.db, m.workspaceId, id)
    requireProject(m.db, m.workspaceId, row.project_id, true)
    m.db.prepare('DELETE FROM milestones WHERE id = ?').run(id)
    recordMilestone(m, 'project.milestone_removed', row)
  })
  return { deleted: true, id }
}

// ---------- progress ----------

export function projectProgress(ctx: AppContext, projectId: string): ProjectProgress {
  requireProject(ctx.db, ctx.workspaceId, projectId)
  const r = ctx.db
    .prepare(
      `SELECT count(*) AS total, sum(status = 'done') AS done, sum(status = 'canceled') AS canceled
       FROM tasks WHERE project_id = ? AND archived_at IS NULL`,
    )
    .get(projectId) as { total: number; done: number | null; canceled: number | null }
  const done = r.done ?? 0
  const canceled = r.canceled ?? 0
  return { total: r.total, done, canceled, open: r.total - done - canceled }
}
