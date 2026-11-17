import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { SEARCH_KINDS, HIGHLIGHT_END, HIGHLIGHT_START } from '../../shared/contracts'
import { formatDeepLink, webPath, type DeepLinkKind } from '../../shared/deeplink'
import { openExternal } from '../browser'
import { CliContext, parseCommand } from '../context'
import { CliError } from '../errors'
import { collect, itemBudget, requireId } from './shared'
import { activityColumns } from './task'

export async function activityCommand(ctx: CliContext, args: string[]): Promise<number> {
  const { values } = parseCommand(args, { actor: { type: 'string' }, type: { type: 'string' }, limit: { type: 'string' }, all: { type: 'boolean' } })
  const c = ctx.client()
  const items = await collect(ctx.out, itemBudget(values.limit, values.all), (cursor, limit) =>
    c.activity({ cursor, limit, actorId: values.actor, resourceType: values.type }),
  )
  ctx.out.list(items, activityColumns(), 'No activity.')
  return 0
}

export async function actorCommand(ctx: CliContext, args: string[]): Promise<number> {
  const [sub, ...rest] = args
  if (sub !== 'list' && sub !== 'ls') throw new CliError('Usage: alice actor list')
  parseCommand(rest, {})
  const items = await ctx.client().actors.list()
  ctx.out.list(items, [
    { header: 'ID', value: (a) => a.id },
    { header: 'KIND', value: (a) => a.kind },
    { header: 'NAME', value: (a) => a.displayName, max: 30 },
    { header: 'USERNAME', value: (a) => a.username },
    { header: 'OWNER', value: (a) => (a.isOwner ? 'yes' : '') },
    { header: 'DEACTIVATED', value: (a) => a.deactivatedAt?.slice(0, 10) },
  ], 'No actors.')
  return 0
}

export async function searchCommand(ctx: CliContext, args: string[]): Promise<number> {
  const { values, positionals } = parseCommand(args, { kind: { type: 'string' }, limit: { type: 'string' }, all: { type: 'boolean' } }, 1)
  if (!positionals[0]) throw new CliError('A search query is required')
  if (values.kind && !(SEARCH_KINDS as readonly string[]).includes(values.kind)) throw new CliError(`--kind must be one of: ${SEARCH_KINDS.join(', ')}`)
  const c = ctx.client()
  const items = await collect(ctx.out, itemBudget(values.limit, values.all), (cursor, limit) =>
    c.search({ q: positionals[0], kind: values.kind as 'task' | undefined, cursor, limit }),
  )
  const plain = (s: string) => s.split(HIGHLIGHT_START).join('').split(HIGHLIGHT_END).join('')
  ctx.out.list(items.map((r) => ({ ...r, snippet: plain(r.snippet) })), [
    { header: 'KIND', value: (r) => r.kind },
    { header: 'ID', value: (r) => r.id },
    { header: 'TITLE', value: (r) => r.title, max: 40 },
    { header: 'MATCH', value: (r) => r.snippet, max: 60 },
  ], 'No results.')
  return 0
}

const KIND_ALIASES: Record<string, DeepLinkKind> = { task: 'task', project: 'project', document: 'document', doc: 'document' }

/** Is Alice Desktop registered for alice:// on this machine? `ALICE_DESKTOP=0|1` overrides detection. */
export function desktopAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ALICE_DESKTOP === '1') return true
  if (env.ALICE_DESKTOP === '0') return false
  try {
    if (process.platform === 'darwin') {
      return ['/Applications/Alice.app', path.join(os.homedir(), 'Applications/Alice.app')].some((p) => fs.existsSync(p))
    }
    if (process.platform === 'win32') {
      return spawnSync('reg', ['query', 'HKCU\\Software\\Classes\\alice'], { stdio: 'ignore', windowsHide: true }).status === 0
    }
    const res = spawnSync('xdg-mime', ['query', 'default', 'x-scheme-handler/alice'], { encoding: 'utf8' })
    return res.status === 0 && res.stdout.trim().length > 0
  } catch {
    return false
  }
}

export async function openCommand(ctx: CliContext, args: string[]): Promise<number> {
  const { values, positionals } = parseCommand(args, { web: { type: 'boolean' }, desktop: { type: 'boolean' }, print: { type: 'boolean' } }, 2)
  const kind = KIND_ALIASES[positionals[0] ?? '']
  if (!kind) throw new CliError('Usage: alice open task|project|document ID [--web | --desktop] [--print]')
  const id = requireId(positionals[1], kind[0].toUpperCase() + kind.slice(1))
  if (values.web && values.desktop) throw new CliError('Use either --web or --desktop')
  const target = ctx.target()
  if (target.kind === 'local') {
    // Local workspace เปิดได้เฉพาะใน Desktop: ลิงก์มี id ที่ไม่เปลี่ยนของ workspace ไม่มี URL ของ daemon
    if (values.web) throw new CliError('Local workspaces have no web address; open them in Alice Desktop', 'usage')
    let link: string
    try {
      link = formatDeepLink({ workspace: target.workspace.id, kind, id })
    } catch (err) {
      throw new CliError(`${(err as Error).message}: ${id}`)
    }
    if (!values.print && !ctx.env.ALICE_NO_BROWSER) {
      if (!openExternal(link)) throw new CliError('Could not start the system URL handler', 'internal', `Open it manually: ${link}`)
    }
    ctx.out.value({ via: 'desktop', url: link, workspace: target.workspace.id }, () => ctx.out.line(link))
    return 0
  }
  const profile = target.profile
  const useDesktop = values.desktop || (!values.web && desktopAvailable(ctx.env))
  // formatDeepLink ตรวจรูปแบบ id/profile ก่อน — id ผิดรูปไม่ถูกส่งต่อไปที่ไหน
  let deepLink: string
  try {
    deepLink = formatDeepLink({ profile: profile.name, kind, id })
  } catch (err) {
    throw new CliError(`${(err as Error).message}: ${id}`)
  }
  const url = useDesktop ? deepLink : new URL(webPath({ kind, id }), profile.server).href
  const opened = { via: useDesktop ? 'desktop' : 'web', url, profile: profile.name }
  if (!values.print && !ctx.env.ALICE_NO_BROWSER) {
    if (!openExternal(url)) throw new CliError('Could not start the system URL handler', 'internal', `Open it manually: ${url}`)
  }
  ctx.out.value(opened, () => ctx.out.line(url))
  return 0
}
