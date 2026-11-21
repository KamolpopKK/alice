import type * as z from 'zod'
import {
  type DocumentRelation,
  type DocumentRelationType,
  type Page,
  type createDocumentRelationInput,
  type listDocumentRelationsInput,
  type removeDocumentRelationInput,
} from '../../shared/contracts'
import { AliceError } from '../../shared/errors'
import type { AppContext } from '../context'
import type { DB } from '../db/database'
import { mutate } from './activity'
import type { Actor } from './actors'
import { requireDocRow } from './documents'
import { actorCols, actorRefFrom, decodeCursor, encodeCursor } from './sql'

function requireMutableDocument(db: DB, workspaceId: string, id: string) {
  const row = requireDocRow(db, workspaceId, id)
  if (row.archived_at) throw new AliceError('INVALID_STATE', `Document ${id} is archived; restore it before changing relations`)
  return row
}

function storedPair(sourceId: string, targetId: string, type: DocumentRelationType): [string, string] {
  if (type !== 'related') return [sourceId, targetId]
  return sourceId < targetId ? [sourceId, targetId] : [targetId, sourceId]
}

function supersedesWouldCycle(db: DB, sourceId: string, targetId: string): boolean {
  return !!db
    .prepare(
      `WITH RECURSIVE chain(id) AS (
         VALUES (?)
         UNION
         SELECT r.target_document_id
         FROM document_relations r JOIN chain c ON r.source_document_id = c.id
         WHERE r.relation_type = 'supersedes'
       )
       SELECT 1 FROM chain WHERE id = ? LIMIT 1`,
    )
    .get(targetId, sourceId)
}

export interface DocumentRelationMutationResult {
  changed: boolean
  relation: { sourceId: string; targetId: string; type: DocumentRelationType }
  activityId: string | null
}

