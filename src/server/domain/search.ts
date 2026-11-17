import type * as z from 'zod'
import { HIGHLIGHT_END, HIGHLIGHT_START, type Page, type SearchKind, type SearchResult, type searchInput } from '../../shared/contracts'
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
  body: string
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
  db.prepare('INSERT INTO search_index (rowid, title, body) VALUES (?, ?, ?)').run(rowid, entry.title, entry.body)
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
}

/** Turns free text into a safe FTS5 query: every term is quoted (no operator injection) and ANDed. */
export function compileQuery(q: string): CompiledQuery {
  const terms = q.split(/\s+/).map((t) => t.trim()).filter(Boolean).slice(0, 12)
  const long = terms.filter((t) => [...t].length >= 3)
  const shortTerms = terms.filter((t) => [...t].length < 3)
  return { match: long.length ? long.map((t) => `"${t.replace(/"/g, '""')}"`).join(' AND ') : null, shortTerms }
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
    sql.push(`(s.title LIKE ? ESCAPE '\\' OR s.body LIKE ? ESCAPE '\\')`)
    const like = `%${escapeLike(term)}%`
    params.push(like, like)
  }
  return { sql, params }
}

export function search(ctx: AppContext, input: z.infer<typeof searchInput>): Page<SearchResult> {
  const limit = input.limit ?? 20
  const compiled = compileQuery(input.q)
  const { sql, params } = matchClauses(compiled)
  if (sql.length === 0) return { items: [], nextCursor: null }
  if (input.kind?.length) {
    sql.push(`d.kind IN (${input.kind.map(() => '?').join(',')})`)
    params.push(...input.kind)
  }
  if (input.archived === 'active') sql.push('d.archived = 0')
  else if (input.archived === 'archived') sql.push('d.archived = 1')
  const offset = Number(decodeCursor(input.cursor)?.[0] ?? 0) || 0
  // ลำดับคงที่: rank ก่อน แล้ว rowid เป็นตัวตัดสิน
  const order = compiled.match ? 'bm25(search_index, 5.0, 1.0), d.rowid' : 'd.rowid'
  const rows = ctx.db
    .prepare(
      `SELECT d.kind, d.resource_id, d.task_id, d.display_title, d.archived,
         ${compiled.match ? `snippet(search_index, -1, '${HIGHLIGHT_START}', '${HIGHLIGHT_END}', '…', 16)` : 'substr(s.body, 1, 160)'} AS snippet
       FROM search_index s JOIN search_docs d ON d.rowid = s.rowid
       WHERE ${sql.join(' AND ')}
       ORDER BY ${order}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit + 1, offset) as Array<{ kind: SearchKind; resource_id: string; task_id: string | null; display_title: string; archived: number; snippet: string }>
  const page = rows.slice(0, limit)
  return {
    items: page.map((r) => ({ kind: r.kind, id: r.resource_id, taskId: r.task_id, title: r.display_title, snippet: r.snippet ?? '', archived: r.archived === 1 })),
    nextCursor: rows.length > limit ? encodeCursor([offset + limit]) : null,
  }
}
