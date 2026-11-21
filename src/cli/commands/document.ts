import { DOCUMENT_KNOWLEDGE_STATUSES, DOCUMENT_RELATION_TYPES, type DocumentDetail, type DocumentKnowledgeStatus, type DocumentRelationType } from '../../shared/contracts'
import { CliContext, parseCommand } from '../context'
import { CliError } from '../errors'
import { confirm } from '../output'
import { checkEnum, collect, itemBudget, listValues, readMarkdown, requireId, resolveActor, resolveProject, shortDate } from './shared'

export const DOCUMENT_HELP = `Usage: alice document <command>      (alias: alice doc)

  list [QUERY] [--task ID] [--project ID|NAME] [--tag TAG] [--status STATUS] [--owner ACTOR|none] [--archived active|archived|all] [--limit N | --all]
  search QUERY                        same as list QUERY
  show ID [--body-only]
  create --title TITLE [--body TEXT | --body-file PATH|-] [--source-url URL] [--tag TAG] [--keyword WORDS] [--status STATUS] [--owner ACTOR|none] [--task ID] [--project ID|NAME]
  update ID [--title] [--body TEXT | --body-file PATH|-] [--source-url URL | --no-source-url] [--tag TAG | --clear-tags] [--keyword WORDS | --clear-keywords] [--status STATUS] [--owner ACTOR|none]
  review ID --revision N [--no-current]       unreview ID --revision N
  relations ID [--direction outgoing|incoming] [--type TYPE] [--limit N | --all]
  relate ID TARGET --type references|related|supersedes [--yes]
  unrelate ID TARGET --type references|related|supersedes
  link ID (--task ID | --project ID|NAME)      unlink ID (--task ID | --project ID|NAME)
  archive ID [--yes]                  restore ID
  revisions ID [--limit N | --all]    restore-revision ID NUMBER [--yes]`

