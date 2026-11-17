import type { DocumentDetail } from '../../shared/contracts'
import { CliContext, parseCommand } from '../context'
import { CliError } from '../errors'
import { confirm } from '../output'
import { collect, itemBudget, readMarkdown, requireId, resolveProject, shortDate } from './shared'

export const DOCUMENT_HELP = `Usage: alice document <command>      (alias: alice doc)

  list [QUERY] [--task ID] [--project ID|NAME] [--archived active|archived|all] [--limit N | --all]
  search QUERY                        same as list QUERY
  show ID [--body-only]
  create --title TITLE [--body TEXT | --body-file PATH|-] [--source-url URL] [--task ID] [--project ID|NAME]
  update ID [--title] [--body TEXT | --body-file PATH|-] [--source-url URL | --no-source-url]
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
        { task: { type: 'string' }, project: { type: 'string' }, archived: { type: 'string', default: 'active' }, limit: { type: 'string' }, all: { type: 'boolean' } },
        1,
      )
      if (sub === 'search' && !positionals[0]) throw new CliError('A search query is required')
      const c = client()
      const projectId = values.project ? await resolveProject(c, values.project) : undefined
      const items = await collect(out, itemBudget(values.limit, values.all), (cursor, limit) =>
        c.documents.list({ q: positionals[0], taskId: values.task, projectId, archived: values.archived as 'active', cursor, limit }),
      )
      out.list(items, [
        { header: 'ID', value: (d) => d.id },
        { header: 'TITLE', value: (d) => d.title, max: 50 },
        { header: 'REV', value: (d) => d.revision },
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
      })
      if (!values.title) throw new CliError('--title is required')
      if (values.task && values.project) throw new CliError('Link to one of --task or --project when creating; add more links afterwards')
      const c = client()
      const res = await c.documents.create({ title: values.title, body: readMarkdown(values.body, values['body-file'], 'body') ?? '', sourceUrl: values['source-url'] ?? null })
      let doc = res.document
      if (values.task || values.project) doc = (await c.documents.link(doc.id, await target(values.task, values.project))).document
      showDoc(doc)
      return 0
    }
    case 'update': {
      const { values, positionals } = parseCommand(
        rest,
        { title: { type: 'string' }, body: { type: 'string' }, 'body-file': { type: 'string' }, 'source-url': { type: 'string' }, 'no-source-url': { type: 'boolean' } },
        1,
      )
      const patch: Record<string, unknown> = {}
      if (values.title !== undefined) patch.title = values.title
      const body = readMarkdown(values.body, values['body-file'], 'body')
      if (body !== undefined) patch.body = body
      if (values['source-url'] !== undefined) patch.sourceUrl = values['source-url']
      if (values['no-source-url']) patch.sourceUrl = null
      if (Object.keys(patch).length === 0) throw new CliError('Nothing to update')
      showDoc((await client().documents.update(requireId(positionals[0], 'Document'), patch)).document)
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
