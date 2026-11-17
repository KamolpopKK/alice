import type * as z from 'zod'
import type { Comment, CommentKind, Page, listCommentsInput } from '../../shared/contracts'
import { AliceError } from '../../shared/errors'
import type { AppContext } from '../context'
import type { DB } from '../db/database'
import { newId } from '../ids'
import { mutate, type Mutation } from './activity'
import type { Actor } from './actors'
import { indexResource } from './search'
import { actorCols, actorRefFrom, decodeCursor, encodeCursor } from './sql'
import { applyTaskPatch, getTask, requireTaskRow, type TaskMutationResult } from './tasks'

const COMMENT_SELECT = `SELECT c.*, ${actorCols('a', 'author')} FROM comments c JOIN actors a ON a.id = c.actor_id`

function toComment(row: Record<string, any>): Comment {
  return { id: row.id, taskId: row.task_id, kind: row.kind, body: row.body, author: actorRefFrom(row, 'author')!, createdAt: row.created_at }
}

export function getComment(db: DB, id: string): Comment {
  return toComment(db.prepare(`${COMMENT_SELECT} WHERE c.id = ?`).get(id) as Record<string, any>)
}

/** Inserts a comment inside an existing mutation; returns its id. */
export function insertComment(m: Mutation, actor: Actor, taskId: string, body: string, kind: CommentKind): string {
  const task = requireTaskRow(m.db, m.workspaceId, taskId)
  if (task.archived_at) throw new AliceError('INVALID_STATE', `Task ${taskId} is archived; restore it before commenting`)
  const id = newId('cmt')
  m.db
    .prepare('INSERT INTO comments (id, workspace_id, task_id, actor_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, m.workspaceId, taskId, actor.id, kind, body, m.now)
  indexResource(m.db, { kind: 'comment', resourceId: id, taskId, displayTitle: task.title, title: '', body, archived: false })
  m.invalidate({ type: 'comment', id })
  return id
}

export interface CommentResult {
  comment: Comment
  activityId: string | null
}

export function addComment(ctx: AppContext, actor: Actor, taskId: string, body: string): CommentResult {
  const { value: id, activityId } = mutate(ctx, actor, (m) => {
    const id = insertComment(m, actor, taskId, body, 'comment')
    m.record({ verb: 'comment.added', resource: { type: 'task', id: taskId }, data: { commentId: id, excerpt: body.slice(0, 140) } })
    return id
  })
  return { comment: getComment(ctx.db, id), activityId }
}

export function countComments(db: DB, taskId: string): number {
  return (db.prepare('SELECT count(*) AS n FROM comments WHERE task_id = ? AND archived_at IS NULL').get(taskId) as { n: number }).n
}

/** Keyset pagination over (created_at, id), oldest-first or newest-first. */
export function listComments(ctx: AppContext, taskId: string, input: z.infer<typeof listCommentsInput>): Page<Comment> {
  requireTaskRow(ctx.db, ctx.workspaceId, taskId)
  const limit = input.limit ?? 50
  const cmp = input.order === 'desc' ? '<' : '>'
  const where = ['c.task_id = ?', 'c.archived_at IS NULL']
  const params: unknown[] = [taskId]
  const cursor = decodeCursor(input.cursor)
  if (cursor?.length === 2) {
    where.push(`(c.created_at ${cmp} ? OR (c.created_at = ? AND c.id ${cmp} ?))`)
    params.push(cursor[0], cursor[0], cursor[1])
  }
  const rows = ctx.db
    .prepare(`${COMMENT_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.created_at ${input.order}, c.id ${input.order} LIMIT ?`)
    .all(...params, limit + 1) as Array<Record<string, any>>
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return { items: page.map(toComment), nextCursor: rows.length > limit ? encodeCursor([last.created_at, last.id]) : null }
}

export interface CompletionResult extends TaskMutationResult {
  comment: Comment | null
}

/**
 * Completes a task. Agents must provide a non-empty summary, which becomes a comment referenced
 * by the completion event; status, completion time, comment and activity commit atomically.
 */
export function completeTask(ctx: AppContext, actor: Actor, taskId: string, summary: string | undefined): CompletionResult {
  const text = summary?.trim() ?? ''
  if (actor.kind === 'agent' && !text) {
    throw new AliceError('VALIDATION_ERROR', 'Agents must include a completion summary describing what was delivered')
  }
  const { value: commentId, activityId } = mutate(ctx, actor, (m) => {
    const row = requireTaskRow(m.db, m.workspaceId, taskId)
    if (row.status === 'done') throw new AliceError('INVALID_STATE', `Task ${taskId} is already done`)
    const commentId = text ? insertComment(m, actor, taskId, text, 'completion_summary') : null
    applyTaskPatch(m, actor, requireTaskRow(m.db, m.workspaceId, taskId), { status: 'done' }, 'task.completed', { commentId })
    return commentId
  })
  return { task: getTask(ctx, taskId), comment: commentId ? getComment(ctx.db, commentId) : null, activityId }
}
