import * as z from 'zod'
import { idSchema, createKnowledgeTopicInput, updateKnowledgeTopicInput, topicMutationInput, listKnowledgeTopicsInput } from '../../shared/contracts'
import { archiveKnowledgeTopic, createKnowledgeTopic, getKnowledgeTopic, listKnowledgeTopics, updateKnowledgeTopic } from '../domain/knowledge'
import { defineTool } from './registry'

export const KNOWLEDGE_TOOLS = [
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
