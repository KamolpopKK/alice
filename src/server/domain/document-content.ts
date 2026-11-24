import type * as z from 'zod'
import type { DocumentContent, DocumentOutline, DocumentPreview, documentContentInput, documentOutlineInput, documentPreviewInput } from '../../shared/contracts'
import { parseDocumentMarkdown } from '../../shared/document-links'
import { AliceError } from '../../shared/errors'
import type { AppContext } from '../context'
import { findDocRow, requireDocRow, toSummary } from './documents'
import { decodeCursor, encodeCursor } from './sql'

export function windowBody(body: string, offset: number, maxChars: number) {
  const slice = body.slice(offset, offset + maxChars)
  const end = offset + slice.length
  return { body: slice, bodyWindow: { offset, returnedChars: slice.length, totalChars: body.length, truncated: end < body.length, nextOffset: end < body.length ? end : null } }
}
export function requireDocumentRevision(revision: number, expectedRevision?: number) {
  if (expectedRevision !== undefined && revision !== expectedRevision) throw new AliceError('CONFLICT', 'Document content changed; restart reading the actual revision', { currentRevision: revision })
}
export function getDocumentContent(ctx: AppContext, id: string, input: z.infer<typeof documentContentInput>): DocumentContent {
  const row = requireDocRow(ctx.db, ctx.workspaceId, id)
  requireDocumentRevision(row.revision, input.expectedRevision)
  return { document: { ...toSummary(row, ctx.db), ...windowBody(row.body, input.offset, input.maxChars) } }
}
export function getDocumentOutline(ctx: AppContext, id: string, input: z.infer<typeof documentOutlineInput>): DocumentOutline {
  const row = requireDocRow(ctx.db, ctx.workspaceId, id)
  requireDocumentRevision(row.revision, input.expectedRevision)
  let offset = 0
  if (input.cursor) {
    const c = decodeCursor(input.cursor)
    if (!c || c.length !== 3 || c[0] !== id || typeof c[1] !== 'number' || typeof c[2] !== 'number' || !Number.isSafeInteger(c[2]) || c[2] < 0) throw new AliceError('VALIDATION_ERROR', 'Invalid document outline cursor')
    requireDocumentRevision(row.revision, c[1])
    offset = c[2]
  }
  const headings = parseDocumentMarkdown(row.body, id).outline
  const limit = input.limit ?? 50
  const items = headings.slice(offset, offset + limit)
  return { document: toSummary(row, ctx.db), items, nextCursor: offset + items.length < headings.length ? encodeCursor([id, row.revision, offset + items.length]) : null }
}
export function getDocumentPreview(ctx: AppContext, id: string, input: z.infer<typeof documentPreviewInput>): DocumentPreview {
  const row = findDocRow(ctx.db, ctx.workspaceId, id)
  if (!row) return { state: 'unavailable', document: null, body: null, bodyWindow: null }
  requireDocumentRevision(row.revision, input.expectedRevision)
  const document = toSummary(row, ctx.db)
  if (row.archived_at) return { state: 'archived', document: { ...document, excerpt: '' }, body: null, bodyWindow: null }
  return { state: 'available', document, ...windowBody(row.body, 0, 2000) }
}
