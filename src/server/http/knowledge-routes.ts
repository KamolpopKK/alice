import { knowledgeContextInput } from '../../shared/contracts'
import { getKnowledgeContext } from '../domain/knowledge'
import { documentContentInput, documentOutlineInput, documentPreviewInput } from '../../shared/contracts'
import { getDocumentContent, getDocumentOutline, getDocumentPreview } from '../domain/document-content'
import { listDocumentBacklinksInput } from '../../shared/contracts'
import { listDocumentBacklinks, listDocumentTopics } from '../domain/document-links'
import { listTopicDocumentsInput, putTopicDocumentInput } from '../../shared/contracts'
import { listTopicDocuments, putTopicDocument, removeTopicDocument } from '../domain/knowledge'
import type { FastifyInstance } from 'fastify'
import * as z from 'zod'
import { idSchema, createKnowledgeTopicInput, updateKnowledgeTopicInput, topicMutationInput, listKnowledgeTopicsInput } from '../../shared/contracts'
import type { AppContext } from '../context'
import { archiveKnowledgeTopic, createKnowledgeTopic, getKnowledgeTopic, listKnowledgeTopics, updateKnowledgeTopic } from '../domain/knowledge'
import { requireAuth } from './auth'
import { parse } from './validate'

export function registerKnowledgeRoutes(app: FastifyInstance, ctx: AppContext) {
  for (const [path, read] of [['backlinks', listDocumentBacklinks], ['topics', listDocumentTopics]] as const) {
    app.get(`/documents/:id/${path}`, async (req) => {
      requireAuth(req)
      return read(ctx, parse(z.object({ id: idSchema }), req.params).id, parse(listDocumentBacklinksInput, req.query))
    })
  }
  app.get('/documents/:id/content', async (req) => {
    requireAuth(req)
    return getDocumentContent(ctx, parse(z.object({ id: idSchema }), req.params).id, parse(documentContentInput, req.query))
  })
  app.get('/documents/:id/outline', async (req) => {
    requireAuth(req)
    return getDocumentOutline(ctx, parse(z.object({ id: idSchema }), req.params).id, parse(documentOutlineInput, req.query))
  })
  app.get('/documents/:id/preview', async (req) => {
    requireAuth(req)
    return getDocumentPreview(ctx, parse(z.object({ id: idSchema }), req.params).id, parse(documentPreviewInput, req.query))
  })
  const project = z.object({ projectId: idSchema })
  app.get('/projects/:projectId/knowledge/context', async (req) => {
    requireAuth(req)
    return getKnowledgeContext(ctx, parse(project, req.params).projectId, parse(knowledgeContextInput, req.query))
  })
  const topic = z.object({ topicId: idSchema })
  const member = topic.extend({ documentId: idSchema })
  app.get('/knowledge/topics/:topicId/documents', async (req) => {
    requireAuth(req)
    return listTopicDocuments(ctx, parse(topic, req.params).topicId, parse(listTopicDocumentsInput, req.query))
  })
  app.put('/knowledge/topics/:topicId/documents/:documentId', async (req) => {
    const actor = requireAuth(req)
    const p = parse(member, req.params)
    return putTopicDocument(ctx, actor, p.topicId, p.documentId, parse(putTopicDocumentInput, req.body))
  })
  app.delete('/knowledge/topics/:topicId/documents/:documentId', async (req) => {
    const actor = requireAuth(req)
    const p = parse(member, req.params)
    return removeTopicDocument(ctx, actor, p.topicId, p.documentId, parse(topicMutationInput, req.body))
  })
  app.get('/projects/:projectId/knowledge/topics', async (req) => {
    requireAuth(req)
    return listKnowledgeTopics(ctx, parse(project, req.params).projectId, parse(listKnowledgeTopicsInput, req.query))
  })
  app.post('/projects/:projectId/knowledge/topics', async (req, reply) => reply.status(201).send(createKnowledgeTopic(ctx, requireAuth(req), parse(project, req.params).projectId, parse(createKnowledgeTopicInput, req.body))))
  app.get('/knowledge/topics/:topicId', async (req) => {
    requireAuth(req)
    return { topic: getKnowledgeTopic(ctx, parse(topic, req.params).topicId) }
  })
  app.patch('/knowledge/topics/:topicId', async (req) => updateKnowledgeTopic(ctx, requireAuth(req), parse(topic, req.params).topicId, parse(updateKnowledgeTopicInput, req.body)))
  for (const action of ['archive', 'restore'] as const) {
    app.post(`/knowledge/topics/:topicId/${action}`, async (req) => archiveKnowledgeTopic(ctx, requireAuth(req), parse(topic, req.params).topicId, action === 'archive', parse(topicMutationInput, req.body)))
  }
}
