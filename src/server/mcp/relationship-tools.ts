import * as z from 'zod'
import { idSchema } from '../../shared/contracts'
import { addBlocker, getRelations, removeBlocker, setParent } from '../domain/relationships'
import { defineTool } from './registry'

export const RELATIONSHIP_TOOLS = [
  defineTool({
    name: 'get_task_relations',
    title: 'Get task relationships',
    description: 'Parent, children, blockers (tasks this one waits on) and blocking (tasks waiting on this one), including archived ones.',
    input: z.object({ id: idSchema }).strict(),
    readOnly: true,
    handler: (ctx, _a, input) => getRelations(ctx, input.id),
  }),
  defineTool({
    name: 'set_task_parent',
    title: 'Set task parent',
    description: 'Set or clear (parentId: null) the parent of a task to decompose work. Rejects self-links and cycles.',
    input: z.object({ id: idSchema, parentId: idSchema.nullable() }).strict(),
    handler: (ctx, actor, input) => setParent(ctx, actor, input.id, input.parentId),
  }),
  defineTool({
    name: 'add_task_blocker',
    title: 'Add blocker',
    description: 'Record that task `id` is blocked by task `blockerId`. Rejects self-links, duplicates (INVALID_RELATIONSHIP) and cycles (RELATIONSHIP_CYCLE).',
    input: z.object({ id: idSchema, blockerId: idSchema }).strict(),
    handler: (ctx, actor, input) => addBlocker(ctx, actor, input.id, input.blockerId),
  }),
  defineTool({
    name: 'remove_task_blocker',
    title: 'Remove blocker',
    description: 'Remove a blocking relationship.',
    input: z.object({ id: idSchema, blockerId: idSchema }).strict(),
    handler: (ctx, actor, input) => removeBlocker(ctx, actor, input.id, input.blockerId),
  }),
]
