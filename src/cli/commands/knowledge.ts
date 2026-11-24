import type { KnowledgeTopic, Page } from '../../shared/contracts'
import { CliContext, parseCommand } from '../context'
import { CliError } from '../errors'
import { confirm, type Column } from '../output'
import { checkEnum, numberFlag, readMarkdown, requireId, resolveProject } from './shared'

export const KNOWLEDGE_HELP = `Usage: alice knowledge <group> <command>

  topic list --project ID|NAME [--archived active|archived|all] [--limit N] [--cursor CURSOR]
  topic show ID
  topic create --project ID|NAME --name NAME [--description TEXT | --description-file PATH|-] --mutation-id ID
  topic update ID [--name NAME] [--description TEXT | --description-file PATH|-] --revision N --mutation-id ID
  topic archive ID --revision N --mutation-id ID [--yes]    topic restore ID --revision N --mutation-id ID
  member list TOPIC [--limit N] [--cursor CURSOR]
  member put|add|move TOPIC DOCUMENT [--before DOCUMENT] --revision N --mutation-id ID
  member remove TOPIC DOCUMENT --revision N --mutation-id ID
  context --project ID|NAME [--q QUERY] [--topic ID] [--limit 1..20] [--cursor CURSOR]

Mutations require the actual topic revision and a mutation ID (8..128 letters/digits/_.:-).
Reuse the same mutation ID and unchanged arguments for retries. After a conflict, reload first.
Lists return one bounded page with nextCursor; context returns candidates, not full bodies or a semantic answer.
Use --workspace and --as for the intended workspace and Local agent. --json/--jsonl preserve continuations.`