export async function documentCommand(ctx: CliContext, args: string[]): Promise<number> {
  const [sub, ...rest] = args
  const { out } = ctx
  const client = () => ctx.client()
  const showDoc = (d: DocumentDetail) =>
    out.value(d, () => {
      out.details([
        ['Document', d.title],
        ['Id', d.id],
        ['Revision', d.revision],
        ['Status', d.status],
        ['Owner', d.owner ? `${d.owner.displayName} (${d.owner.id})` : null],
        ['Tags', d.tags.join(', ')],
        ['Search keywords', d.searchKeywords.join(', ')],
        ['Reviewed revision', d.reviewedRevision],
        ['Reviewed', d.reviewedAt && d.reviewedBy ? `${d.reviewedAt} by ${d.reviewedBy.displayName}` : null],
        ['Source', d.sourceUrl],
        ['Linked tasks', d.links.tasks.map((t) => t.id).join(', ')],
        ['Linked projects', d.links.projects.map((p) => p.id).join(', ')],
        ['Archived', d.archivedAt],
        ['Updated', `${d.updatedAt} by ${d.updatedBy.displayName}`],
      ])
      if (d.body) out.line(`\n${d.body}`)
    })
  const target = async (task?: string, project?: string) => {
    if ((task ? 1 : 0) + (project ? 1 : 0) !== 1) throw new CliError('Give exactly one of --task or --project')
    return task ? { taskId: task } : { projectId: await resolveProject(client(), project!) }
  }

  switch (sub) {
    case 'list':
    case 'ls':
    case 'search': {
      const { values, positionals } = parseCommand(
        rest,
        {
          task: { type: 'string' }, project: { type: 'string', multiple: true }, tag: { type: 'string', multiple: true }, status: { type: 'string', multiple: true },
          owner: { type: 'string', multiple: true }, archived: { type: 'string', default: 'active' }, limit: { type: 'string' }, all: { type: 'boolean' },
        },
        1,
      )
      if (sub === 'search' && !positionals[0]) throw new CliError('A search query is required')
      const c = client()
      const statuses = listValues(values.status)
      statuses?.forEach((status) => checkEnum(status, DOCUMENT_KNOWLEDGE_STATUSES, '--status'))
      checkEnum(values.archived, ['active', 'archived', 'all'], '--archived')
      const projectId = values.project ? await Promise.all(listValues(values.project)!.map((project) => resolveProject(c, project))) : undefined
      const ownerId = values.owner ? await Promise.all(listValues(values.owner)!.map(async (owner) => (await resolveActor(c, owner)) ?? 'none')) : undefined
      const items = await collect(out, itemBudget(values.limit, values.all), (cursor, limit) =>
        c.documents.list({ q: positionals[0], taskId: values.task, projectId, tag: listValues(values.tag), status: statuses as DocumentKnowledgeStatus[] | undefined, ownerId, archived: values.archived as 'active', cursor, limit }),
      )
      out.list(items, [
        { header: 'ID', value: (d) => d.id },
        { header: 'TITLE', value: (d) => d.title, max: 50 },
        { header: 'REV', value: (d) => d.revision },
        { header: 'STATUS', value: (d) => d.status },
        { header: 'OWNER', value: (d) => d.owner?.displayName, max: 24 },
        { header: 'MATCH', value: (d) => d.match ? `${d.match.field}${d.match.value ? `: ${d.match.value}` : ''}` : '', max: 32 },
        { header: 'UPDATED', value: (d) => shortDate(d.updatedAt) },
        { header: 'EXCERPT', value: (d) => d.excerpt, max: 50 },
      ], 'No matching documents.')
      return 0
    }
    case 'show': {
      const { values, positionals } = parseCommand(rest, { 'body-only': { type: 'boolean' } }, 1)
      const doc = await client().documents.get(requireId(positionals[0], 'Document'))
      // --body-only เขียน Markdown ดิบไปที่ stdout (ไม่ต่อท้ายอะไร) เพื่อ pipe ต่อได้
      if (values['body-only']) process.stdout.write(doc.body)
      else showDoc(doc)
      return 0
    }
    case 'create': {
      const { values } = parseCommand(rest, {
        title: { type: 'string' },
        body: { type: 'string' },
        'body-file': { type: 'string' },
        'source-url': { type: 'string' },
        task: { type: 'string' },
        project: { type: 'string' },
        tag: { type: 'string', multiple: true },
        keyword: { type: 'string', multiple: true },
        status: { type: 'string' },
        owner: { type: 'string' },
      })
      if (!values.title) throw new CliError('--title is required')
      if (values.task && values.project) throw new CliError('Link to one of --task or --project when creating; add more links afterwards')
      const c = client()
      checkEnum(values.status, DOCUMENT_KNOWLEDGE_STATUSES, '--status')
      const res = await c.documents.create({
        title: values.title,
        body: readMarkdown(values.body, values['body-file'], 'body') ?? '',
        sourceUrl: values['source-url'] ?? null,
        tags: listValues(values.tag),
        searchKeywords: listValues(values.keyword),
        status: values.status as DocumentKnowledgeStatus | undefined,
        ownerId: values.owner ? await resolveActor(c, values.owner) : undefined,
      })
      let doc = res.document
      if (values.task || values.project) doc = (await c.documents.link(doc.id, await target(values.task, values.project))).document
      showDoc(doc)
      return 0
    }
    case 'update': {
      const { values, positionals } = parseCommand(
        rest,
        {
          title: { type: 'string' }, body: { type: 'string' }, 'body-file': { type: 'string' }, 'source-url': { type: 'string' }, 'no-source-url': { type: 'boolean' },
          tag: { type: 'string', multiple: true }, 'clear-tags': { type: 'boolean' }, keyword: { type: 'string', multiple: true }, 'clear-keywords': { type: 'boolean' },
          status: { type: 'string' }, owner: { type: 'string' },
        },
        1,
      )
      const patch: Record<string, unknown> = {}
      checkEnum(values.status, DOCUMENT_KNOWLEDGE_STATUSES, '--status')
      if (values.title !== undefined) patch.title = values.title
      const body = readMarkdown(values.body, values['body-file'], 'body')
      if (body !== undefined) patch.body = body
      if (values['source-url'] !== undefined) patch.sourceUrl = values['source-url']
      if (values['no-source-url']) patch.sourceUrl = null
      if (values['clear-tags']) patch.tags = []
      else if (values.tag) patch.tags = listValues(values.tag)
      if (values['clear-keywords']) patch.searchKeywords = []
      else if (values.keyword) patch.searchKeywords = listValues(values.keyword)
      if (values.status !== undefined) patch.status = values.status
      if (values.owner !== undefined) patch.ownerId = await resolveActor(client(), values.owner)
      if (Object.keys(patch).length === 0) throw new CliError('Nothing to update')
      showDoc((await client().documents.update(requireId(positionals[0], 'Document'), patch)).document)
      return 0
    }
    case 'review':
    case 'unreview': {
      const { values, positionals } = parseCommand(rest, { revision: { type: 'string' }, 'no-current': { type: 'boolean' } }, 1)
      const id = requireId(positionals[0], 'Document')
      const revision = Number(values.revision)
      if (!Number.isInteger(revision) || revision < 1) throw new CliError('--revision must be a positive integer')
      if (sub === 'unreview' && values['no-current']) throw new CliError('--no-current only applies to review')
      const result = sub === 'review'
        ? await client().documents.review(id, { expectedRevision: revision, markCurrent: !values['no-current'] })
        : await client().documents.clearReview(id, { expectedRevision: revision })
      showDoc(result.document)
      return 0
    }
    case 'relations': {
      const { values, positionals } = parseCommand(rest, { direction: { type: 'string', default: 'outgoing' }, type: { type: 'string', multiple: true }, limit: { type: 'string' }, all: { type: 'boolean' } }, 1)
      checkEnum(values.direction, ['outgoing', 'incoming'], '--direction')
      const types = listValues(values.type)
      types?.forEach((type) => checkEnum(type, DOCUMENT_RELATION_TYPES, '--type'))
      const id = requireId(positionals[0], 'Document')
      const items = await collect(out, itemBudget(values.limit, values.all), (cursor, limit) => client().documents.relations(id, { direction: values.direction as 'outgoing', type: types as DocumentRelationType[] | undefined, cursor, limit }))
      out.list(items, [
        { header: 'DIRECTION', value: (relation) => relation.direction },
        { header: 'TYPE', value: (relation) => relation.type },
        { header: 'DOCUMENT', value: (relation) => relation.document.id },
        { header: 'TITLE', value: (relation) => relation.document.title, max: 50 },
        { header: 'STATUS', value: (relation) => relation.document.status },
      ], 'No document relationships.')
      return 0
    }
    case 'relate':
    case 'unrelate': {
      const { values, positionals } = parseCommand(rest, { type: { type: 'string' }, yes: { type: 'boolean', short: 'y' } }, 2)
      const id = requireId(positionals[0], 'Document')
      const targetId = requireId(positionals[1], 'Target document')
      checkEnum(values.type, DOCUMENT_RELATION_TYPES, '--type')
      if (!values.type) throw new CliError('--type is required')
      const type = values.type as DocumentRelationType
      const c = client()
      if (sub === 'relate' && type === 'supersedes') {
        const targetDoc = await c.documents.get(targetId)
        await confirm(out, `Make ${id} supersede ${targetDoc.title} (${targetId}) and mark the target Superseded?`, values.yes ?? false)
      }
      const result = sub === 'relate'
        ? await c.documents.relate(id, { targetId, type, ...(type === 'supersedes' ? { acknowledgeSupersedes: true } : {}) })
        : await c.documents.unrelate(id, { targetId, type })
      out.value(result, () => out.line(result.changed ? `${sub === 'relate' ? 'Related' : 'Unrelated'} ${id} ${type} ${targetId}` : 'No change.'))
      return 0
    }
    case 'link':
    case 'unlink': {
      const { values, positionals } = parseCommand(rest, { task: { type: 'string' }, project: { type: 'string' } }, 1)
      const id = requireId(positionals[0], 'Document')
      const t = await target(values.task, values.project)
      const res = sub === 'link' ? await client().documents.link(id, t) : await client().documents.unlink(id, t)
      const what = t.taskId ?? t.projectId
      out.value(res, () => out.line(res.changed ? `${sub === 'link' ? 'Linked' : 'Unlinked'} ${id} ${sub === 'link' ? 'to' : 'from'} ${what}` : `No change: ${id} was ${sub === 'link' ? 'already' : 'not'} linked to ${what}`))
      return 0
    }
    case 'archive':
    case 'restore': {
      const { values, positionals } = parseCommand(rest, { yes: { type: 'boolean', short: 'y' } }, 1)
      const id = requireId(positionals[0], 'Document')
      if (sub === 'archive') await confirm(out, `Archive document ${id}?`, values.yes ?? false)
      const res = sub === 'archive' ? await client().documents.archive(id) : await client().documents.restore(id)
      out.value(res.document, () => out.line(`${sub === 'archive' ? 'Archived' : 'Restored'} ${res.document.id}: ${res.document.title}`))
      return 0
    }
    case 'revisions': {
      const { values, positionals } = parseCommand(rest, { limit: { type: 'string' }, all: { type: 'boolean' } }, 1)
      const c = client()
      const id = requireId(positionals[0], 'Document')
      const items = await collect(out, itemBudget(values.limit, values.all), (cursor, limit) => c.documents.revisions(id, { cursor, limit }))
      out.list(items, [
        { header: 'REV', value: (r) => r.number },
        { header: 'CREATED', value: (r) => r.createdAt },
        { header: 'BY', value: (r) => `${r.createdBy.displayName}${r.createdBy.kind === 'agent' ? ' (agent)' : ''}`, max: 24 },
        { header: 'TITLE', value: (r) => r.title, max: 40 },
        { header: 'RESTORED FROM', value: (r) => r.restoredFrom },
      ], 'No revisions.')
      return 0
    }
    case 'restore-revision': {
      const { values, positionals } = parseCommand(rest, { yes: { type: 'boolean', short: 'y' } }, 2)
      const id = requireId(positionals[0], 'Document')
      const n = Number(positionals[1])
      if (!Number.isInteger(n) || n < 1) throw new CliError('Revision NUMBER must be a positive integer')
      await confirm(out, `Replace the current content of ${id} with revision ${n}?`, values.yes ?? false)
      const res = await client().documents.restoreRevision(id, n)
      out.value(res.document, () => out.line(`Restored revision ${n} of ${id} as revision ${res.document.revision}`))
      return 0
    }
    case undefined:
    case 'help':
      out.line(DOCUMENT_HELP)
      return sub ? 0 : 2
    default:
      throw new CliError(`Unknown document command: ${sub}`, 'usage', 'See: alice document help')
  }
}
