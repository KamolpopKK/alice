import { compatibilityOf } from '../../client'
import { normalizeServerUrl, saveConfig, validateProfileName } from '../config'
import { CliContext, parseCommand } from '../context'
import { credentialAccount } from '../credentials'
import { CliError } from '../errors'
import { confirm } from '../output'

export const PROFILE_HELP = `Usage: alice profile <command>

  add NAME --server URL [--insecure-dev] [--no-use]   Save a server profile and make it active
  list                                                List profiles; * marks the active one
  show [NAME]                                         Show one profile
  use NAME                                            Make NAME the active profile
  remove NAME [--yes]                                 Sign out (revoking the session) and delete the profile
  test [NAME]                                         Check reachability, TLS and protocol compatibility`

export async function profileCommand(ctx: CliContext, args: string[]): Promise<number> {
  const [sub, ...rest] = args
  const { out, config } = ctx
  switch (sub) {
    case 'add': {
      const { values, positionals } = parseCommand(rest, { 'insecure-dev': { type: 'boolean' }, 'no-use': { type: 'boolean' } }, 2)
      const name = validateProfileName(positionals[0] ?? '')
      // --server เป็น global flag อยู่แล้ว จึงอ่านจาก ctx.flags (หรือ URL ตำแหน่งที่สอง)
      const server = ctx.flags.server ?? positionals[1]
      if (!server) throw new CliError('--server URL is required')
      if (config.profiles[name]) throw new CliError(`Profile "${name}" already exists`, 'usage', `Remove it first with: alice profile remove ${name}`)
      const { origin, insecure } = normalizeServerUrl(server, values['insecure-dev'] ?? false)
      config.profiles[name] = { name, server: origin, insecure, createdAt: new Date().toISOString(), session: null }
      // profile ใหม่เป็น active ทันที ยกเว้นสั่ง --no-use (และยังมี active อื่นอยู่)
      if (!values['no-use'] || !config.activeProfile || !config.profiles[config.activeProfile]) {
        config.activeProfile = name
        config.activeWorkspace = null
      }
      saveConfig(config, ctx.configDir)
      if (insecure) out.warn(`warning: profile "${name}" uses unencrypted HTTP; use only for local development`)
      out.value({ profile: config.profiles[name], active: config.activeProfile === name }, () => {
        out.line(`Added profile ${out.bold(name)} → ${origin}${config.activeProfile === name ? ' (active)' : ''}`)
      })
      out.info(`Next: alice auth login --profile ${name}`)
      return 0
    }
    case 'list': {
      parseCommand(rest, {})
      const items = Object.values(config.profiles).map((p) => ({ ...p, active: p.name === config.activeProfile }))
      out.list(
        items,
        [
          { header: ' ', value: (p) => (p.active ? '*' : '') },
          { header: 'NAME', value: (p) => p.name },
          { header: 'SERVER', value: (p) => p.server + (p.insecure ? ' (insecure)' : '') },
          { header: 'SIGNED IN AS', value: (p) => p.session?.actor.displayName ?? '' },
        ],
        'No profiles yet. Add one with: alice profile add work --server https://alice.example.com',
      )
      return 0
    }
    case 'show': {
      const { positionals } = parseCommand(rest, {}, 1)
      const p = ctx.profile(positionals[0])
      const signedIn = ctx.store.get(credentialAccount(p)) !== null
      out.value({ ...p, active: p.name === config.activeProfile, signedIn }, () =>
        out.details([
          ['Profile', p.name + (p.name === config.activeProfile ? ' (active)' : '')],
          ['Server', p.server],
          ['Transport', p.insecure ? 'HTTP (insecure, development only)' : 'HTTPS'],
          ['Signed in', signedIn ? `yes, as ${p.session?.actor.displayName ?? 'unknown'}` : 'no'],
          ['Session', signedIn ? p.session?.id : null],
          ['Created', p.createdAt],
        ]),
      )
      return 0
    }
    case 'use': {
      const { positionals } = parseCommand(rest, {}, 1)
      const name = positionals[0]
      if (!name || !config.profiles[name]) throw new CliError(name ? `No profile named "${name}"` : 'Profile name required')
      config.activeProfile = name
      config.activeWorkspace = null
      saveConfig(config, ctx.configDir)
      out.value({ activeProfile: name, server: config.profiles[name].server }, () => out.line(`Active profile: ${out.bold(name)} → ${config.profiles[name].server}`))
      return 0
    }
    case 'remove': {
      const { values, positionals } = parseCommand(rest, { yes: { type: 'boolean', short: 'y' } }, 1)
      const name = positionals[0]
      if (!name || !config.profiles[name]) throw new CliError(name ? `No profile named "${name}"` : 'Profile name required')
      await confirm(out, `Remove profile "${name}" and sign out of ${config.profiles[name].server}?`, values.yes ?? false)
      const session = ctx.session(name)
      let revoked = false
      try {
        revoked = (await session.signOut()).revoked
      } catch {
        out.warn('warning: the server could not be reached; the session was removed locally but may still be active (revoke it from Devices)')
      }
      delete config.profiles[name]
      if (config.activeProfile === name) config.activeProfile = null
      saveConfig(config, ctx.configDir)
      out.value({ removed: name, revoked }, () => out.line(`Removed profile ${name}${revoked ? ' and revoked its session' : ''}`))
      return 0
    }
    case 'test': {
      const { positionals } = parseCommand(rest, {}, 1)
      const session = ctx.session(positionals[0])
      const p = session.profile
      const info = await session.anonymousClient().info()
      const compat = compatibilityOf(info)
      const result = {
        profile: p.name,
        server: p.server,
        tls: p.insecure ? 'none (insecure HTTP)' : 'verified',
        serverName: info.name,
        serverVersion: info.serverVersion,
        clientApi: info.clientApi,
        compatible: compat.compatible,
        message: compat.message,
      }
      out.value(result, () =>
        out.details([
          ['Profile', p.name],
          ['Server', `${info.name} ${info.serverVersion} at ${p.server}`],
          ['TLS', p.insecure ? out.yellow('none — plain HTTP (development only)') : out.green('certificate verified')],
          ['Client API', `server v${info.clientApi.minimum}–v${info.clientApi.current}`],
          ['Compatibility', compat.compatible ? out.green(compat.message) : out.red(compat.message)],
        ]),
      )
      return compat.compatible ? 0 : 5
    }
    case undefined:
    case 'help':
    case '--help':
      out.line(PROFILE_HELP)
      return sub ? 0 : 2
    default:
      throw new CliError(`Unknown profile command: ${sub}`, 'usage', 'See: alice profile help')
  }
}