export function createDocumentRelation(
  ctx: AppContext,
  actor: Actor,
  sourceId: string,
  input: z.infer<typeof createDocumentRelationInput>,
): DocumentRelationMutationResult {
  if (input.type === 'supersedes' && input.acknowledgeSupersedes !== true) {
    throw new AliceError('INVALID_STATE', 'Creating a supersedes relation requires acknowledgeSupersedes: true because the target status will change')
  }
  const [storedSource, storedTarget] = storedPair(sourceId, input.targetId, input.type)
  const { value: changed, activityId } = mutate(ctx, actor, (m) => {
    const source = requireMutableDocument(m.db, m.workspaceId, sourceId)
    const target = requireMutableDocument(m.db, m.workspaceId, input.targetId)
    if (sourceId === input.targetId) throw new AliceError('INVALID_RELATIONSHIP', 'A document cannot relate to itself')
    if (input.type === 'supersedes' && supersedesWouldCycle(m.db, sourceId, input.targetId)) {
      throw new AliceError('RELATIONSHIP_CYCLE', `${sourceId} superseding ${input.targetId} would create a cycle`)
    }
    const inserted = m.db
      .prepare(
        `INSERT OR IGNORE INTO document_relations
          (source_document_id, target_document_id, relation_type, created_by, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(storedSource, storedTarget, input.type, actor.id, m.now)
    if (inserted.changes === 0) return false

    if (input.type === 'supersedes' && target.knowledge_status !== 'superseded') {
      m.db
        .prepare(`UPDATE documents SET knowledge_status = 'superseded', updated_by = ?, updated_at = ? WHERE id = ?`)
        .run(actor.id, m.now, target.id)
      m.record({
        verb: 'document.superseded',
        resource: { type: 'document', id: target.id },
        data: { supersededBy: source.id, title: source.title, previousStatus: target.knowledge_status },
        alsoInvalidate: [{ type: 'document', id: source.id }],
      })
    }
    m.record({
      verb: 'document.relation_added',
      resource: { type: 'document', id: source.id },
      data: { targetId: target.id, title: target.title, type: input.type },
      alsoInvalidate: [{ type: 'document', id: target.id }],
    })
    return true
  })
  return { changed, relation: { sourceId: storedSource, targetId: storedTarget, type: input.type }, activityId }
}

export function removeDocumentRelation(
  ctx: AppContext,
  actor: Actor,
  sourceId: string,
  input: z.infer<typeof removeDocumentRelationInput>,
): DocumentRelationMutationResult {
  const [storedSource, storedTarget] = storedPair(sourceId, input.targetId, input.type)
  const { value: changed, activityId } = mutate(ctx, actor, (m) => {
    const source = requireMutableDocument(m.db, m.workspaceId, sourceId)
    const target = requireMutableDocument(m.db, m.workspaceId, input.targetId)
    if (sourceId === input.targetId) throw new AliceError('INVALID_RELATIONSHIP', 'A document cannot relate to itself')
    const removed = m.db
      .prepare(
        `DELETE FROM document_relations
         WHERE source_document_id = ? AND target_document_id = ? AND relation_type = ?`,
      )
      .run(storedSource, storedTarget, input.type)
    if (removed.changes === 0) return false
    m.record({
      verb: 'document.relation_removed',
      resource: { type: 'document', id: source.id },
      data: { targetId: target.id, title: target.title, type: input.type },
      alsoInvalidate: [{ type: 'document', id: target.id }],
    })
    return true
  })
  return { changed, relation: { sourceId: storedSource, targetId: storedTarget, type: input.type }, activityId }
}

interface RelationRow {
  relation_type: DocumentRelationType
  created_at: string
  other_id: string
  other_title: string
  other_status: DocumentRelation['document']['status']
  other_archived_at: string | null
  created_by_id: string
  created_by_kind: DocumentRelation['createdBy']['kind']
  created_by_name: string
}

export function listDocumentRelations(
  ctx: AppContext,
  documentId: string,
  input: z.infer<typeof listDocumentRelationsInput>,
): Page<DocumentRelation> {
  requireDocRow(ctx.db, ctx.workspaceId, documentId)
  const limit = input.limit ?? 50
  const offset = Number(decodeCursor(input.cursor)?.[0] ?? 0) || 0
  const directionalColumn = input.direction === 'outgoing' ? 'r.source_document_id' : 'r.target_document_id'
  const otherColumn = input.direction === 'outgoing' ? 'r.target_document_id' : 'r.source_document_id'
  const where = [
    `((r.relation_type = 'related' AND (r.source_document_id = ? OR r.target_document_id = ?))
      OR (r.relation_type <> 'related' AND ${directionalColumn} = ?))`,
  ]
  const params: unknown[] = [documentId, documentId, documentId]
  if (input.type?.length) {
    where.push(`r.relation_type IN (${input.type.map(() => '?').join(',')})`)
    params.push(...input.type)
  }
  const relatedOther = `CASE WHEN r.source_document_id = ? THEN r.target_document_id ELSE r.source_document_id END`
  const rows = ctx.db
    .prepare(
      `SELECT r.relation_type, r.created_at,
         CASE WHEN r.relation_type = 'related' THEN ${relatedOther} ELSE ${otherColumn} END AS other_id,
         other.title AS other_title, other.knowledge_status AS other_status, other.archived_at AS other_archived_at,
         ${actorCols('creator', 'created_by')}
       FROM document_relations r
       JOIN documents other ON other.id = CASE WHEN r.relation_type = 'related' THEN ${relatedOther} ELSE ${otherColumn} END
       JOIN actors creator ON creator.id = r.created_by
       WHERE ${where.join(' AND ')}
       ORDER BY r.created_at, other_id, r.relation_type
       LIMIT ? OFFSET ?`,
    )
    .all(documentId, documentId, ...params, limit + 1, offset) as RelationRow[]
  const page = rows.slice(0, limit)
  return {
    items: page.map((row) => ({
      type: row.relation_type,
      direction: input.direction,
      document: { id: row.other_id, title: row.other_title, status: row.other_status, archivedAt: row.other_archived_at },
      createdAt: row.created_at,
      createdBy: actorRefFrom(row as unknown as Record<string, unknown>, 'created_by')!,
    })),
    nextCursor: rows.length > limit ? encodeCursor([offset + limit]) : null,
  }
}
