import { parseArgs, type ParseArgsConfig } from 'node:util'
import { configDir, insecureWarning, loadConfig, normalizeServerUrl, type CliConfig, type Profile } from './config'
import { selectCredentialStore, type CredentialStore } from './credentials'
import { CliError } from './errors'
import type { Output } from './output'
import { ProfileSession } from './session'
import { LocalSession } from './local-session'
import { WorkspaceResolver, targetRef, type Target } from './workspaces'
import { LOCAL_AGENT_CLIENTS, type LocalAgentClient } from '../local/registry'

export interface GlobalFlags {
  profile?: string
  server?: string
  /** Local workspace id/alias or Remote profile name. */
  workspace?: string
  /** Local agent identity to act as: codex or claude-code. */
  as?: string
}

/** Everything a command needs; credential store access is lazy so offline commands never touch it. */
export class CliContext {
  readonly configDir: string
  readonly config: CliConfig
  private storeInstance: CredentialStore | null = null
  private warned = false

  constructor(
    readonly out: Output,
    readonly flags: GlobalFlags,
    readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    this.configDir = configDir(env)
    this.config = loadConfig(this.configDir)
  }

  private targetCache: Target | null = null
  private resolverInstance: WorkspaceResolver | null = null

  get resolver(): WorkspaceResolver {
    this.resolverInstance ??= new WorkspaceResolver(this.config, this.env)
    return this.resolverInstance
  }

  /** The Local agent identity this command acts as (--as or ALICE_AGENT), or null for the human. */
  get agent(): LocalAgentClient | null {
    const raw = this.flags.as ?? this.env.ALICE_AGENT
    if (!raw) return null
    const value = raw === 'claude' ? 'claude-code' : raw
    if (!(LOCAL_AGENT_CLIENTS as readonly string[]).includes(value)) throw new CliError(`--as must be one of: ${LOCAL_AGENT_CLIENTS.join(', ')}`)
    return value as LocalAgentClient
  }

  /** The workspace this command targets, resolved once with the workspace precedence rules. */
  target(): Target {
    if (this.targetCache) return this.targetCache
    if (this.agent) this.out.useEnvelope(null)
    if (this.flags.workspace && (this.flags.profile || this.flags.server)) throw new CliError('Use either --workspace or --profile/--server')
    let explicit = this.flags.workspace
    if (!explicit && (this.flags.profile || this.flags.server)) explicit = `profile:${this.profile().name}`
    let target: Target
    try {
      target = this.resolver.resolve(explicit, this.agent)
    } catch (err) {
      // มี Local workspace อยู่แล้ว: ตอบ error แบบ envelope เพื่อให้ agent อ่านรายการให้เลือกได้
      if (this.resolver.registry().workspaces.length > 0 || this.env.ALICE_JSON_ENVELOPE === '1') this.out.useEnvelope(null)
      throw err
    }
    if (this.agent && target.kind !== 'local') {
      throw new CliError('Agent mode works with Local workspaces; Remote agents connect through MCP', 'usage', 'Pick a Local workspace with --workspace')
    }
    if (target.kind === 'local' || this.agent || this.env.ALICE_JSON_ENVELOPE === '1') this.out.useEnvelope(targetRef(target))
    this.targetCache = target
    return target
  }

  /** An authenticated Client API client for the target workspace, Local or Remote. */
  client() {
    const target = this.target()
    return target.kind === 'local' ? this.localSession().authenticatedClient() : this.session(target.profile.name).authenticatedClient()
  }

  private localCache: LocalSession | null = null
  localSession(): LocalSession {
    const target = this.target()
    if (target.kind !== 'local') throw new CliError(`"${target.profile.name}" is a Remote workspace`, 'usage')
    this.localCache ??= new LocalSession(target.workspace, target.root, this.agent, this.env, this.out)
    return this.localCache
  }

  get store(): CredentialStore {
    if (!this.storeInstance) {
      this.storeInstance = selectCredentialStore(this.configDir, this.env)
      if (!this.storeInstance.secure) this.out.warn(`warning: credentials are stored in a ${this.storeInstance.name}`)
    }
    return this.storeInstance
  }

  /** The profile chosen by --profile, then --server, then the active profile. */
  profile(name?: string): Profile {
    const chosen = name ?? this.flags.profile
    let profile: Profile | undefined
    if (chosen) {
      profile = this.config.profiles[chosen]
      if (!profile) throw new CliError(`No profile named "${chosen}"`, 'usage', 'List profiles with: alice profile list')
    } else if (this.flags.server) {
      const origin = normalizeServerUrl(this.flags.server, true).origin
      const matches = Object.values(this.config.profiles).filter((p) => p.server === origin)
      if (matches.length !== 1) {
        throw new CliError(
          matches.length ? `Several profiles use ${origin}; choose one with --profile` : `No profile uses ${origin}`,
          'usage',
          matches.length ? undefined : `Add one with: alice profile add NAME --server ${origin}`,
        )
      }
      profile = matches[0]
    } else {
      // ไม่มี --profile/--server: ใช้ workspace ที่เลือกตามลำดับความสำคัญ ซึ่งต้องเป็น Remote
      const target = this.target()
      if (target.kind === 'local') {
        throw new CliError(`"${target.workspace.alias}" is a Local workspace; this command needs a Remote profile`, 'usage', 'Choose one with --profile NAME')
      }
      profile = target.profile
    }
    const warning = insecureWarning(profile)
    if (warning && !this.warned) {
      this.warned = true
      this.out.warn(warning)
    }
    return profile
  }

  session(name?: string): ProfileSession {
    return new ProfileSession(this.profile(name), () => this.store, this.config, this.configDir)
  }
}

/** Strict per-command flag parsing; unknown flags are usage errors (exit 2). */
export function parseCommand<T extends NonNullable<ParseArgsConfig['options']>>(args: string[], options: T, maxPositionals = 0) {
  try {
    const parsed = parseArgs({ args, options, allowPositionals: true, strict: true })
    if (parsed.positionals.length > maxPositionals) throw new CliError(`Unexpected argument: ${parsed.positionals[maxPositionals]}`)
    return parsed
  } catch (err) {
    if (err instanceof CliError) throw err
    throw new CliError((err as Error).message)
  }
}
