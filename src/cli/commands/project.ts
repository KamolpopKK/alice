import type { Project } from '../../shared/contracts'
import { CliContext, parseCommand } from '../context'
import { CliError } from '../errors'
import { confirm } from '../output'
import { listValues, readMarkdown, requireId, shortDate } from './shared'

export const PROJECT_HELP = `Usage: alice project <command>

  list [--archived active|archived|all]
  show ID
  create --name NAME [--description TEXT | --description-file PATH|-] [--label L]...
  update ID [--name NAME] [--description TEXT | --description-file PATH|-] [--label L]... [--clear-labels]
  archive ID [--yes]
  restore ID`

export async function projectCommand(ctx: CliContext, args: string[]): Promise<number> {
  const [sub, ...rest] = args
  const { out } = ctx
  const client = () => ctx.client()
  const detail = (p: Project) =>
    out.value(p, () =>
      out.details([
        ['Project', `${p.name}${p.isSystem ? ' (system)' : ''}`],
        ['Id', p.id],
        ['Labels', p.labels.join(', ')],
        ['Archived', p.archivedAt],
        ['Updated', p.updatedAt],
        ['Description', p.description],
      ]),
    )
  switch (sub) {
    case 'list':
    case 'ls': {
      const { values } = parseCommand(rest, { archived: { type: 'string', default: 'active' } })
      if (!['active', 'archived', 'all'].includes(values.archived!)) throw new CliError('--archived must be active, archived or all')
      const items = await client().projects.list(values.archived as 'active')
      out.list(items, [
        { header: 'ID', value: (p) => p.id },
        { header: 'NAME', value: (p) => p.name, max: 40 },
        { header: 'LABELS', value: (p) => p.labels.join(','), max: 30 },
        { header: 'ARCHIVED', value: (p) => shortDate(p.archivedAt) },
        { header: 'UPDATED', value: (p) => shortDate(p.updatedAt) },
      ], 'No projects.')
      return 0
    }
    case 'show': {
      const { positionals } = parseCommand(rest, {}, 1)
      detail(await client().projects.get(requireId(positionals[0], 'Project')))
      return 0
    }
    case 'create': {
      const { values } = parseCommand(rest, { name: { type: 'string' }, description: { type: 'string' }, 'description-file': { type: 'string' }, label: { type: 'string', multiple: true } })
      if (!values.name) throw new CliError('--name is required')
      const description = readMarkdown(values.description, values['description-file'], 'description')
      const res = await client().projects.create({ name: values.name, description: description ?? '', labels: listValues(values.label) ?? [] })
      detail(res.project)
      return 0
    }
    case 'update': {
      const { values, positionals } = parseCommand(
        rest,
        { name: { type: 'string' }, description: { type: 'string' }, 'description-file': { type: 'string' }, label: { type: 'string', multiple: true }, 'clear-labels': { type: 'boolean' } },
        1,
      )
      const patch: Record<string, unknown> = {}
      if (values.name !== undefined) patch.name = values.name
      const description = readMarkdown(values.description, values['description-file'], 'description')
      if (description !== undefined) patch.description = description
      if (values['clear-labels']) patch.labels = []
      else if (values.label) patch.labels = listValues(values.label)
      if (Object.keys(patch).length === 0) throw new CliError('Nothing to update; pass --name, --description or labels')
      detail((await client().projects.update(requireId(positionals[0], 'Project'), patch)).project)
      return 0
    }
    case 'archive':
    case 'restore': {
      const { values, positionals } = parseCommand(rest, { yes: { type: 'boolean', short: 'y' } }, 1)
      const id = requireId(positionals[0], 'Project')
      if (sub === 'archive') await confirm(out, `Archive project ${id}?`, values.yes ?? false)
      const res = sub === 'archive' ? await client().projects.archive(id) : await client().projects.restore(id)
      out.value(res.project, () => out.line(`${sub === 'archive' ? 'Archived' : 'Restored'} project ${res.project.name} (${res.project.id})`))
      return 0
    }
    case undefined:
    case 'help':
      out.line(PROJECT_HELP)
      return sub ? 0 : 2
    default:
      throw new CliError(`Unknown project command: ${sub}`, 'usage', 'See: alice project help')
  }
}
