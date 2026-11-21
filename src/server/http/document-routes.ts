import type { FastifyInstance } from 'fastify'
import * as z from 'zod'
import {
  createDocumentInput,
  clearDocumentReviewInput,
  cursorSchema,
  documentLinkInput,
  idSchema,
  limitSchema,
  listDocumentsInput,
  reviewDocumentInput,
  updateDocumentInput,
} from '../../shared/contracts'
import type { AppContext } from '../context'
import { listActivity } from '../domain/activity'
import {
  createDocument,
  clearDocumentReview,
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
import { requireAuth } from './auth'
import { parse } from './validate'

const idParam = z.object({ id: idSchema })
const revParam = z.object({ id: idSchema, number: z.coerce.number().int().min(1) })

export function registerDocumentRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/documents', async (req) => {
    requireAuth(req)
    return listDocuments(ctx, parse(listDocumentsInput, req.query))
  })
  app.post('/documents', async (req, reply) => {
    const actor = requireAuth(req)
    return reply.status(201).send(createDocument(ctx, actor, parse(createDocumentInput, req.body)))
  })
  app.get('/documents/:id', async (req) => {
    requireAuth(req)
    return { document: getDocument(ctx, parse(idParam, req.params).id) }
  })
  app.patch('/documents/:id', async (req) => {
    const actor = requireAuth(req)
    return updateDocument(ctx, actor, parse(idParam, req.params).id, parse(updateDocumentInput, req.body))
  })
  app.post('/documents/:id/review', async (req) =>
    reviewDocument(ctx, requireAuth(req), parse(idParam, req.params).id, parse(reviewDocumentInput, req.body)),
  )
  app.delete('/documents/:id/review', async (req) =>
    clearDocumentReview(ctx, requireAuth(req), parse(idParam, req.params).id, parse(clearDocumentReviewInput, req.body)),
  )
  app.post('/documents/:id/archive', async (req) => setDocumentArchived(ctx, requireAuth(req), parse(idParam, req.params).id, true))
  app.post('/documents/:id/restore', async (req) => setDocumentArchived(ctx, requireAuth(req), parse(idParam, req.params).id, false))
  app.get('/documents/:id/revisions', async (req) => {
    requireAuth(req)
    const q = parse(z.object({ cursor: cursorSchema, limit: limitSchema }), req.query)
    return listRevisions(ctx, parse(idParam, req.params).id, q)
  })
  app.post('/documents/:id/revisions/:number/restore', async (req) => {
    const { id, number } = parse(revParam, req.params)
    return restoreDocumentRevision(ctx, requireAuth(req), id, number)
  })
  app.post('/documents/:id/links', async (req) => linkDocument(ctx, requireAuth(req), parse(idParam, req.params).id, parse(documentLinkInput, req.body)))
  app.delete('/documents/:id/links', async (req) =>
    unlinkDocument(ctx, requireAuth(req), parse(idParam, req.params).id, parse(documentLinkInput, req.body)),
  )
  app.get('/documents/:id/activity', async (req) => {
    requireAuth(req)
    const { id } = parse(idParam, req.params)
    getDocument(ctx, id)
    const q = parse(z.object({ cursor: cursorSchema, limit: limitSchema }), req.query)
    return listActivity(ctx.db, ctx.workspaceId, { resourceType: 'document', resourceId: id, ...q })
  })
}
