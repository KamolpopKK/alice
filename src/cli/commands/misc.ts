import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compatibilityOf } from '../../client'
import { CLIENTS, SKILLS, installSkills, mcpConfigSnippet, parseSkillOption, skillTargetDir, type AgentClient, type SkillName } from '../../server/agent-setup'
import { CliContext, parseCommand } from '../context'
import { CliError } from '../errors'
import { CLI_VERSION, CLIENT_API_VERSION } from '../version'

/** Server commands that moved to `alice-server`; kept as forwarding aliases for one compatibility period. */
export const LEGACY_SERVER_COMMANDS = ['serve', 'migrate', 'backup', 'restore', 'export', 'purge'] as const
export const LEGACY_REMOVAL = 'Alice 0.4.0'

/** Installed Alice Desktop version, when it can be read without running the app. */
function desktopVersion(): string | null {
  if (process.platform !== 'darwin') return null
  for (const app of ['/Applications/Alice.app', path.join(os.homedir(), 'Applications/Alice.app')]) {
    try {
      const plist = fs.readFileSync(path.join(app, 'Contents/Info.plist'), 'utf8')
      const m = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)
      if (m) return m[1]
    } catch {
      /* not installed */
    }
  }
  return null
}

/** `alice-mcp-stdio --version`, from this installation or PATH. */
function adapterVersion(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const sibling = path.join(here, 'alice-mcp-stdio.js')
  const res = fs.existsSync(sibling)
    ? spawnSync(process.execPath, [sibling, '--version'], { encoding: 'utf8', timeout: 5000 })
    : spawnSync('alice-mcp-stdio', ['--version'], { encoding: 'utf8', timeout: 5000, shell: process.platform === 'win32' })
  const m = res.status === 0 ? /alice-mcp-stdio (\S+)/.exec(res.stdout ?? '') : null
  return m ? m[1] : null
}

/** Versions of one installed Agent skill for each client and scope. */
function skillVersions(skill: SkillName = 'alice'): Record<string, string> {
  const out: Record<string, string> = {}
  for (const client of CLIENTS) {
    for (const scope of ['user', 'project'] as const) {
      try {
        const text = fs.readFileSync(path.join(skillTargetDir(client, scope, undefined, undefined, skill), 'SKILL.md'), 'utf8')
        const m = /^version:\s*(\S+)/m.exec(text)
        if (m) out[`${client} (${scope})`] = m[1]
      } catch {
        /* not installed */
      }
    }
  }
  return out
}

export async function versionCommand(ctx: CliContext, args: string[]): Promise<number> {
  parseCommand(args, {})
  const result: Record<string, unknown> = {
    cli: CLI_VERSION,
    clientApi: CLIENT_API_VERSION,
    node: process.version,
    desktop: desktopVersion(),
    mcpAdapter: adapterVersion(),
    // `skills` คงรูปเดิม (skill alice) เพื่อ compat; `agentSkills` แยกตามชื่อ skill
    skills: skillVersions('alice'),
    agentSkills: Object.fromEntries(SKILLS.map((skill) => [skill, skillVersions(skill)])),
  }
  // ถ้ามี profile ก็รายงาน server ด้วย (ไม่ต้อง login และไม่ทำให้ล้มเหลวถ้าติดต่อไม่ได้)
  const hasProfile = ctx.flags.profile || ctx.flags.server || (ctx.config.activeProfile && !ctx.config.activeWorkspace)
  if (hasProfile) {
    try {
      const session = ctx.session()
      const info = await session.anonymousClient().info()
      const compat = compatibilityOf(info)
      result.server = { profile: session.profile.name, url: session.profile.server, version: info.serverVersion, clientApi: info.clientApi, compatible: compat.compatible }
    } catch (err) {
      result.server = { error: (err as Error).message }
    }
  }
  ctx.out.value(result, () => {
    ctx.out.line(`alice CLI ${CLI_VERSION} (Client API v${CLIENT_API_VERSION}, Node ${process.version})`)
    const server = result.server as { version?: string; url?: string; profile?: string; compatible?: boolean; error?: string } | undefined
    if (server?.version) ctx.out.line(`server ${server.version} at ${server.url} (profile ${server.profile})${server.compatible ? '' : ' — INCOMPATIBLE'}`)
    else if (server?.error) ctx.out.line(`server: unavailable (${server.error})`)
    ctx.out.line(`desktop ${result.desktop ?? 'not detected'}`)
    ctx.out.line(`alice-mcp-stdio ${result.mcpAdapter ?? 'not found'}`)
    for (const [skill, versions] of Object.entries(result.agentSkills as Record<string, Record<string, string>>)) {
      const found = Object.entries(versions)
      ctx.out.line(found.length ? `skill ${skill} ${found.map(([where, v]) => `${v} [${where}]`).join(', ')}` : `skill ${skill} not installed`)
    }
  })
  return 0
}

export async function installSkillCommand(ctx: CliContext, args: string[]): Promise<number> {
  const { values } = parseCommand(args, { client: { type: 'string' }, scope: { type: 'string', default: 'user' }, skill: { type: 'string' } })
  const client = values.client as AgentClient
  if (!CLIENTS.includes(client)) throw new CliError(`--client must be one of: ${CLIENTS.join(', ')}`)
  if (values.scope !== 'user' && values.scope !== 'project') throw new CliError('--scope must be user or project')
  const skills = parseSkillOption(values.skill)
  if (typeof skills === 'string') throw new CliError(skills)
  for (const [i, target] of installSkills(client, values.scope, skills).entries()) ctx.out.line(`Installed the ${skills[i]} skill to ${target}`)
  return 0
}

export async function mcpConfigCommand(ctx: CliContext, args: string[]): Promise<number> {
  const { values } = parseCommand(args, { client: { type: 'string' }, transport: { type: 'string', default: 'http' }, url: { type: 'string' } })
  const client = values.client as AgentClient
  if (!CLIENTS.includes(client)) throw new CliError(`--client must be one of: ${CLIENTS.join(', ')}`)
  if (values.transport !== 'http' && values.transport !== 'stdio') throw new CliError('--transport must be http or stdio')
  const active = ctx.config.activeProfile ? ctx.config.profiles[ctx.config.activeProfile]?.server : undefined
  const url = values.url ?? process.env.ALICE_PUBLIC_URL ?? active ?? 'http://localhost:8080'
  ctx.out.line(mcpConfigSnippet(client, url, values.transport))
  return 0
}

function serverEntry(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [path.join(here, 'alice-server.js'), path.join(here, 'cli.js')]
  return candidates.find((f) => fs.existsSync(f)) ?? null
}

/** Forwards `alice serve` & co. to `alice-server` unchanged, with a deprecation notice on stderr. */
export function legacyServerCommand(ctx: CliContext, command: string, args: string[]): number {
  ctx.out.warn(`alice: "alice ${command}" is deprecated; use "alice-server ${command}". The alias will be removed in ${LEGACY_REMOVAL}.`)
  const entry = serverEntry()
  if (!entry) throw new CliError(`"${command}" is a server command and this installation has no Alice Server`, 'usage', `Run it where the server is installed: alice-server ${command}`)
  const res = spawnSync(process.execPath, [entry, command, ...args], { stdio: 'inherit', env: { ...process.env, ALICE_LEGACY_ALIAS: '1' } })
  return res.status ?? 1
}
