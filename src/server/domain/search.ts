import { knowledgeFilters, documentTopicContext } from './knowledge-scope'
import type * as z from 'zod'
import {
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  type ActorKind,
  type DocumentKnowledgeStatus,
  type DocumentSearchMatch,
  type Page,
  type ProjectRef,
  type SearchKind,
  type SearchResult,
  type searchInput,
} from '../../shared/contracts'
import type { AppContext } from '../context'
import type { DB } from '../db/database'
import { decodeCursor, encodeCursor } from './sql'

export interface IndexEntry {
  kind: SearchKind
  resourceId: string
  taskId?: string | null
  displayTitle: string
  /** Searchable title text (empty for comments, whose display title is the task's). */
  title: string
  keywords?: string
  tags?: string
  body: string
  source?: string
  archived: boolean
}

/** Upserts the search row for one resource. Call inside the mutation transaction. */
export function indexResource(db: DB, entry: IndexEntry): void {
  const existing = db.prepare('SELECT rowid FROM search_docs WHERE kind = ? AND resource_id = ?').get(entry.kind, entry.resourceId) as { rowid: number } | undefined
  let rowid: number
  if (existing) {
    rowid = existing.rowid
    db.prepare('UPDATE search_docs SET task_id = ?, display_title = ?, archived = ? WHERE rowid = ?').run(entry.taskId ?? null, entry.displayTitle, entry.archived ? 1 : 0, rowid)
    db.prepare('DELETE FROM search_index WHERE rowid = ?').run(rowid)
  } else {
    rowid = Number(
      db
        .prepare('INSERT INTO search_docs (kind, resource_id, task_id, display_title, archived) VALUES (?, ?, ?, ?, ?)')
        .run(entry.kind, entry.resourceId, entry.taskId ?? null, entry.displayTitle, entry.archived ? 1 : 0).lastInsertRowid,
    )
  }
  db.prepare('INSERT INTO search_index (rowid, title, keywords, tags, body, source) VALUES (?, ?, ?, ?, ?, ?)').run(
    rowid,
    entry.title,
    entry.keywords ?? '',
    entry.tags ?? '',
    entry.body,
    entry.source ?? '',
  )
}

export function removeFromIndex(db: DB, kind: SearchKind, resourceId: string): void {
  const existing = db.prepare('SELECT rowid FROM search_docs WHERE kind = ? AND resource_id = ?').get(kind, resourceId) as { rowid: number } | undefined
  if (!existing) return
  db.prepare('DELETE FROM search_index WHERE rowid = ?').run(existing.rowid)
  db.prepare('DELETE FROM search_docs WHERE rowid = ?').run(existing.rowid)
}

export interface CompiledQuery {
  /** FTS5 MATCH expression for terms of 3+ characters, or null. */
  match: string | null
  /** Terms shorter than a trigram, matched with LIKE. */
  shortTerms: string[]
  terms: string[]
}

