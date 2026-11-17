import type * as z from 'zod'
import {
  DOCUMENT_CONTENT_MESSAGE,
  type DocumentDetail,
  type DocumentRevision,
  type DocumentSummary,
  type Page,
  type ProjectRef,
  type TaskRef,
  type createDocumentInput,
  type listDocumentsInput,
  type updateDocumentInput,
} from '../../shared/contracts'
import { AliceError } from '../../shared/errors'
import type { AppContext } from '../context'
import type { DB } from '../db/database'
import { newId } from '../ids'
import { mutate, type Mutation } from './activity'
import type { Actor } from './actors'
import { findProjectRow } from './projects'
import { compileQuery, indexResource, matchClauses } from './search'
import { actorCols, actorRefFrom, decodeCursor, diff, encodeCursor } from './sql'
import { requireTaskRow } from './tasks'

const DOC_SELECT = `SELECT d.*, ${actorCols('cb', 'created_by')}, ${actorCols('ub', 'updated_by')}
  FROM documents d JOIN actors cb ON cb.id = d.created_by JOIN actors ub ON ub.id = d.updated_by`

interface DocRow {
  id: string
  workspace_id: string
  title: string
  body: string
  source_url: string | null
  revision: number
  archived_at: string | null
  created_at: string
  updated_at: string
  [key: string]: unknown
}

const EXCERPT_CHARS = 200

export function toSummary(row: DocRow): DocumentSummary {
  const plain = row.body.replace(/\s+/g, ' ').trim()
  return {
    id: row.id,
    title: row.title,
    sourceUrl: row.source_url,
    excerpt: plain.length > EXCERPT_CHARS ? `${plain.slice(0, EXCERPT_CHARS - 1)}…` : plain,
    bodyLength: row.body.length,
    revision: row.revision,
    archivedAt: row.archived_at,
    updatedAt: row.updated_at,
    updatedBy: actorRefFrom(row, 'updated_by')!,
  }
}

function linkedTasks(db: DB, documentId: string): TaskRef[] {
  return (
    db
      .prepare(
        `SELECT t.id, t.title, t.status, t.archived_at FROM task_documents td JOIN tasks t ON t.id = td.task_id
         WHERE td.document_id = ? ORDER BY td.created_at, t.id`,
      )
      .all(documentId) as Array<{ id: string; title: string; status: TaskRef['status']; archived_at: string | null }>
  ).map((r) => ({ id: r.id, title: r.title, status: r.status, archivedAt: r.archived_at }))
}

function linkedProjects(db: DB, documentId: string): ProjectRef[] {
  return (
    db
      .prepare(
        `SELECT p.id, p.name, p.system_key, p.archived_at FROM project_documents pd JOIN projects p ON p.id = pd.project_id
         WHERE pd.document_id = ? ORDER BY pd.created_at, p.id`,
      )
      .all(documentId) as Array<{ id: string; name: string; system_key: string | null; archived_at: string | null }>
  ).map((r) => ({ id: r.id, name: r.name, isSystem: r.system_key !== null, archivedAt: r.archived_at }))
}

export function toDetail(db: DB, row: DocRow): DocumentDetail {
  const { excerpt: _excerpt, ...summary } = toSummary(row)
  return {
    ...summary,
    body: row.body,
    createdAt: row.created_at,
    createdBy: actorRefFrom(row, 'created_by')!,
    links: { tasks: linkedTasks(db, row.id), projects: linkedProjects(db, row.id) },
  }
}

export function findDocRow(db: DB, workspaceId: string, id: string): DocRow | undefined {
  return db.prepare(`${DOC_SELECT} WHERE d.id = ? AND d.workspace_id = ?`).get(id, workspaceId) as DocRow | undefined
}

function requireDocRow(db: DB, workspaceId: string, id: string): DocRow {
  const row = findDocRow(db, workspaceId, id)
  if (!row) throw new AliceError('NOT_FOUND', `Document ${id} not found`)
  return row
}

export function getDocument(ctx: AppContext, id: string): DocumentDetail {
  return toDetail(ctx.db, requireDocRow(ctx.db, ctx.workspaceId, id))
}

function indexDocument(m: Mutation, id: string): void {
  const row = m.db.prepare('SELECT title, body, source_url, archived_at FROM documents WHERE id = ?').get(id) as {
    title: string
    body: string
    source_url: string | null
    archived_at: string | null
  }
  indexResource(m.db, {
    kind: 'document',
    resourceId: id,
    displayTitle: row.title,
    title: row.title,
    body: [row.body, row.source_url ?? ''].join('\n'),
    archived: row.archived_at !== null,
  })
}

