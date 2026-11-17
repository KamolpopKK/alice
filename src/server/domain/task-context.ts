import type * as z from 'zod'
import type { Comment, TaskContext, TaskRef, taskContextInput } from '../../shared/contracts'
import type { AppContext } from '../context'
import type { DB } from '../db/database'
import { countComments, listComments } from './comments'
import { ContextBudget } from './context-budget'
import { getDocument, listDocuments } from './documents'
import { getProject } from './projects'
import { getTask } from './tasks'

export interface RelationSlice {
  items: TaskRef[]
  total: number
}

/** Relationship lookups; replaced by the relationships module. */
export const RELATIONS = {
  parent: (_db: DB, _taskId: string): TaskRef | null => null,
  children: (_db: DB, _taskId: string, _limit: number): RelationSlice => ({ items: [], total: 0 }),
  blockers: (_db: DB, _taskId: string, _limit: number): RelationSlice => ({ items: [], total: 0 }),
  blocking: (_db: DB, _taskId: string, _limit: number): RelationSlice => ({ items: [], total: 0 }),
}

const COMMENT_BODY_CAP = 2_000

/**
 * One bounded call with what an agent needs to execute a task. Shares are deterministic:
 * task description ≤ 30%, project description ≤ 10%, comments ≤ 20%, documents share the rest.
 */
export function getTaskContext(ctx: AppContext, taskId: string, opts: z.infer<typeof taskContextInput>): TaskContext {
  const task = getTask(ctx, taskId)
  const project = getProject(ctx, task.project.id)
  const budget = new ContextBudget(opts.maxChars)
  budget.charge(task.title.length + project.name.length)

  const taskOut = { ...task, description: budget.text('task.description', task.description, Math.floor(opts.maxChars * 0.3), { tool: 'get_task', args: { id: task.id } }) }
  const projectOut = {
    ...project,
    description: budget.text('project.description', project.description, Math.floor(opts.maxChars * 0.1), { tool: 'get_project', args: { id: project.id } }),
  }

  const relation = (path: 'children' | 'blockers' | 'blocking', slice: RelationSlice) => {
    budget.charge(slice.items.reduce((n, t) => n + t.title.length, 0))
    budget.collection(path, slice.total, slice.items.length, {
      tool: 'list_tasks',
      args: { ...(path === 'children' ? { parentId: task.id } : path === 'blockers' ? { blockersOf: task.id } : { dependentsOf: task.id }), archived: 'all' },
    })
    return slice
  }
  const parent = RELATIONS.parent(ctx.db, task.id)
  const children = relation('children', RELATIONS.children(ctx.db, task.id, opts.relationLimit))
  const blockers = relation('blockers', RELATIONS.blockers(ctx.db, task.id, opts.relationLimit))
  const blocking = relation('blocking', RELATIONS.blocking(ctx.db, task.id, opts.relationLimit))

  // comments: ล่าสุด N รายการ แสดงตามลำดับเวลา
  const totalComments = countComments(ctx.db, task.id)
  const newest = opts.commentLimit > 0 ? listComments(ctx, task.id, { order: 'desc', limit: opts.commentLimit, cursor: null }) : { items: [], nextCursor: null }
  const commentBudget = new ContextBudget(Math.floor(opts.maxChars * 0.2))
  const comments: Comment[] = []
  for (const c of newest.items) {
    const allowed = Math.min(COMMENT_BODY_CAP, commentBudget.remaining, budget.remaining)
    if (allowed <= 0) break
    const body = budget.text(`comments.${c.id}.body`, c.body, allowed, { tool: 'list_comments', args: { taskId: task.id, order: 'desc' } })
    commentBudget.charge(body.length)
    comments.push({ ...c, body })
  }
  comments.reverse()
  if (comments.length < totalComments) {
    const oldest = comments[0]
    budget.collection('comments', totalComments, comments.length, {
      tool: 'list_comments',
      args: { taskId: task.id, order: 'desc', ...(oldest ? { cursor: Buffer.from(JSON.stringify([oldest.createdAt, oldest.id])).toString('base64url') } : {}) },
    })
  }

  // documents: แบ่ง budget ที่เหลือเท่า ๆ กัน (คงที่ตามลำดับ)
  const docPage = opts.documentLimit > 0 ? listDocuments(ctx, { taskId: task.id, archived: 'active', limit: opts.documentLimit, cursor: null }) : { items: [], nextCursor: null }
  const totalDocs = (ctx.db.prepare('SELECT count(*) AS n FROM task_documents td JOIN documents d ON d.id = td.document_id WHERE td.task_id = ? AND d.archived_at IS NULL').get(task.id) as { n: number }).n
  const documents: TaskContext['documents']['items'] = []
  docPage.items.forEach((summary, index) => {
    const share = Math.floor(budget.remaining / (docPage.items.length - index))
    const full = getDocument(ctx, summary.id)
    const allowed = Math.min(share, budget.remaining)
    const body = budget.text(`documents.${summary.id}.body`, full.body, allowed, { tool: 'get_document', args: { id: summary.id, offset: allowed } })
    documents.push({ ...summary, body })
  })
  budget.collection('documents', totalDocs, documents.length, { tool: 'search_documents', args: { taskId: task.id, cursor: docPage.nextCursor } })

  return {
    task: taskOut,
    project: projectOut,
    parent,
    children,
    blockers,
    blocking,
    documents: { items: documents, total: totalDocs },
    comments: { items: comments, total: totalComments },
    budget: { maxChars: opts.maxChars, usedChars: budget.usedChars, truncations: budget.truncations },
  }
}
