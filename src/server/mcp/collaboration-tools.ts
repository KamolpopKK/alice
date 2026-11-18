import * as z from 'zod'
import { APPROVAL_STATUSES, approvalQuestionSchema, commentBodySchema, idSchema, limitSchema, listCommentsInput, taskContextInput } from '../../shared/contracts'
import { decideApproval, getApproval, listApprovals, requestApproval } from '../domain/approvals'
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
  defineTool({
    name: 'request_approval',
    title: 'Request approval',
    description:
      'Ask a person to approve something before you go on with a task (a risky change, a spend, a decision you should not make alone). ' +
      'It appears under "Waiting for you" on their Home. Name requestedOfId to ask one person, or leave it out to ask anyone. ' +
      'Then wait: check with get_approval or list_approvals { taskId } and follow the decision and its note.',
    input: z.object({ taskId: idSchema, question: approvalQuestionSchema, requestedOfId: idSchema.optional() }).strict(),
    handler: (ctx, actor, { taskId, ...input }) => requestApproval(ctx, actor, taskId, input),
  }),
  defineTool({
    name: 'get_approval',
    title: 'Get approval request',
    description: 'Get one approval request with its status (pending, approved, rejected, canceled), who decided and their note.',
    input: z.object({ id: idSchema }).strict(),
    readOnly: true,
    handler: (ctx, _a, input) => ({ approval: getApproval(ctx, input.id) }),
  }),
  defineTool({
    name: 'list_approvals',
    title: 'List approval requests',
    description: 'List approval requests, newest first, optionally for one task and/or one status.',
    input: z.object({ taskId: idSchema.optional(), status: z.enum(APPROVAL_STATUSES).optional(), limit: limitSchema }).strict(),
    readOnly: true,
    handler: (ctx, actor, input) => listApprovals(ctx, actor, input),
  }),
  defineTool({
    name: 'cancel_approval',
    title: 'Withdraw approval request',
    description: 'Withdraw a pending approval request you made (for example when it is no longer needed).',
    input: z.object({ id: idSchema }).strict(),
    handler: (ctx, actor, input) => decideApproval(ctx, actor, input.id, 'canceled'),
  }),
]
