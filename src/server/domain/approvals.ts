import type * as z from 'zod'
import type { ApprovalRequest, ApprovalStatus, listApprovalsInput } from '../../shared/contracts'
import { AliceError } from '../../shared/errors'
import type { AppContext } from '../context'
import type { DB } from '../db/database'
import { newId } from '../ids'
import { mutate } from './activity'
import { findActorRow, type Actor } from './actors'
import { requireTaskRow } from './tasks'
import { actorCols, actorRefFrom } from './sql'

/*
 * Approval requests (capability `approvals`). Someone, usually an agent, asks a person a question
 * before going on with a task. Only people decide, and never the one who asked. A request that
 * names a person can be decided by that person or the workspace owner.
 */

const SELECT = `SELECT ar.*, t.title AS task_title, t.status AS task_status, t.archived_at AS task_archived_at,
    ${actorCols('rb', 'requested_by')}, ${actorCols('ro', 'requested_of')}, ${actorCols('db', 'decided_by')}
  FROM approval_requests ar JOIN tasks t ON t.id = ar.task_id
  LEFT JOIN actors rb ON rb.id = ar.requested_by LEFT JOIN actors ro ON ro.id = ar.requested_of LEFT JOIN actors db ON db.id = ar.decided_by`

interface Row {
  id: string
  task_id: string
  task_title: string
  task_status: ApprovalRequest['task']['status']
  task_archived_at: string | null
  question: string
  status: ApprovalStatus
  requested_by: string | null
  requested_of: string | null
  decided_at: string | null
  note: string | null
  created_at: string
  [key: string]: unknown
}

const toApproval = (r: Row): ApprovalRequest => ({
  id: r.id,
  task: { id: r.task_id, title: r.task_title, status: r.task_status, archivedAt: r.task_archived_at },
  question: r.question,
  status: r.status,
  requestedBy: actorRefFrom(r, 'requested_by'),
  requestedOf: actorRefFrom(r, 'requested_of'),
  decidedBy: actorRefFrom(r, 'decided_by'),
  decidedAt: r.decided_at,
  note: r.note,
  createdAt: r.created_at,
})

function rowOf(db: DB, workspaceId: string, id: string): Row {
  const row = db.prepare(`${SELECT} WHERE ar.id = ? AND ar.workspace_id = ?`).get(id, workspaceId) as Row | undefined
  if (!row) throw new AliceError('NOT_FOUND', `Approval request ${id} not found`)
  return row
}

export function getApproval(ctx: AppContext, id: string): ApprovalRequest {
  return toApproval(rowOf(ctx.db, ctx.workspaceId, id))
}

export function listApprovals(ctx: AppContext, actor: Actor, input: z.infer<typeof listApprovalsInput>): { items: ApprovalRequest[] } {
  const where = ['ar.workspace_id = ?']
  const args: unknown[] = [ctx.workspaceId]
  if (input.taskId) {
    where.push('ar.task_id = ?')
    args.push(input.taskId)
  }
  if (input.for === 'me') {
    // คำขอที่คนนี้ตัดสินได้: ยังรออยู่, ไม่ได้ถามเอง, และถามคนนี้ (หรือถามใครก็ได้; owner ตัดสินได้ทุกคำขอ)
    where.push("ar.status = 'pending'", '(ar.requested_by IS NULL OR ar.requested_by != ?)', 't.archived_at IS NULL')
    args.push(actor.id)
    if (!actor.isOwner) {
      where.push('(ar.requested_of IS NULL OR ar.requested_of = ?)')
      args.push(actor.id)
    }
  } else if (input.status) {
    where.push('ar.status = ?')
    args.push(input.status)
  }
  const rows = ctx.db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ar.created_at DESC, ar.id DESC LIMIT ?`).all(...args, input.limit ?? 50) as Row[]
  // for=me ไม่มีผลกับ agent (ไม่มีใครถาม agent ให้ตัดสิน)
  return { items: input.for === 'me' && actor.kind !== 'human' ? [] : rows.map(toApproval) }
}

export function requestApproval(ctx: AppContext, actor: Actor, taskId: string, input: { question: string; requestedOfId?: string | null }): { approval: ApprovalRequest; activityId: string | null } {
  const { value: id, activityId } = mutate(ctx, actor, (m) => {
    const task = requireTaskRow(m.db, m.workspaceId, taskId)
    if (task.archived_at) throw new AliceError('INVALID_STATE', 'Restore the task before asking for approval')
    let of: { id: string; display_name: string } | null = null
    if (input.requestedOfId) {
      const target = findActorRow(m.db, input.requestedOfId)
      if (!target || target.workspace_id !== m.workspaceId) throw new AliceError('NOT_FOUND', `Actor ${input.requestedOfId} not found`)
      if (target.kind !== 'human' || target.deactivated_at) throw new AliceError('VALIDATION_ERROR', 'Approval can be asked only of an active person', { field: 'requestedOfId' })
      if (target.id === actor.id) throw new AliceError('VALIDATION_ERROR', 'Ask someone else to approve', { field: 'requestedOfId' })
      of = target
    }
    const id = newId('apr')
    m.db
      .prepare('INSERT INTO approval_requests (id, workspace_id, task_id, question, requested_by, requested_of, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, m.workspaceId, taskId, input.question, actor.id, of?.id ?? null, m.now, m.now)
    m.record({
      verb: 'approval.requested',
      resource: { type: 'task', id: taskId },
      data: { approvalId: id, question: input.question, requestedOf: of ? { id: of.id, displayName: of.display_name } : null },
      alsoInvalidate: [{ type: 'approval', id }],
    })
    return id
  })
  return { approval: getApproval(ctx, id), activityId }
}

export function decideApproval(ctx: AppContext, actor: Actor, id: string, decision: 'approved' | 'rejected' | 'canceled', note?: string): { approval: ApprovalRequest; activityId: string | null } {
  const { activityId } = mutate(ctx, actor, (m) => {
    const row = rowOf(m.db, m.workspaceId, id)
    if (row.status !== 'pending') throw new AliceError('INVALID_STATE', `This request was already ${row.status}`)
    if (decision === 'canceled') {
      if (row.requested_by !== actor.id) throw new AliceError('FORBIDDEN', 'Only the one who asked can withdraw the request')
    } else {
      if (actor.kind !== 'human') throw new AliceError('FORBIDDEN', 'Only people can approve or reject')
      if (row.requested_by === actor.id) throw new AliceError('FORBIDDEN', 'Someone else has to decide on your own request')
      if (row.requested_of && row.requested_of !== actor.id && !actor.isOwner) throw new AliceError('FORBIDDEN', 'This request was asked of someone else')
    }
    m.db
      .prepare('UPDATE approval_requests SET status = ?, decided_by = ?, decided_at = ?, note = ?, updated_at = ? WHERE id = ?')
      .run(decision, actor.id, m.now, note?.trim() || null, m.now, id)
    m.record({
      verb: `approval.${decision}`,
      resource: { type: 'task', id: row.task_id },
      data: { approvalId: id, question: row.question, ...(note?.trim() ? { note: note.trim() } : {}) },
      alsoInvalidate: [{ type: 'approval', id }],
    })
  })
  return { approval: getApproval(ctx, id), activityId }
}