/** Turns free text into a safe FTS5 query: every term is quoted (no operator injection) and ANDed. */
export function compileQuery(q: string): CompiledQuery {
  const terms = q.split(/\s+/).map((t) => t.trim()).filter(Boolean).slice(0, 12)
  const long = terms.filter((t) => [...t].length >= 3)
  const shortTerms = terms.filter((t) => [...t].length < 3)
  return { match: long.length ? long.map((t) => `"${t.replace(/"/g, '""')}"`).join(' AND ') : null, shortTerms, terms }
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** WHERE fragments over `search_index` (alias s) for a compiled query. */
export function matchClauses(compiled: CompiledQuery): { sql: string[]; params: unknown[] } {
  const sql: string[] = []
  const params: unknown[] = []
  if (compiled.match) {
    sql.push('search_index MATCH ?')
    params.push(compiled.match)
  }
  for (const term of compiled.shortTerms) {
    sql.push(`(s.title LIKE ? ESCAPE '\\' OR s.keywords LIKE ? ESCAPE '\\' OR s.tags LIKE ? ESCAPE '\\' OR s.body LIKE ? ESCAPE '\\' OR s.source LIKE ? ESCAPE '\\')`)
    const like = `%${escapeLike(term)}%`
    params.push(like, like, like, like, like)
  }
  return { sql, params }
}

const FIELDS = [
  { column: 'title', result: 'title' },
  { column: 'keywords', result: 'keyword' },
  { column: 'tags', result: 'tag' },
  { column: 'body', result: 'body' },
  { column: 'source', result: 'sourceUrl' },
] as const

/** SQL CASE and parameters for the best matching field, ordered by product priority. */
export function fieldRankSql(compiled: CompiledQuery): { sql: string; params: unknown[] } {
  const params: unknown[] = []
  const cases = FIELDS.map((field, index) => {
    const matches: string[] = []
    if (compiled.match) matches.push(`instr(highlight(search_index, ${index}, '${HIGHLIGHT_START}', '${HIGHLIGHT_END}'), '${HIGHLIGHT_START}') > 0`)
    for (const term of compiled.shortTerms) {
      matches.push(`s.${field.column} LIKE ? ESCAPE '\\'`)
      params.push(`%${escapeLike(term)}%`)
    }
    return `WHEN ${matches.length ? `(${matches.join(' OR ')})` : '0'} THEN ${index}`
  })
  return { sql: `CASE ${cases.join(' ')} ELSE 5 END`, params }
}

function snippetSql(compiled: CompiledQuery, index: number, column: string): string {
  return compiled.match ? `snippet(search_index, ${index}, '${HIGHLIGHT_START}', '${HIGHLIGHT_END}', '…', 16)` : `substr(s.${column}, 1, 160)`
}

function documentFilters(ctx: AppContext, input: z.infer<typeof searchInput>): { sql: string[]; params: unknown[] } {
  const sql: string[] = []
  const params: unknown[] = []
  const knowledge = knowledgeFilters(ctx, input, 'doc')
  sql.push(...knowledge.sql)
  params.push(...knowledge.params)
  const hasFilters = !!(input.knowledgeProjectId || input.topicId || input.curatedOnly || input.tag?.length || input.status?.length || input.ownerId?.length || input.projectId?.length)
  if (hasFilters) sql.push(`d.kind = 'document'`)
  if (input.tag?.length) {
    sql.push(`EXISTS (SELECT 1 FROM document_tags dt WHERE dt.document_id = doc.id AND dt.tag_key IN (${input.tag.map(() => '?').join(',')}))`)
    params.push(...input.tag.map((tag) => tag.normalize('NFKC').toLocaleLowerCase('en-US')))
  }
  if (input.status?.length) {
    sql.push(`doc.knowledge_status IN (${input.status.map(() => '?').join(',')})`)
    params.push(...input.status)
  }
  if (input.ownerId?.length) {
    const ids = input.ownerId.filter((id) => id !== 'none')
    const parts: string[] = []
    if (input.ownerId.includes('none')) parts.push('doc.owner_id IS NULL')
    if (ids.length) {
      parts.push(`doc.owner_id IN (${ids.map(() => '?').join(',')})`)
      params.push(...ids)
    }
    sql.push(`(${parts.join(' OR ')})`)
  }
  if (input.projectId?.length) {
    sql.push(`EXISTS (SELECT 1 FROM project_documents pd WHERE pd.document_id = doc.id AND pd.project_id IN (${input.projectId.map(() => '?').join(',')}))`)
    params.push(...input.projectId)
  }
  return { sql, params }
}

interface SearchRow {
  kind: SearchKind
  resource_id: string
  task_id: string | null
  display_title: string
  archived: number
  field_rank: number
  title_snippet: string
  keywords_snippet: string
  tags_snippet: string
  body_snippet: string
  source_snippet: string
  doc_tags: string | null
  doc_keywords: string | null
  knowledge_status: DocumentKnowledgeStatus | null
  reviewed_at: string | null
  owner_ref_id: string | null
  owner_ref_kind: ActorKind | null
  owner_ref_name: string | null
}

function parseJsonArray(value: string | null): string[] {
  return value ? (JSON.parse(value) as string[]) : []
}

function matchingValue(values: string[], compiled: CompiledQuery): string | undefined {
  const terms = compiled.terms.map((term) => term.normalize('NFKC').toLocaleLowerCase('en-US'))
  return values.find((value) => terms.some((term) => value.normalize('NFKC').toLocaleLowerCase('en-US').includes(term)))
}

export function matchFromRow(row: SearchRow, compiled: CompiledQuery): DocumentSearchMatch {
  const field = FIELDS[Math.min(row.field_rank, FIELDS.length - 1)]
  const snippets = [row.title_snippet, row.keywords_snippet, row.tags_snippet, row.body_snippet, row.source_snippet]
  const values = field.result === 'keyword' ? parseJsonArray(row.doc_keywords) : field.result === 'tag' ? parseJsonArray(row.doc_tags) : []
  const value = values.length ? matchingValue(values, compiled) : undefined
  return { field: field.result, ...(value ? { value } : {}), excerpt: snippets[Math.min(row.field_rank, snippets.length - 1)] ?? '' }
}

export function projectContext(db: DB, documentId: string): { items: ProjectRef[]; total: number } {
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.system_key, p.archived_at, count(*) OVER () AS total
       FROM project_documents pd JOIN projects p ON p.id = pd.project_id
       WHERE pd.document_id = ? ORDER BY p.name COLLATE NOCASE, p.id LIMIT 5`,
    )
    .all(documentId) as Array<{ id: string; name: string; system_key: string | null; archived_at: string | null; total: number }>
  return {
    items: rows.map((row) => ({ id: row.id, name: row.name, isSystem: row.system_key !== null, archivedAt: row.archived_at })),
    total: rows[0]?.total ?? 0,
  }
}

export function search(ctx: AppContext, input: z.infer<typeof searchInput>): Page<SearchResult> {
  const limit = input.limit ?? 20
  const filters = documentFilters(ctx, input)
  const compiled = compileQuery(input.q)
  const query = matchClauses(compiled)
  if (query.sql.length === 0) return { items: [], nextCursor: null }
  if (input.kind?.length) {
    query.sql.push(`d.kind IN (${input.kind.map(() => '?').join(',')})`)
    query.params.push(...input.kind)
  }
  query.sql.push(...filters.sql)
  query.params.push(...filters.params)
  if (input.archived === 'active') query.sql.push('d.archived = 0')
  else if (input.archived === 'archived') query.sql.push('d.archived = 1')
  query.sql.push("(d.kind <> 'document' OR doc.workspace_id = ?)")
  query.params.push(ctx.workspaceId)
  const offset = Number(decodeCursor(input.cursor)?.[0] ?? 0) || 0
  const fieldRank = fieldRankSql(compiled)
  const bm25 = compiled.match ? 'bm25(search_index, 10.0, 6.0, 4.0, 1.0, 1.0)' : 'CAST(0 AS REAL)'
  const rows = ctx.db
    .prepare(
      `SELECT d.kind, d.resource_id, d.task_id, d.display_title, d.archived,
         ${fieldRank.sql} AS field_rank,
         CASE WHEN doc.id IN (SELECT km.document_id FROM knowledge_topics kt JOIN knowledge_topic_documents km ON km.topic_id = kt.id WHERE kt.workspace_id = ? AND kt.archived_at IS NULL${input.knowledgeProjectId ? ' AND kt.project_id = ?' : ''}) THEN 0 ELSE 1 END AS curation_rank,
         CASE WHEN d.kind <> 'document' THEN 0 WHEN doc.knowledge_status = 'current' THEN 0
              WHEN doc.knowledge_status IN ('draft', 'unreviewed') THEN 1 ELSE 2 END AS lifecycle_rank,
         ${snippetSql(compiled, 0, 'title')} AS title_snippet,
         ${snippetSql(compiled, 1, 'keywords')} AS keywords_snippet,
         ${snippetSql(compiled, 2, 'tags')} AS tags_snippet,
         ${snippetSql(compiled, 3, 'body')} AS body_snippet,
         ${snippetSql(compiled, 4, 'source')} AS source_snippet,
         CASE WHEN d.kind = 'document' THEN COALESCE((SELECT json_group_array(tag_text) FROM document_tags WHERE document_id = doc.id ORDER BY tag_key), '[]') END AS doc_tags,
         CASE WHEN d.kind = 'document' THEN COALESCE((SELECT json_group_array(keyword_text) FROM document_keywords WHERE document_id = doc.id ORDER BY keyword_key), '[]') END AS doc_keywords,
         doc.knowledge_status, doc.reviewed_at,
         ow.id AS owner_ref_id, ow.kind AS owner_ref_kind, ow.display_name AS owner_ref_name
       FROM search_index s
       JOIN search_docs d ON d.rowid = s.rowid
       LEFT JOIN documents doc ON d.kind = 'document' AND doc.id = d.resource_id
       LEFT JOIN actors ow ON ow.id = doc.owner_id
       WHERE ${query.sql.join(' AND ')}
       ORDER BY CASE field_rank WHEN 4 THEN 3 ELSE field_rank END, lifecycle_rank, ${bm25}, curation_rank, d.resource_id
       LIMIT ? OFFSET ?`,
    )
    .all(...fieldRank.params, ctx.workspaceId, ...(input.knowledgeProjectId ? [input.knowledgeProjectId] : []), ...query.params, limit + 1, offset) as SearchRow[]
  const page = rows.slice(0, limit)
  return {
    items: page.map((row): SearchResult => {
      const match = matchFromRow(row, compiled)
      if (row.kind === 'document') {
        return {
          kind: 'document',
          id: row.resource_id,
          taskId: null,
          title: row.display_title,
          snippet: match.excerpt,
          archived: row.archived === 1,
          match,
          tags: parseJsonArray(row.doc_tags),
          status: row.knowledge_status!,
          owner: row.owner_ref_id ? { id: row.owner_ref_id, kind: row.owner_ref_kind!, displayName: row.owner_ref_name! } : null,
          reviewedAt: row.reviewed_at,
          projectContext: projectContext(ctx.db, row.resource_id),
          topicContext: documentTopicContext(ctx.db, ctx.workspaceId, row.resource_id),
        }
      }
      return {
        kind: row.kind,
        id: row.resource_id,
        taskId: row.task_id!,
        title: row.display_title,
        snippet: match.excerpt,
        archived: row.archived === 1,
      }
    }),
    nextCursor: rows.length > limit ? encodeCursor([offset + limit]) : null,
  }
}