function writeRevision(m: Mutation, documentId: string, number: number, content: { title: string; body: string; sourceUrl: string | null }, restoredFrom: number | null) {
  m.db
    .prepare(
      `INSERT INTO document_revisions (id, document_id, number, title, body, source_url, restored_from, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(newId('rev'), documentId, number, content.title, content.body, content.sourceUrl, restoredFrom, m.actor!.id, m.now)
}

export interface DocumentMutationResult {
  document: DocumentDetail
  activityId: string | null
}

export function createDocument(ctx: AppContext, actor: Actor, input: z.infer<typeof createDocumentInput>): DocumentMutationResult {
  const { value: id, activityId } = mutate(ctx, actor, (m) => {
    const id = newId('doc')
    const sourceUrl = input.sourceUrl ?? null
    m.db
      .prepare(
        `INSERT INTO documents (id, workspace_id, title, body, source_url, revision, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      )
      .run(id, m.workspaceId, input.title, input.body, sourceUrl, actor.id, actor.id, m.now, m.now)
    writeRevision(m, id, 1, { title: input.title, body: input.body, sourceUrl }, null)
    indexDocument(m, id)
    m.record({ verb: 'document.created', resource: { type: 'document', id }, data: { title: input.title, revision: 1 } })
    return id
  })
  return { document: getDocument(ctx, id), activityId }
}

