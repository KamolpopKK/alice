import { TASK_PRIORITIES, TASK_SORTS, TASK_STATUSES, type Task } from '../../shared/contracts'
import { CliContext, parseCommand } from '../context'
import { CliError } from '../errors'
import { confirm } from '../output'
import { collect, itemBudget, listValues, readMarkdown, requireId, resolveActor, resolveProject, shortDate } from './shared'

export const TASK_HELP = `Usage: alice task <command>

  list [--status S]... [--priority P]... [--project ID|NAME]... [--assignee ID|NAME|me|none]...
       [--label L]... [--q TEXT] [--parent ID] [--archived active|archived|all]
       [--sort ${TASK_SORTS.join('|')}] [--order asc|desc] [--limit N | --all]
  show ID [--comments]             context ID [--max-chars N]   (task, project, relations, documents, recent comments)
  create --title TITLE [--description TEXT | --description-file PATH|-] [--project ID|NAME]
         [--status S] [--priority P] [--due YYYY-MM-DD] [--assignee ID|NAME|me] [--label L]... [--parent ID]
  update ID [--title] [--description | --description-file] [--project] [--status] [--priority]
            [--due DATE | --no-due] [--label L]... [--clear-labels]
  assign ID ACTOR|me|none          claim ID
  comment ID (--body TEXT | --body-file PATH|-)
  comments ID [--limit N | --all]
  complete ID [--summary TEXT | --summary-file PATH|-]
  archive ID [--yes]               restore ID
  parent ID PARENT_ID|none         block ID --by BLOCKER_ID     unblock ID --by BLOCKER_ID
  relations ID                     activity ID [--limit N | --all]

Statuses: ${TASK_STATUSES.join(', ')}. Priorities: ${TASK_PRIORITIES.join(', ')}.`

const checkEnum = (value: string | undefined, allowed: readonly string[], flag: string) => {
  if (value !== undefined && !allowed.includes(value)) throw new CliError(`${flag} must be one of: ${allowed.join(', ')}`)
  return value
}

export function taskColumns() {
  return [
    { header: 'ID', value: (t: Task) => t.id },
    { header: 'STATUS', value: (t: Task) => t.status },
    { header: 'PRIORITY', value: (t: Task) => t.priority },
    { header: 'TITLE', value: (t: Task) => t.title, max: 50 },
    { header: 'ASSIGNEE', value: (t: Task) => (t.assignee ? `${t.assignee.displayName}${t.assignee.kind === 'agent' ? ' (agent)' : ''}` : ''), max: 24 },
    { header: 'PROJECT', value: (t: Task) => t.project.name, max: 20 },
    { header: 'DUE', value: (t: Task) => shortDate(t.dueAt) },
  ]
}

