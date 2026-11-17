import * as z from 'zod'
import { commentBodySchema, idSchema, listCommentsInput, taskContextInput } from '../../shared/contracts'
import { addComment, completeTask, listComments } from '../domain/comments'
import { getTaskContext } from '../domain/task-context'
import { defineTool } from './registry'

export const COLLABORATION_TOOLS = [
  defineTool({
    name: 'get_task_context',
    title: 'Get task context',
    description:
      'Everything needed to work on a task in one bounded response: task, project, parent/children/blockers, linked documents and recent comments. ' +
      'Content beyond maxChars is truncated and listed in budget.truncations, each with a continuation {tool, args} to fetch the rest.',
    input: taskContextInput.extend({ id: idSchema }),
    readOnly: true,
    handler: (ctx, _a, { id, ...opts }) => getTaskContext(ctx, id, opts),
  }),
  defineTool({
    name: 'add_comment',
    title: 'Add comment',
    description: 'Comment on a task: questions, decisions, progress. Comments are immutable and attributed to you. Plain @mentions do not notify anyone.',
    input: z.object({ taskId: idSchema, body: commentBodySchema }).strict(),
    handler: (ctx, actor, input) => addComment(ctx, actor, input.taskId, input.body),
  }),
  defineTool({
    name: 'list_comments',
    title: 'List comments',
    description: 'List comments on a task (oldest first by default; order "desc" for newest first). Paginated.',
    input: listCommentsInput.extend({ taskId: idSchema }).strict(),
    readOnly: true,
    handler: (ctx, _a, { taskId, ...input }) => listComments(ctx, taskId, input),
  }),
  defineTool({
    name: 'complete_task',
    title: 'Complete task',
    description:
      'Mark a task done with a required summary of what you delivered (links, files, decisions, follow-ups). ' +
      'The summary is posted as a comment; status, completion time and comment are recorded atomically.',
    input: z.object({ id: idSchema, summary: z.string().trim().min(1, 'A completion summary is required').max(20_000) }).strict(),
    handler: (ctx, actor, input) => completeTask(ctx, actor, input.id, input.summary),
  }),
]