export function showPage<T>(ctx: CliContext, page: Page<T>, columns: Column<T>[], empty: string) {
  ctx.out.value(page, () => {
    ctx.out.list(page.items, columns, empty)
    if (page.nextCursor) ctx.out.info(`More results: pass --cursor ${page.nextCursor}`)
  })
}
export async function knowledgeCommand(ctx: CliContext, args: string[]): Promise<number> {
  const [group, sub, ...rest] = args
  if (!group || group === 'help' || sub === 'help') {
    ctx.out.line(KNOWLEDGE_HELP)
    return group ? 0 : 2
  }
  const c = () => ctx.client()
  const guard = (values: {
    revision?: string
    'mutation-id'?: string
  }) => {
    const mutationId = requireId(values['mutation-id'], 'Mutation (--mutation-id)')
    if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(mutationId)) throw new CliError('--mutation-id must be 8..128 letters/digits/_.:-')
    return { expectedRevision: numberFlag(values.revision, '--revision', 1, Number.MAX_SAFE_INTEGER), mutationId }
  }
  const output = (result: {
    topic: KnowledgeTopic
    changed?: boolean
  }) => ctx.out.value(result, () => ctx.out.details([
    ['Topic', result.topic.name], ['Id', result.topic.id], ['Revision', result.topic.revision], ['Description', result.topic.description], ['Archived', result.topic.archivedAt], ['Changed', result.changed],
  ]))
  if (group === 'context') {
    const { values } = parseCommand(args.slice(1), { project: { type: 'string' }, q: { type: 'string' }, topic: { type: 'string' }, limit: { type: 'string' }, cursor: { type: 'string' } })
    const client = c()
    const projectId = await resolveProject(client, requireId(values.project, 'Project (--project)'))
    const result = await client.knowledge.context(projectId, { q: values.q, topicId: values.topic, limit: numberFlag(values.limit, '--limit', 1, 20, 10), cursor: values.cursor })
    ctx.out.value(result, () => {
      ctx.out.line(`${result.project.name}: ${result.discovery}`)
      for (const topic of result.topics.items) ctx.out.line(`\n${topic.name} (revision ${topic.revision})\n${topic.description}`)
      ctx.out.list(result.candidates.items, [{ header: 'DOCUMENT', value: (r) => r.document.id }, { header: 'TITLE', value: (r) => r.document.title, max: 50 }, { header: 'REV', value: (r) => r.document.revision }, { header: 'STATUS', value: (r) => r.document.status }, { header: 'REASON', value: (r) => r.match?.field ?? 'curated order' }], 'No curated candidates. Use alice document search QUERY to search all Documents.')
      if (result.candidates.nextCursor) ctx.out.info(`More candidates: pass --cursor ${result.candidates.nextCursor}`)
      ctx.out.info(result.limitations.join(' '))
      ctx.out.info('Read selected evidence with alice document outline/content ID --revision N. Use --json for full provenance and continuations.')
    })
    return 0
  }
  if (group === 'topic') {
    if (sub === 'list') {
      const { values } = parseCommand(rest, { project: { type: 'string' }, archived: { type: 'string', default: 'active' }, limit: { type: 'string' }, cursor: { type: 'string' } })
      checkEnum(values.archived, ['active', 'archived', 'all'], '--archived')
      const client = c()
      const page = await client.knowledge.topics(await resolveProject(client, requireId(values.project, 'Project (--project)')), { archived: values.archived as 'active', limit: numberFlag(values.limit, '--limit', 1, 200, 50), cursor: values.cursor })
      showPage(ctx, page, [{ header: 'ID', value: (r) => r.id }, { header: 'NAME', value: (r) => r.name }, { header: 'REV', value: (r) => r.revision }, { header: 'ARCHIVED', value: (r) => r.archivedAt }], 'No knowledge topics.')
      return 0
    }
    if (sub === 'show') {
      const { positionals } = parseCommand(rest, {}, 1)
      output(await c().knowledge.topic(requireId(positionals[0], 'Topic')))
      return 0
    }
    if (sub === 'create' || sub === 'update') {
      const { values, positionals } = parseCommand(rest, { project: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, 'description-file': { type: 'string' }, revision: { type: 'string' }, 'mutation-id': { type: 'string' } }, sub === 'update' ? 1 : 0)
      const description = readMarkdown(values.description, values['description-file'], 'description')
      if (sub === 'create') {
        if (values.revision) throw new CliError('--revision applies to an existing topic')
        const { mutationId } = guard({ ...values, revision: '1' })
        output(await c().knowledge.createTopic(await resolveProject(c(), requireId(values.project, 'Project (--project)')), { name: requireId(values.name, 'Topic name (--name)'), description, mutationId }))
      } else {
        if (values.project) throw new CliError('A topic cannot be moved to another project')
        if (values.name === undefined && description === undefined) throw new CliError('Nothing to update')
        output(await c().knowledge.updateTopic(requireId(positionals[0], 'Topic'), { ...guard(values), name: values.name, description }))
      }
      return 0
    }
    if (sub === 'archive' || sub === 'restore') {
      const { values, positionals } = parseCommand(rest, { revision: { type: 'string' }, 'mutation-id': { type: 'string' }, yes: { type: 'boolean', short: 'y' } }, 1)
      const id = requireId(positionals[0], 'Topic'), input = guard(values)
      if (sub === 'archive') await confirm(ctx.out, `Archive knowledge topic ${id} without changing its documents?`, values.yes ?? false)
      output(await c().knowledge.archiveTopic(id, sub === 'archive', input))
      return 0
    }
  }
  if (group === 'member') {
    if (sub === 'list') {
      const { values, positionals } = parseCommand(rest, { limit: { type: 'string' }, cursor: { type: 'string' } }, 1)
      const page = await c().knowledge.documents(requireId(positionals[0], 'Topic'), { limit: numberFlag(values.limit, '--limit', 1, 200, 50), cursor: values.cursor })
      showPage(ctx, page, [{ header: 'DOCUMENT', value: (r) => r.document.id }, { header: 'TITLE', value: (r) => r.document.title }, { header: 'REV', value: (r) => r.document.revision }, { header: 'STATUS', value: (r) => r.document.status }, { header: 'PROJECTS', value: (r) => r.projectContext.items.map((p) => p.name).join(', ') }], 'No reading documents.')
      if (!ctx.out.machine) ctx.out.info(`Topic revision: ${page.topic.revision}`)
      return 0
    }
    if (['put', 'add', 'move', 'remove'].includes(sub)) {
      const { values, positionals } = parseCommand(rest, { before: { type: 'string' }, revision: { type: 'string' }, 'mutation-id': { type: 'string' } }, 2)
      const topicId = requireId(positionals[0], 'Topic'), documentId = requireId(positionals[1], 'Document'), input = guard(values)
      if (sub === 'remove' && values.before) throw new CliError('--before applies only to put/add/move')
      output(sub === 'remove' ? await c().knowledge.removeDocument(topicId, documentId, input) : await c().knowledge.putDocument(topicId, documentId, { ...input, beforeDocumentId: values.before }))
      return 0
    }
  }
  throw new CliError(`Unknown knowledge command: ${args.join(' ')}`, 'usage', 'See: alice knowledge help')
}
