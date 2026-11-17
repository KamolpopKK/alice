import * as z from 'zod'
import {
  archiveFilterSchema,
  createProjectInput,
  createTaskInput,
  idSchema,
  listTasksInput,
  searchInput,
  updateProjectInput,
  updateTaskInput,
} from '../../shared/contracts'
import { getPublicActor, listActors } from '../domain/actors'
import { createProject, getProject, listProjects, setProjectArchived, updateProject } from '../domain/projects'
import { search } from '../domain/search'
import { claimTask, createTask, getTask, listTasks, setTaskArchived, updateTask } from '../domain/tasks'
import { defineTool } from './registry'

const byId = z.object({ id: idSchema.describe('Resource identifier') }).strict()

export const CORE_TOOLS = [
  defineTool({
    name: 'whoami',
    title: 'Who am I',
    description: 'Return the agent identity this token authenticates as.',
    input: z.object({}).strict(),
    readOnly: true,
    handler: (ctx, actor) => ({ actor: getPublicActor(ctx.db, actor.id) }),
  }),
  defineTool({
    name: 'list_actors',
    title: 'List members',
    description: 'List active humans and agents in the workspace (for choosing an assignee).',
    input: z.object({ kind: z.enum(['human', 'agent']).optional() }).strict(),
    readOnly: true,
    handler: (ctx, _actor, input) => ({ items: listActors(ctx.db, ctx.workspaceId, { kind: input.kind }) }),
  }),

  // ---- projects ----
  defineTool({
    name: 'list_projects',
    title: 'List projects',
    description: 'List projects. The protected "Untitled" project (isSystem: true) is always first and receives tasks created without a project.',
    input: z.object({ archived: archiveFilterSchema }).strict(),
    readOnly: true,
    handler: (ctx, _a, input) => ({ items: listProjects(ctx, input) }),
  }),
  defineTool({
    name: 'get_project',
    title: 'Get project',
    description: 'Get one project by id.',
    input: byId,
    readOnly: true,
    handler: (ctx, _a, input) => ({ project: getProject(ctx, input.id) }),
  }),
  defineTool({
    name: 'create_project',
    title: 'Create project',
    description: 'Create a project with a name, Markdown description and labels.',
    input: createProjectInput.strict(),
    handler: (ctx, actor, input) => createProject(ctx, actor, input),
  }),
  defineTool({
    name: 'update_project',
    title: 'Update project',
    description: 'Update a project name, description or labels. The Untitled project cannot be renamed.',
    input: updateProjectInput.extend({ id: idSchema }),
    handler: (ctx, actor, { id, ...patch }) => updateProject(ctx, actor, id, patch),
  }),
  defineTool({
    name: 'archive_project',
    title: 'Archive project',
    description: 'Archive a project (reversible). The Untitled project cannot be archived.',
    input: byId,
    handler: (ctx, actor, input) => setProjectArchived(ctx, actor, input.id, true),
  }),
  defineTool({
    name: 'restore_project',
    title: 'Restore project',
    description: 'Restore an archived project.',
    input: byId,
    handler: (ctx, actor, input) => setProjectArchived(ctx, actor, input.id, false),
  }),

  // ---- tasks ----
  defineTool({
    name: 'list_tasks',
    title: 'List tasks',
    description:
      'List tasks with structured filters. Arrays match any value. assigneeId accepts actor ids, "me" or "none" (unassigned). ' +
      'Use status ["ready"] and assigneeId ["none"] to find claimable work. Results are paginated: pass nextCursor back as cursor.',
    input: listTasksInput.strict(),
    readOnly: true,
    handler: (ctx, actor, input) => listTasks(ctx, input, actor),
  }),
  defineTool({
    name: 'get_task',
    title: 'Get task',
    description: 'Get one task by id. Prefer get_task_context before starting work.',
    input: byId,
    readOnly: true,
    handler: (ctx, _a, input) => ({ task: getTask(ctx, input.id) }),
  }),
  defineTool({
    name: 'create_task',
    title: 'Create task',
    description: 'Create a task. Only title is required; without projectId it goes to the Untitled project. Agents cannot create tasks as done.',
    input: createTaskInput,
    handler: (ctx, actor, input) => createTask(ctx, actor, input),
  }),
  defineTool({
    name: 'update_task',
    title: 'Update task',
    description:
      'Update task fields (last write wins). Any status may move to any other, except that agents must use complete_task to mark work done. ' +
      'Set assigneeId or dueAt to null to clear them.',
    input: updateTaskInput.extend({ id: idSchema }),
    handler: (ctx, actor, { id, ...patch }) => updateTask(ctx, actor, id, patch),
  }),
  defineTool({
    name: 'archive_task',
    title: 'Archive task',
    description: 'Archive a task (reversible; tasks are never permanently deleted through MCP).',
    input: byId,
    handler: (ctx, actor, input) => setTaskArchived(ctx, actor, input.id, true),
  }),
  defineTool({
    name: 'restore_task',
    title: 'Restore task',
    description: 'Restore an archived task.',
    input: byId,
    handler: (ctx, actor, input) => setTaskArchived(ctx, actor, input.id, false),
  }),
  defineTool({
    name: 'claim_task',
    title: 'Claim task',
    description:
      'Atomically claim an unassigned task in status "ready": assigns you and moves it to "in_progress". ' +
      'Fails with CLAIM_FAILED if another actor claimed it first or it is not claimable — pick different work in that case.',
    input: byId,
    handler: (ctx, actor, input) => claimTask(ctx, actor, input.id),
  }),

  // ---- search ----
  defineTool({
    name: 'search',
    title: 'Search workspace',
    description: 'Full-text search across tasks, documents and comments. Matches substrings of 3+ characters in any language.',
    input: searchInput.strict(),
    readOnly: true,
    handler: (ctx, _a, input) => search(ctx, input),
  }),
]
