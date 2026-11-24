import { knowledgeContextInput } from '../../shared/contracts'
import { getKnowledgeContext } from '../domain/knowledge'
import { listTopicDocumentsInput, putTopicDocumentInput } from '../../shared/contracts'
import { listTopicDocuments, putTopicDocument, removeTopicDocument } from '../domain/knowledge'
import * as z from 'zod'
import { idSchema, createKnowledgeTopicInput, updateKnowledgeTopicInput, topicMutationInput, listKnowledgeTopicsInput } from '../../shared/contracts'
import { archiveKnowledgeTopic, createKnowledgeTopic, getKnowledgeTopic, listKnowledgeTopics, updateKnowledgeTopic } from '../domain/knowledge'
import { defineTool } from './registry'

export const KNOWLEDGE_TOOLS = [
  defineTool({ name: 'get_knowledge_context', title: 'Discover knowledge context', description: 'Discover bounded curated reading starts or lexical candidates, then read selected outlines/content at their actual revision. No semantic conclusions or full bodies.', input: knowledgeContextInput.extend({ projectId: idSchema }).strict(), readOnly: true, handler: (ctx, _a, { projectId, ...input }) => getKnowledgeContext(ctx, projectId, input) }),
  defineTool({
    name: 'list_topic_documents', title: 'List topic documents', description: 'Read an ordered list of existing documents with provenance and a revision-stable cursor.', input: listTopicDocumentsInput.extend({ topicId: idSchema }).strict(), readOnly: true,
    handler: (ctx, _a, { topicId, ...input }) => listTopicDocuments(ctx, topicId, input)
  }),
  defineTool({
    name: 'put_topic_document', title: 'Put topic document', description: 'Add or move an approved document reference. Omit beforeDocumentId to append. Never copies or reviews content.', input: putTopicDocumentInput.extend({ topicId: idSchema, documentId: idSchema }).strict(),
    handler: (ctx, a, { topicId, documentId, ...input }) => putTopicDocument(ctx, a, topicId, documentId, input)
  }),
  defineTool({
    name: 'remove_topic_document', title: 'Remove topic document', description: 'Remove an approved reading-list membership without changing its document.', input: topicMutationInput.extend({ topicId: idSchema, documentId: idSchema }).strict(),
    handler: (ctx, a, { topicId, documentId, ...input }) => removeTopicDocument(ctx, a, topicId, documentId, input)
  }),
  defineTool({
    name: 'list_knowledge_topics', title: 'List knowledge topics', description: 'List curated knowledge topics in one project.', input: listKnowledgeTopicsInput.extend({ projectId: idSchema }).strict(), readOnly: true,
    handler: (ctx, _a, input) => listKnowledgeTopics(ctx, input.projectId, input)
  }),
  defineTool({
    name: 'get_knowledge_topic', title: 'Get knowledge topic', description: 'Read a topic, not a document review or content copy.', input: z.object({ id: idSchema }).strict(), readOnly: true,
    handler: (ctx, _a, input) => ({ topic: getKnowledgeTopic(ctx, input.id) })
  }),
  defineTool({
    name: 'create_knowledge_topic', title: 'Create knowledge topic', description: 'Create an approved topic. Reuse mutationId when retrying.', input: createKnowledgeTopicInput.extend({ projectId: idSchema }).strict(),
    handler: (ctx, a, { projectId, ...input }) => createKnowledgeTopic(ctx, a, projectId, input)
  }),
  defineTool({
    name: 'update_knowledge_topic', title: 'Update knowledge topic', description: 'Update an approved topic using its actual revision.', input: updateKnowledgeTopicInput.extend({ id: idSchema }).strict(),
    handler: (ctx, a, { id, ...input }) => updateKnowledgeTopic(ctx, a, id, input)
  }),
  ...(['archive', 'restore'] as const).map((action) => defineTool({
    name: `${action}_knowledge_topic`, title: `${action} knowledge topic`, description: `${action} a topic without changing its documents.`, input: topicMutationInput.extend({ id: idSchema }).strict(),
    handler: (ctx, a, { id, ...input }) => archiveKnowledgeTopic(ctx, a, id, action === 'archive', input)
  })),
]
