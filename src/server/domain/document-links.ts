import type * as z from 'zod'
import type { DocumentBacklink, DocumentTopicMembership, Page, listDocumentBacklinksInput } from '../../shared/contracts'
import { AliceError } from '../../shared/errors'
import type { AppContext } from '../context'
import { requireDocRow, toSummary } from './documents'
import { getKnowledgeTopic } from './knowledge'
import { projectContext } from './search'
import { decodeCursor, encodeCursor } from './sql'

type Input = z.infer<typeof listDocumentBacklinksInput>
function cursorId(input: Input, id: string): string {
  if (!input.cursor) return ''
  const c = decodeCursor(input.cursor)
  if (!c || c.length !== 3 || c[0] !== id || c[1] !== input.archived || typeof c[2] !== 'string') throw new AliceError('VALIDATION_ERROR', 'Invalid document reference cursor')
  return c[2]
}
export function listDocumentBacklinks(ctx: AppContext, id: string, input: Input): Page<DocumentBacklink> {
  requireDocRow(ctx.db, ctx.workspaceId, id)
  const limit = input.limit ?? 50
  const after = cursorId(input, id)
  const archive = input.archived === 'all' ? '' : ` AND d.archived_at IS ${input.archived === 'active' ? '' : 'NOT '}NULL`
  const rows = ctx.db.prepare(`WITH sources AS (
    SELECT source_document_id AS id, 1 AS inline_link, 0 AS manual_reference FROM document_inline_links WHERE target_document_id = ?
    UNION ALL
    SELECT source_document_id, 0, 1 FROM document_relations WHERE target_document_id = ? AND relation_type = 'references'
  ) SELECT s.id, max(s.inline_link) AS inline_link, max(s.manual_reference) AS manual_reference
    FROM sources s JOIN documents d ON d.id = s.id
    WHERE d.workspace_id = ? AND s.id > ?${archive} GROUP BY s.id ORDER BY s.id LIMIT ?`).all(id, id, ctx.workspaceId, after, limit + 1) as {
    id: string
    inline_link: number
    manual_reference: number
  }[]
  const page = rows.slice(0, limit)
  return {
    items: page.map((r) => {
      const document = toSummary(requireDocRow(ctx.db, ctx.workspaceId, r.id), ctx.db)
      if (document.archivedAt) document.excerpt = ''
      return { document, provenance: [...(r.inline_link ? ['inline' as const] : []), ...(r.manual_reference ? ['references' as const] : [])], projectContext: projectContext(ctx.db, r.id) }
    }),
    nextCursor: rows.length > limit ? encodeCursor([id, input.archived, page.at(-1)!.id]) : null,
  }
}
export function listDocumentTopics(ctx: AppContext, id: string, input: Input): Page<DocumentTopicMembership> {
  requireDocRow(ctx.db, ctx.workspaceId, id)
  const after = cursorId(input, id)
  const limit = input.limit ?? 50
  const archive = input.archived === 'all' ? '' : ` AND k.archived_at IS ${input.archived === 'active' ? '' : 'NOT '}NULL`
  const rows = ctx.db.prepare(`SELECT k.id, p.id AS project_id, p.name, p.system_key, p.archived_at
    FROM knowledge_topic_documents m JOIN knowledge_topics k ON k.id = m.topic_id JOIN projects p ON p.id = k.project_id
    WHERE m.document_id = ? AND k.workspace_id = ? AND p.workspace_id = ? AND k.id > ?${archive} ORDER BY k.id LIMIT ?`).all(id, ctx.workspaceId, ctx.workspaceId, after, limit + 1) as {
    id: string
    project_id: string
    name: string
    system_key: string | null
    archived_at: string | null
  }[]
  const page = rows.slice(0, limit)
  return { items: page.map((r) => ({ topic: getKnowledgeTopic(ctx, r.id), project: { id: r.project_id, name: r.name, isSystem: r.system_key !== null, archivedAt: r.archived_at } })), nextCursor: rows.length > limit ? encodeCursor([id, input.archived, page.at(-1)!.id]) : null }
}
