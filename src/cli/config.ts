import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CliError } from './errors'

/** Local connection metadata. Never contains credentials. */
export interface Profile {
  name: string
  server: string
  /** Plain HTTP was explicitly allowed for this profile (development only). */
  insecure: boolean
  createdAt: string
  /** Non-secret description of the signed-in session, for display only. */
  session?: { id: string; actor: { id: string; displayName: string }; signedInAt: string } | null
}

export interface CliConfig {
  version: 1
  activeProfile: string | null
  profiles: Record<string, Profile>
  /**
   * The CLI's active Local workspace id, independent of Alice Desktop. When null the active
   * Remote profile is the active workspace. `agentWorkspaces` holds the same per local agent identity.
   */
  activeWorkspace?: string | null
  agentWorkspaces?: Record<string, string>
}

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ALICE_CONFIG_DIR) return path.resolve(env.ALICE_CONFIG_DIR)
  if (process.platform === 'win32' && env.APPDATA) return path.join(env.APPDATA, 'alice')
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'alice')
}

const configFile = (dir: string) => path.join(dir, 'config.json')

export function loadConfig(dir = configDir()): CliConfig {
  const file = configFile(dir)
  if (!fs.existsSync(file)) return { version: 1, activeProfile: null, profiles: {} }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as CliConfig
    return {
      version: 1,
      activeProfile: parsed.activeProfile ?? null,
      profiles: parsed.profiles ?? {},
      activeWorkspace: parsed.activeWorkspace ?? null,
      agentWorkspaces: parsed.agentWorkspaces ?? {},
    }
  } catch {
    throw new CliError(`The profile file ${file} is not valid JSON; fix or remove it`, 'usage')
  }
}

export function saveConfig(config: CliConfig, dir = configDir()): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = configFile(dir)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(tmp, file)
}

const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/
export function validateProfileName(name: string): string {
  if (!PROFILE_NAME.test(name)) throw new CliError('Profile names use letters, digits, ".", "_" or "-" (max 40, starting with a letter or digit)')
  return name
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
export const isLoopback = (url: URL) => LOOPBACK.has(url.hostname) || url.hostname.endsWith('.localhost')

/**
 * HTTPS is required for remote servers. Plain HTTP is accepted for loopback addresses, or for any
 * host when the profile was created with an explicit development override.
 */
export function normalizeServerUrl(raw: string, allowInsecure: boolean): { origin: string; insecure: boolean } {
  let url: URL
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`)
  } catch {
    throw new CliError(`"${raw}" is not a valid server URL`)
  }
  if (url.username || url.password) throw new CliError('Server URLs must not contain credentials')
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new CliError('Server URLs must use https://')
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) throw new CliError('Use the server origin only, e.g. https://alice.example.com')
  if (url.protocol === 'http:' && !isLoopback(url) && !allowInsecure) {
    throw new CliError(`Refusing plain HTTP to ${url.host}: credentials would travel unencrypted`, 'usage', 'Use https://, or pass --insecure-dev for a controlled development server')
  }
  return { origin: url.origin, insecure: url.protocol === 'http:' }
}

export function insecureWarning(profile: Profile): string | null {
  if (!profile.insecure) return null
  return `warning: profile "${profile.name}" uses unencrypted HTTP (${profile.server}); use only for local development`
}
