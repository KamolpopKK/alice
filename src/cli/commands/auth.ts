import os from 'node:os'
import { AliceClientError, compatibilityOf } from '../../client'
import type { ClientCredentials } from '../../shared/contracts'
import { openExternal } from '../browser'
import { CliContext, parseCommand } from '../context'
import { CliError } from '../errors'
import { CLI_VERSION } from '../version'

export const AUTH_HELP = `Usage: alice auth <command>

  login [--device-name NAME] [--no-browser]   Sign in through the browser (device approval)
  logout                                      Revoke this profile's session and forget it locally
  whoami                                      Show the signed-in human for the profile`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function authCommand(ctx: CliContext, args: string[]): Promise<number> {
  const [sub, ...rest] = args
  switch (sub) {
    case 'login':
      return login(ctx, rest)
    case 'logout':
      return logout(ctx, rest)
    case 'whoami':
    case 'status':
      return whoami(ctx, rest)
    case undefined:
    case 'help':
    case '--help':
      ctx.out.line(AUTH_HELP)
      return sub ? 0 : 2
    default:
      throw new CliError(`Unknown auth command: ${sub}`, 'usage', 'See: alice auth help')
  }
}

async function login(ctx: CliContext, args: string[]): Promise<number> {
  const { values } = parseCommand(args, { 'device-name': { type: 'string' }, 'no-browser': { type: 'boolean' } })
  const { out } = ctx
  rejectLocal(ctx, 'sign in')
  const session = ctx.session()
  const anon = session.anonymousClient()
  const info = await anon.info()
  const compat = compatibilityOf(info)
  if (!compat.compatible) throw new CliError(compat.message, 'compatibility')

  // login ใหม่แทนที่ session เดิมของ profile นี้ (revoke ของเก่าก่อน)
  if (session.hasCredential()) await session.signOut().catch(() => session.forget())

  const deviceName = (values['device-name'] ?? os.hostname()).slice(0, 120) || 'unknown device'
  const start = await anon.device.authorize({ clientKind: 'cli', clientName: 'Alice CLI', deviceName, clientVersion: CLI_VERSION })
  out.info(`To sign in to ${session.profile.server}, open:\n\n  ${start.verificationUriComplete}\n\nand confirm the code ${out.bold(start.userCode)}`)
  const wantBrowser = !values['no-browser'] && !ctx.env.ALICE_NO_BROWSER && !!process.stdout.isTTY
  if (wantBrowser && !openExternal(start.verificationUriComplete)) out.info('(Could not open a browser; open the link manually.)')
  out.info('Waiting for approval…')

  let interval = start.interval
  const deadline = Date.now() + start.expiresIn * 1000
  let creds: ClientCredentials | null = null
  while (!creds) {
    await sleep(interval * 1000)
    if (Date.now() > deadline) throw new CliError('The sign-in code expired before it was approved', 'auth', 'Run alice auth login again')
    try {
      creds = await anon.device.token(start.deviceCode)
    } catch (err) {
      if (!(err instanceof AliceClientError)) throw err
      if (err.code === 'DEVICE_AUTHORIZATION_PENDING') continue
      if (err.code === 'DEVICE_SLOW_DOWN') {
        interval = Number((err.details as { interval?: number } | undefined)?.interval ?? interval + 5)
        continue
      }
      if (err.code === 'NETWORK_ERROR' || err.code === 'RATE_LIMITED') continue
      if (err.code === 'DEVICE_ACCESS_DENIED') throw new CliError('The sign-in request was denied in the browser', 'auth')
      if (err.code === 'DEVICE_CODE_EXPIRED') throw new CliError('The sign-in code expired or was already used', 'auth', 'Run alice auth login again')
      throw err
    }
  }
  session.remember(creds.refreshToken, creds.accessToken, { id: creds.session.id, actor: { id: creds.actor.id, displayName: creds.actor.displayName } })
  const result = { profile: session.profile.name, server: session.profile.server, actor: creds.actor, sessionId: creds.session.id }
  out.value(result, () => out.line(`Signed in to ${out.bold(session.profile.name)} (${session.profile.server}) as ${out.bold(creds.actor.displayName)}`))
  return 0
}

/** Local workspaces have no sign-in: the OS account is the boundary and the daemon holds the identity. */
function rejectLocal(ctx: CliContext, what: string): void {
  const target = ctx.target()
  if (target.kind === 'local') throw new CliError(`Local workspaces need no ${what}; "${target.workspace.alias}" is private to this computer account`, 'usage')
}

async function logout(ctx: CliContext, args: string[]): Promise<number> {
  parseCommand(args, {})
  rejectLocal(ctx, 'sign-out')
  const session = ctx.session()
  let result: { revoked: boolean; hadSession: boolean }
  try {
    result = await session.signOut()
  } catch (err) {
    ctx.out.error('The local credential was removed, but the server could not be reached to revoke the session', 'Revoke it from the Devices page in Alice')
    throw err
  }
  ctx.out.value({ profile: session.profile.name, ...result }, () =>
    ctx.out.line(result.hadSession ? `Signed out of ${session.profile.name}; the session was revoked` : `Profile ${session.profile.name} was not signed in`),
  )
  return 0
}

async function whoami(ctx: CliContext, args: string[]): Promise<number> {
  parseCommand(args, {})
  const target = ctx.target()
  if (target.kind === 'local') {
    const me = await ctx.localSession().local<{ actor: { id: string; kind: string; displayName: string; isOwner: boolean }; workspace: { id: string; name: string } }>('GET', '/whoami')
    ctx.out.value({ workspace: me.workspace, actor: me.actor }, () =>
      ctx.out.details([
        ['Workspace', `${target.workspace.name} (${target.workspace.alias}, Local)`],
        ['Acting as', `${me.actor.displayName} (${me.actor.kind}${me.actor.isOwner ? ', owner' : ''})`],
      ]),
    )
    return 0
  }
  const session = ctx.session()
  const me = await session.authenticatedClient().auth.me()
  const sessions = await session.authenticatedClient().clientSessions.list()
  const current = sessions.find((s) => s.current) ?? null
  const result = { profile: session.profile.name, server: session.profile.server, actor: me.actor, session: current }
  ctx.out.value(result, () =>
    ctx.out.details([
      ['Profile', session.profile.name],
      ['Server', session.profile.server],
      ['Signed in as', `${me.actor.displayName} (${me.actor.username ?? me.actor.id})${me.actor.isOwner ? ', owner' : ''}`],
      ['Session', current ? `${current.id} — ${current.clientName} on ${current.deviceName}` : null],
    ]),
  )
  return 0
}
