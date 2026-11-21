import * as z from 'zod'
import {
  clearDocumentReviewInput,
  createDocumentInput,
  cursorSchema,
  idSchema,
  limitSchema,
  listDocumentsInput,
  reviewDocumentInput,
  updateDocumentInput,
} from '../../shared/contracts'
import {
  clearDocumentReview,
  createDocument,
  getDocument,
  linkDocument,
  listDocuments,
  listRevisions,
  reviewDocument,
  restoreDocumentRevision,
  setDocumentArchived,
  unlinkDocument,
  updateDocument,
} from '../domain/documents'
import { defineTool } from './registry'

export const DEFAULT_DOCUMENT_CHARS = 20_000
const byId = z.object({ id: idSchema }).strict()
const linkInput = z
  .object({ id: idSchema.describe('Document id'), taskId: idSchema.optional(), projectId: idSchema.optional() })
  .strict()
  .refine((v) => (v.taskId ? 1 : 0) + (v.projectId ? 1 : 0) === 1, { message: 'Provide exactly one of taskId or projectId' })

/** Returns a window of a document body with explicit truncation metadata. */
export function windowBody(body: string, offset: number, maxChars: number) {
  const slice = body.slice(offset, offset + maxChars)
  const end = offset + slice.length
  return {
    body: slice,
    bodyWindow: {
      offset,
      returnedChars: slice.length,
      totalChars: body.length,
      truncated: end < body.length,
      nextOffset: end < body.length ? end : null,
    },
  }
}

export const DOCUMENT_TOOLS = [
  defineTool({
    name: 'search_documents',
    title: 'Search documents',
    description: 'List or full-text search documents (summaries with excerpts). Filter by linked taskId or projectId. Use get_document to read the body.',
    input: listDocumentsInput.strict(),
    readOnly: true,
    handler: (ctx, _a, input) => listDocuments(ctx, input),
  }),
  defineTool({
    name: 'get_document',
    title: 'Get document',
    description:
      'Read a document with its links. Long bodies are windowed: bodyWindow reports totalChars and nextOffset; call again with offset=nextOffset to continue.',
    input: z
      .object({
        id: idSchema,
        offset: z.number().int().min(0).default(0),
        maxChars: z.number().int().min(100).max(100_000).default(DEFAULT_DOCUMENT_CHARS),
      })
      .strict(),
    readOnly: true,
    handler: (ctx, _a, input) => {
      const document = getDocument(ctx, input.id)
      return { document: { ...document, ...windowBody(document.body, input.offset, input.maxChars) } }
    },
  }),
  defineTool({
    name: 'create_document',
    title: 'Create document',
    description: 'Create a Markdown document. Requires a body or a sourceUrl. Link it afterwards with link_document.',
    input: createDocumentInput,
    handler: (ctx, actor, input) => createDocument(ctx, actor, input),
  }),
  defineTool({
    name: 'update_document',
    title: 'Update document',
    description: 'Edit a document. Every change creates a new immutable revision; send the complete new body.',
    input: updateDocumentInput.extend({ id: idSchema }),
    handler: (ctx, actor, { id, ...patch }) => updateDocument(ctx, actor, id, patch),
  }),
  defineTool({
    name: 'review_document',
    title: 'Review document',
    description: 'Record a review of the expected content revision and, by default, mark the document current.',
    input: reviewDocumentInput.extend({ id: idSchema }),
    handler: (ctx, actor, { id, ...input }) => reviewDocument(ctx, actor, id, input),
  }),
  defineTool({
    name: 'clear_document_review',
    title: 'Clear document review',
    description: 'Clear review audit fields for the expected revision. A current document becomes unreviewed.',
    input: clearDocumentReviewInput.extend({ id: idSchema }),
    handler: (ctx, actor, { id, ...input }) => clearDocumentReview(ctx, actor, id, input),
  }),
  defineTool({
    name: 'archive_document',
    title: 'Archive document',
    description: 'Archive a document (reversible).',
    input: byId,
    handler: (ctx, actor, input) => setDocumentArchived(ctx, actor, input.id, true),
  }),
  defineTool({
    name: 'restore_document',
    title: 'Restore document',
    description: 'Restore an archived document.',
    input: byId,
    handler: (ctx, actor, input) => setDocumentArchived(ctx, actor, input.id, false),
  }),
  defineTool({
    name: 'list_document_revisions',
    title: 'List document revisions',
    description: 'List full revision snapshots of a document, newest first.',
    input: z.object({ id: idSchema, cursor: cursorSchema, limit: limitSchema }).strict(),
    readOnly: true,
    handler: (ctx, _a, input) => listRevisions(ctx, input.id, input),
  }),
  defineTool({
    name: 'restore_document_revision',
    title: 'Restore document revision',
    description: 'Make an older revision current again. This creates a new revision; history is never rewritten.',
    input: z.object({ id: idSchema, revision: z.number().int().min(1) }).strict(),
    handler: (ctx, actor, input) => restoreDocumentRevision(ctx, actor, input.id, input.revision),
  }),
  defineTool({
    name: 'link_document',
    title: 'Link document',
    description: 'Link a document to a task or a project (untyped, many-to-many, idempotent).',
    input: linkInput,
    handler: (ctx, actor, { id, ...target }) => linkDocument(ctx, actor, id, target),
  }),
  defineTool({
    name: 'unlink_document',
    title: 'Unlink document',
    description: 'Remove a link between a document and a task or project. Neither side is deleted.',
    input: linkInput,
    handler: (ctx, actor, { id, ...target }) => unlinkDocument(ctx, actor, id, target),
  }),
]

