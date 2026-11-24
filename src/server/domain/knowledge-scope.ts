import type { DocumentTopicContext } from '../../shared/contracts'
import { AliceError } from '../../shared/errors'
import type { AppContext } from '../context'
import type { DB } from '../db/database'
import { encodeCursor } from './sql'
export type KnowledgeScope = {
  knowledgeProjectId?: string
  topicId?: string
  curatedOnly?: boolean
}
/** Additive AND filters; existing projectId continues to mean actual project_documents links. */
export function knowledgeFilters(ctx: AppContext, input: KnowledgeScope, alias: string) {
  const sql: string[] = []
  const params: unknown[] = []
  if (input.knowledgeProjectId && !ctx.db.prepare('SELECT 1 FROM projects WHERE id = ? AND workspace_id = ?').get(input.knowledgeProjectId, ctx.workspaceId)) throw new AliceError('NOT_FOUND', 'Knowledge project not found')
  if (input.topicId) {
    const topic = ctx.db.prepare('SELECT project_id, archived_at FROM knowledge_topics WHERE id = ? AND workspace_id = ?').get(input.topicId, ctx.workspaceId) as {
      project_id: string
      archived_at: string | null
    } | undefined
    if (!topic) throw new AliceError('NOT_FOUND', 'Knowledge topic not found')
    if (input.knowledgeProjectId && topic.project_id !== input.knowledgeProjectId) throw new AliceError('VALIDATION_ERROR', 'Topic does not belong to the knowledge project')
    if (topic.archived_at) throw new AliceError('INVALID_STATE', 'Restore the topic before discovering its knowledge')
    sql.push(`${alias}.id IN (SELECT document_id FROM knowledge_topic_documents WHERE topic_id = ?)`)
    params.push(input.topicId)
  }
  const membership = `SELECT km.document_id FROM knowledge_topics kt JOIN knowledge_topic_documents km ON km.topic_id = kt.id WHERE kt.workspace_id = ? AND kt.archived_at IS NULL`
  if (input.knowledgeProjectId) {
    sql.push(`${alias}.id IN (SELECT document_id FROM project_documents WHERE project_id = ? UNION ${membership} AND kt.project_id = ?)`)
    params.push(input.knowledgeProjectId, ctx.workspaceId, input.knowledgeProjectId)
  }
  if (input.curatedOnly) {
    sql.push(`${alias}.id IN (${membership}${input.knowledgeProjectId ? ' AND kt.project_id = ?' : ''})`)
    params.push(ctx.workspaceId, ...(input.knowledgeProjectId ? [input.knowledgeProjectId] : []))
  }
  return { sql, params }
}
export function documentTopicContext(db: DB, workspaceId: string, documentId: string): DocumentTopicContext {
  const rows = db.prepare(`SELECT k.id, k.project_id, k.name, k.archived_at, count(*) OVER () AS total FROM knowledge_topic_documents m CROSS JOIN knowledge_topics k ON k.id = m.topic_id
    WHERE m.document_id = ? AND k.workspace_id = ? ORDER BY k.id LIMIT 5`).all(documentId, workspaceId) as {
    id: string
    project_id: string
    name: string
    archived_at: string | null
    total: number
  }[]
  const total = rows[0]?.total ?? 0
  return { items: rows.map((r) => ({ id: r.id, projectId: r.project_id, name: r.name, archivedAt: r.archived_at })), total, nextCursor: total > rows.length ? encodeCursor([documentId, 'all', rows.at(-1)!.id]) : null }
}