/** Every content change becomes a new immutable full-snapshot revision. */
export function updateDocument(ctx: AppContext, actor: Actor, id: string, patch: z.infer<typeof updateDocumentInput>): DocumentMutationResult {
  const { activityId } = mutate(ctx, actor, (m) => {
    const row = requireDocRow(m.db, m.workspaceId, id)
    if (row.archived_at) throw new AliceError('INVALID_STATE', `Document ${id} is archived; restore it before editing`)
    const current = { title: row.title, body: row.body, sourceUrl: row.source_url }
    const changes = diff(current, patch)
    if (Object.keys(changes).length === 0) return
    const next = {
      title: patch.title ?? current.title,
      body: patch.body ?? current.body,
      sourceUrl: patch.sourceUrl === undefined ? current.sourceUrl : patch.sourceUrl,
    }
    if (!next.body.trim() && !next.sourceUrl) throw new AliceError('VALIDATION_ERROR', DOCUMENT_CONTENT_MESSAGE)
    const revision = row.revision + 1
    writeRevision(m, id, revision, next, null)
    m.db
      .prepare('UPDATE documents SET title = ?, body = ?, source_url = ?, revision = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(next.title, next.body, next.sourceUrl, revision, actor.id, m.now, id)
    indexDocument(m, id)
    // body อาจยาวมาก: เก็บแค่ว่ามีการแก้ ไม่เก็บเนื้อหาซ้ำใน activity
    const summary = Object.fromEntries(
      Object.entries(changes).map(([k, v]) => [k, k === 'body' ? { fromLength: String(v.from).length, toLength: String(v.to).length } : v]),
    )
    m.record({ verb: 'document.updated', resource: { type: 'document', id }, data: { changes: summary, revision } })
  })
  return { document: getDocument(ctx, id), activityId }
}

export function restoreDocumentRevision(ctx: AppContext, actor: Actor, id: string, number: number): DocumentMutationResult {
  const { activityId } = mutate(ctx, actor, (m) => {
    const row = requireDocRow(m.db, m.workspaceId, id)
    if (row.archived_at) throw new AliceError('INVALID_STATE', `Document ${id} is archived; restore it before restoring a revision`)
    const rev = m.db.prepare('SELECT title, body, source_url FROM document_revisions WHERE document_id = ? AND number = ?').get(id, number) as
      | { title: string; body: string; source_url: string | null }
      | undefined
    if (!rev) throw new AliceError('NOT_FOUND', `Revision ${number} of document ${id} not found`)
    const revision = row.revision + 1
    writeRevision(m, id, revision, { title: rev.title, body: rev.body, sourceUrl: rev.source_url }, number)
    m.db
      .prepare('UPDATE documents SET title = ?, body = ?, source_url = ?, revision = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(rev.title, rev.body, rev.source_url, revision, actor.id, m.now, id)
    indexDocument(m, id)
    m.record({ verb: 'document.revision_restored', resource: { type: 'document', id }, data: { restoredFrom: number, revision, title: rev.title } })
  })
  return { document: getDocument(ctx, id), activityId }
}

export function setDocumentArchived(ctx: AppContext, actor: Actor, id: string, archived: boolean): DocumentMutationResult {
  const { activityId } = mutate(ctx, actor, (m) => {
    const row = requireDocRow(m.db, m.workspaceId, id)
    if (archived === (row.archived_at !== null)) return
    m.db.prepare('UPDATE documents SET archived_at = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(archived ? m.now : null, actor.id, m.now, id)
    indexDocument(m, id)
    m.record({ verb: archived ? 'document.archived' : 'document.restored', resource: { type: 'document', id }, data: { title: row.title } })
  })
  return { document: getDocument(ctx, id), activityId }
}

export function listRevisions(ctx: AppContext, id: string, options: { cursor?: string | null; limit?: number } = {}): Page<DocumentRevision> {
  requireDocRow(ctx.db, ctx.workspaceId, id)
  const limit = options.limit ?? 50
  const before = Number(decodeCursor(options.cursor)?.[0] ?? Number.MAX_SAFE_INTEGER)
  const rows = ctx.db
    .prepare(
      `SELECT r.*, ${actorCols('a', 'created_by')} FROM document_revisions r JOIN actors a ON a.id = r.created_by
       WHERE r.document_id = ? AND r.number < ? ORDER BY r.number DESC LIMIT ?`,
    )
    .all(id, before, limit + 1) as Array<Record<string, any>>
  const page = rows.slice(0, limit)
  return {
    items: page.map((r) => ({
      id: r.id,
      number: r.number,
      title: r.title,
      body: r.body,
      sourceUrl: r.source_url,
      restoredFrom: r.restored_from,
      createdAt: r.created_at,
      createdBy: actorRefFrom(r, 'created_by')!,
    })),
    nextCursor: rows.length > limit ? encodeCursor([page[page.length - 1].number]) : null,
  }
}

export function listDocuments(ctx: AppContext, input: z.infer<typeof listDocumentsInput>): Page<DocumentSummary> {
  const limit = input.limit ?? 50
  const where = ['d.workspace_id = ?']
  const params: unknown[] = [ctx.workspaceId]
  if (input.archived === 'active') where.push('d.archived_at IS NULL')
  else if (input.archived === 'archived') where.push('d.archived_at IS NOT NULL')
  if (input.taskId) {
    where.push('d.id IN (SELECT document_id FROM task_documents WHERE task_id = ?)')
    params.push(input.taskId)
  }
  if (input.projectId) {
    where.push('d.id IN (SELECT document_id FROM project_documents WHERE project_id = ?)')
    params.push(input.projectId)
  }
  if (input.q) {
    const { sql, params: p } = matchClauses(compileQuery(input.q))
    if (sql.length) {
      where.push(`d.id IN (SELECT sd.resource_id FROM search_index s JOIN search_docs sd ON sd.rowid = s.rowid WHERE sd.kind = 'document' AND ${sql.join(' AND ')})`)
      params.push(...p)
    }
  }
  const cursor = decodeCursor(input.cursor)
  if (cursor?.length === 2) {
    where.push('(d.updated_at < ? OR (d.updated_at = ? AND d.id < ?))')
    params.push(cursor[0], cursor[0], cursor[1])
  }
  const rows = ctx.db.prepare(`${DOC_SELECT} WHERE ${where.join(' AND ')} ORDER BY d.updated_at DESC, d.id DESC LIMIT ?`).all(...params, limit + 1) as DocRow[]
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return { items: page.map(toSummary), nextCursor: rows.length > limit ? encodeCursor([last.updated_at, last.id]) : null }
}

// ---------- Links ----------

export interface LinkResult {
  document: DocumentDetail
  /** False when the link already existed (link) or did not exist (unlink). */
  changed: boolean
  activityId: string | null
}

function resolveTarget(m: Mutation, target: { taskId?: string; projectId?: string }) {
  if (target.taskId) {
    const task = requireTaskRow(m.db, m.workspaceId, target.taskId)
    return { table: 'task_documents', column: 'task_id', id: task.id, type: 'task' as const, label: task.title }
  }
  const project = findProjectRow(m.db, m.workspaceId, target.projectId!)
  if (!project) throw new AliceError('NOT_FOUND', `Project ${target.projectId} not found`)
  return { table: 'project_documents', column: 'project_id', id: project.id, type: 'project' as const, label: project.name }
}

/** Untyped, idempotent many-to-many link. The event is recorded on the task/project so it shows in its history. */
export function linkDocument(ctx: AppContext, actor: Actor, documentId: string, target: { taskId?: string; projectId?: string }): LinkResult {
  const { value: changed, activityId } = mutate(ctx, actor, (m) => {
    const doc = requireDocRow(m.db, m.workspaceId, documentId)
    const t = resolveTarget(m, target)
    const result = m.db
      .prepare(`INSERT OR IGNORE INTO ${t.table} (${t.column}, document_id, created_by, created_at) VALUES (?, ?, ?, ?)`)
      .run(t.id, documentId, actor.id, m.now)
    if (result.changes === 0) return false
    m.record({
      verb: 'document.linked',
      resource: { type: t.type, id: t.id },
      data: { documentId, title: doc.title, target: t.label },
      alsoInvalidate: [{ type: 'document', id: documentId }],
    })
    return true
  })
  return { document: getDocument(ctx, documentId), changed, activityId }
}

export function unlinkDocument(ctx: AppContext, actor: Actor, documentId: string, target: { taskId?: string; projectId?: string }): LinkResult {
  const { value: changed, activityId } = mutate(ctx, actor, (m) => {
    const doc = requireDocRow(m.db, m.workspaceId, documentId)
    const t = resolveTarget(m, target)
    const result = m.db.prepare(`DELETE FROM ${t.table} WHERE ${t.column} = ? AND document_id = ?`).run(t.id, documentId)
    if (result.changes === 0) return false
    m.record({
      verb: 'document.unlinked',
      resource: { type: t.type, id: t.id },
      data: { documentId, title: doc.title, target: t.label },
      alsoInvalidate: [{ type: 'document', id: documentId }],
    })
    return true
  })
  return { document: getDocument(ctx, documentId), changed, activityId }
}