export async function taskCommand(ctx: CliContext, args: string[]): Promise<number> {
  const [sub, ...rest] = args
  const { out } = ctx
  const client = () => ctx.client()
  const showTask = (t: Task, extra?: Record<string, unknown>) =>
    out.value(extra ? { ...t, ...extra } : t, () => {
      out.details([
        ['Task', t.title],
        ['Id', t.id],
        ['Status', t.status + (t.archivedAt ? ' (archived)' : '')],
        ['Priority', t.priority],
        ['Project', `${t.project.name} (${t.project.id})`],
        ['Assignee', t.assignee ? `${t.assignee.displayName}${t.assignee.kind === 'agent' ? ' (agent)' : ''}` : null],
        ['Due', shortDate(t.dueAt)],
        ['Labels', t.labels.join(', ')],
        ['Parent', t.parentId],
        ['Subtasks', t.childCount],
        ['Open blockers', t.openBlockerCount],
        ['Created', `${t.createdAt} by ${t.createdBy.displayName}`],
        ['Updated', `${t.updatedAt} by ${t.updatedBy.displayName}`],
      ])
      if (t.description) out.line(`\n${t.description}`)
    })

  switch (sub) {
    case 'list':
    case 'ls': {
      const { values } = parseCommand(rest, {
        status: { type: 'string', multiple: true },
        priority: { type: 'string', multiple: true },
        project: { type: 'string', multiple: true },
        assignee: { type: 'string', multiple: true },
        label: { type: 'string', multiple: true },
        q: { type: 'string' },
        parent: { type: 'string' },
        archived: { type: 'string', default: 'active' },
        sort: { type: 'string' },
        order: { type: 'string' },
        limit: { type: 'string' },
        all: { type: 'boolean' },
      })
      const statuses = listValues(values.status)
      statuses?.forEach((s) => checkEnum(s, TASK_STATUSES, '--status'))
      const priorities = listValues(values.priority)
      priorities?.forEach((p) => checkEnum(p, TASK_PRIORITIES, '--priority'))
      checkEnum(values.sort, TASK_SORTS, '--sort')
      checkEnum(values.order, ['asc', 'desc'], '--order')
      checkEnum(values.archived, ['active', 'archived', 'all'], '--archived')
      const c = client()
      const projectIds = listValues(values.project) ? await Promise.all(listValues(values.project)!.map((p) => resolveProject(c, p))) : undefined
      const assignees = listValues(values.assignee)
        ? await Promise.all(listValues(values.assignee)!.map(async (a) => (await resolveActor(c, a)) ?? 'none'))
        : undefined
      const budget = itemBudget(values.limit, values.all)
      const items = await collect(out, budget, (cursor, limit) =>
        c.tasks.list({
          status: statuses as Task['status'][] | undefined,
          priority: priorities as Task['priority'][] | undefined,
          projectId: projectIds,
          assigneeId: assignees,
          label: listValues(values.label),
          q: values.q,
          parentId: values.parent,
          archived: values.archived as 'active',
          sort: values.sort as 'updated' | undefined,
          order: values.order as 'asc' | undefined,
          cursor,
          limit,
        }),
      )
      out.list(items, taskColumns(), 'No matching tasks.')
      return 0
    }
    case 'show': {
      const { values, positionals } = parseCommand(rest, { comments: { type: 'boolean' } }, 1)
      const c = client()
      const id = requireId(positionals[0], 'Task')
      const task = await c.tasks.get(id)
      if (!values.comments) {
        showTask(task)
        return 0
      }
      const comments = await collect(out, 1000, (cursor, limit) => c.tasks.comments(id, { cursor, limit }))
      showTask(task, { comments })
      if (!out.machine) {
        for (const cm of comments) {
          out.line(`\n${out.bold(`${cm.author.displayName}${cm.author.kind === 'agent' ? ' (agent)' : ''}`)} ${out.dim(cm.createdAt)}${cm.kind === 'completion_summary' ? ' — completion summary' : ''}`)
          out.line(cm.body)
        }
      }
      return 0
    }
    case 'create': {
      const { values } = parseCommand(rest, {
        title: { type: 'string' },
        description: { type: 'string' },
        'description-file': { type: 'string' },
        project: { type: 'string' },
        status: { type: 'string' },
        priority: { type: 'string' },
        due: { type: 'string' },
        assignee: { type: 'string' },
        label: { type: 'string', multiple: true },
        parent: { type: 'string' },
      })
      if (!values.title) throw new CliError('--title is required')
      checkEnum(values.status, TASK_STATUSES, '--status')
      checkEnum(values.priority, TASK_PRIORITIES, '--priority')
      const c = client()
      const res = await c.tasks.create({
        title: values.title,
        description: readMarkdown(values.description, values['description-file'], 'description') ?? '',
        projectId: values.project ? await resolveProject(c, values.project) : undefined,
        status: values.status as Task['status'] | undefined,
        priority: values.priority as Task['priority'] | undefined,
        dueAt: values.due,
        assigneeId: values.assignee ? await resolveActor(c, values.assignee) : undefined,
        labels: listValues(values.label) ?? [],
        parentId: values.parent,
      })
      showTask(res.task)
      return 0
    }
    case 'update': {
      const { values, positionals } = parseCommand(
        rest,
        {
          title: { type: 'string' },
          description: { type: 'string' },
          'description-file': { type: 'string' },
          project: { type: 'string' },
          status: { type: 'string' },
          priority: { type: 'string' },
          due: { type: 'string' },
          'no-due': { type: 'boolean' },
          label: { type: 'string', multiple: true },
          'clear-labels': { type: 'boolean' },
        },
        1,
      )
      const id = requireId(positionals[0], 'Task')
      checkEnum(values.status, TASK_STATUSES, '--status')
      checkEnum(values.priority, TASK_PRIORITIES, '--priority')
      if (values.due !== undefined && values['no-due']) throw new CliError('Use either --due or --no-due')
      const c = client()
      const patch: Record<string, unknown> = {}
      if (values.title !== undefined) patch.title = values.title
      const description = readMarkdown(values.description, values['description-file'], 'description')
      if (description !== undefined) patch.description = description
      if (values.project !== undefined) patch.projectId = await resolveProject(c, values.project)
      if (values.status !== undefined) patch.status = values.status
      if (values.priority !== undefined) patch.priority = values.priority
      if (values.due !== undefined) patch.dueAt = values.due
      if (values['no-due']) patch.dueAt = null
      if (values['clear-labels']) patch.labels = []
      else if (values.label) patch.labels = listValues(values.label)
      if (Object.keys(patch).length === 0) throw new CliError('Nothing to update')
      showTask((await c.tasks.update(id, patch)).task)
      return 0
    }
    case 'assign': {
      const { positionals } = parseCommand(rest, {}, 2)
      const id = requireId(positionals[0], 'Task')
      if (!positionals[1]) throw new CliError('Assignee is required (an actor id, name, "me" or "none")')
      const c = client()
      const res = await c.tasks.update(id, { assigneeId: await resolveActor(c, positionals[1]) })
      out.value(res.task, () => out.line(res.task.assignee ? `Assigned ${res.task.id} to ${res.task.assignee.displayName}` : `Unassigned ${res.task.id}`))
      return 0
    }
    case 'context': {
      // งาน + project + parent/subtask + blocker + เอกสาร + comment ล่าสุด ในคำตอบเดียวที่มีเพดานขนาด
      const { values, positionals } = parseCommand(rest, { 'max-chars': { type: 'string' } }, 1)
      const opts: Record<string, number> = values['max-chars'] ? { maxChars: Number(values['max-chars']) } : {}
      const res = await client().tasks.context(requireId(positionals[0], 'Task'), opts)
      out.value(res, () => out.line(JSON.stringify(res, null, 2)))
      return 0
    }
    case 'claim': {
      const { positionals } = parseCommand(rest, {}, 1)
      const res = await client().tasks.claim(requireId(positionals[0], 'Task'))
      out.value(res.task, () => out.line(`Claimed ${res.task.id}: ${res.task.title} (now ${res.task.status})`))
      return 0
    }
    case 'comment': {
      const { values, positionals } = parseCommand(rest, { body: { type: 'string' }, 'body-file': { type: 'string' } }, 1)
      const body = readMarkdown(values.body, values['body-file'], 'body')
      if (body === undefined) throw new CliError('--body or --body-file is required')
      const res = await client().tasks.comment(requireId(positionals[0], 'Task'), body)
      out.value(res.comment, () => out.line(`Commented on ${res.comment.taskId} (${res.comment.id})`))
      return 0
    }
    case 'comments': {
      const { values, positionals } = parseCommand(rest, { limit: { type: 'string' }, all: { type: 'boolean' } }, 1)
      const c = client()
      const id = requireId(positionals[0], 'Task')
      const items = await collect(out, itemBudget(values.limit, values.all), (cursor, limit) => c.tasks.comments(id, { cursor, limit }))
      out.list(items, [
        { header: 'ID', value: (cm) => cm.id },
        { header: 'AUTHOR', value: (cm) => `${cm.author.displayName}${cm.author.kind === 'agent' ? ' (agent)' : ''}`, max: 24 },
        { header: 'KIND', value: (cm) => cm.kind },
        { header: 'CREATED', value: (cm) => cm.createdAt },
        { header: 'BODY', value: (cm) => cm.body, max: 60 },
      ], 'No comments.')
      return 0
    }
    case 'complete': {
      const { values, positionals } = parseCommand(rest, { summary: { type: 'string' }, 'summary-file': { type: 'string' } }, 1)
      const summary = readMarkdown(values.summary, values['summary-file'], 'summary')
      const res = await client().tasks.complete(requireId(positionals[0], 'Task'), summary)
      out.value({ task: res.task, comment: res.comment }, () => out.line(`Completed ${res.task.id}: ${res.task.title}`))
      return 0
    }
    case 'archive':
    case 'restore': {
      const { values, positionals } = parseCommand(rest, { yes: { type: 'boolean', short: 'y' } }, 1)
      const id = requireId(positionals[0], 'Task')
      if (sub === 'archive') await confirm(out, `Archive task ${id}?`, values.yes ?? false)
      const res = sub === 'archive' ? await client().tasks.archive(id) : await client().tasks.restore(id)
      out.value(res.task, () => out.line(`${sub === 'archive' ? 'Archived' : 'Restored'} ${res.task.id}: ${res.task.title}`))
      return 0
    }
    case 'parent': {
      const { positionals } = parseCommand(rest, {}, 2)
      const id = requireId(positionals[0], 'Task')
      if (!positionals[1]) throw new CliError('Parent task id (or "none") is required')
      const res = await client().tasks.setParent(id, positionals[1] === 'none' ? null : positionals[1])
      out.value(res.task, () => out.line(res.task.parentId ? `${res.task.id} is now a subtask of ${res.task.parentId}` : `${res.task.id} has no parent`))
      return 0
    }
    case 'block':
    case 'unblock': {
      const { values, positionals } = parseCommand(rest, { by: { type: 'string' } }, 1)
      const id = requireId(positionals[0], 'Task')
      if (!values.by) throw new CliError('--by BLOCKER_ID is required')
      const res = sub === 'block' ? await client().tasks.addBlocker(id, values.by) : await client().tasks.removeBlocker(id, values.by)
      out.value(res.task, () => out.line(sub === 'block' ? `${id} is now blocked by ${values.by}` : `${id} is no longer blocked by ${values.by}`))
      return 0
    }
    case 'relations': {
      const { positionals } = parseCommand(rest, {}, 1)
      const rel = await client().tasks.relations(requireId(positionals[0], 'Task'))
      out.value(rel, () => {
        const ref = (t: { id: string; title: string; status: string }) => `${t.id}  ${t.status.padEnd(11)}  ${t.title}`
        out.line(out.bold('Parent'))
        out.line(rel.parent ? `  ${ref(rel.parent)}` : '  —')
        for (const [label, list] of [['Subtasks', rel.children], ['Blocked by', rel.blockers], ['Blocks', rel.blocking]] as const) {
          out.line(out.bold(label))
          if (list.length === 0) out.line('  —')
          for (const t of list) out.line(`  ${ref(t)}`)
        }
      })
      return 0
    }
    case 'activity': {
      const { values, positionals } = parseCommand(rest, { limit: { type: 'string' }, all: { type: 'boolean' } }, 1)
      const c = client()
      const id = requireId(positionals[0], 'Task')
      const items = await collect(out, itemBudget(values.limit, values.all), (cursor, limit) => c.tasks.activity(id, { cursor, limit }))
      out.list(items, activityColumns(), 'No activity.')
      return 0
    }
    case undefined:
    case 'help':
      out.line(TASK_HELP)
      return sub ? 0 : 2
    default:
      throw new CliError(`Unknown task command: ${sub}`, 'usage', 'See: alice task help')
  }
}

export function activityColumns() {
  return [
    { header: 'TIME', value: (e: { createdAt: string }) => e.createdAt },
    { header: 'ACTOR', value: (e: { actor: { displayName: string; kind: string } | null }) => (e.actor ? `${e.actor.displayName}${e.actor.kind === 'agent' ? ' (agent)' : ''}` : 'system'), max: 24 },
    { header: 'VERB', value: (e: { verb: string }) => e.verb },
    { header: 'RESOURCE', value: (e: { resourceType: string; resourceId: string }) => `${e.resourceType} ${e.resourceId}` },
  ]
}
