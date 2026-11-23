import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const CLIENTS = ['claude-code', 'codex'] as const
export type AgentClient = (typeof CLIENTS)[number]

/** Agent skills shipped with Alice: implementation, planning, discovery and technical design. */
export const SKILLS = ['alice', 'alice-plan', 'alice-think', 'alice-spec', 'alice-understand', 'alice-demo'] as const
export type SkillName = (typeof SKILLS)[number]

/** Files under skill/_shared/ ship inside every skill, so whichever skill an agent uses has them. */
export const SHARED_DIR = '_shared'

export function skillSourceDir(skill: SkillName = 'alice'): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [path.resolve(here, '../../skill', skill), path.resolve(here, '../skill', skill)]
  const found = candidates.find((dir) => fs.existsSync(path.join(dir, 'SKILL.md')))
  if (!found) throw new Error(`The bundled ${skill} skill was not found next to this installation`)
  return found
}

/** Where each client loads user- or project-scoped skills from. */
export function skillTargetDir(client: AgentClient, scope: 'user' | 'project', home = os.homedir(), cwd = process.cwd(), skill: SkillName = 'alice'): string {
  const base = scope === 'user' ? home : cwd
  return path.join(base, client === 'claude-code' ? '.claude' : '.codex', 'skills', skill)
}

// standalone CLI bundle ฝังไฟล์ของทุก skill ไว้ตอน build (ไม่มีโฟลเดอร์ skill/ ข้าง ๆ)
declare const __ALICE_SKILL_FILES__: Record<string, Record<string, string>> | undefined

/** Skill files keyed by name: embedded in the standalone CLI, otherwise read from the installation. */
export function skillFiles(skill: SkillName = 'alice'): Record<string, string> {
  if (typeof __ALICE_SKILL_FILES__ !== 'undefined') {
    const files = __ALICE_SKILL_FILES__[skill]
    if (!files) throw new Error(`The ${skill} skill is not embedded in this build`)
    return files
  }
  const dir = skillSourceDir(skill)
  const read = (d: string) => Object.fromEntries(fs.readdirSync(d).map((file) => [file, fs.readFileSync(path.join(d, file), 'utf8')]))
  // skill/_shared/ คือไฟล์ที่ทุก skill ต้องมี (เช่น PROJECT-FILES.md): ติดตั้งลงในโฟลเดอร์ของแต่ละ skill
  const shared = path.join(dir, '..', SHARED_DIR)
  return { ...(fs.existsSync(shared) ? read(shared) : {}), ...read(dir) }
}

export function installSkill(client: AgentClient, scope: 'user' | 'project', home?: string, cwd?: string, skill: SkillName = 'alice'): string {
  const target = skillTargetDir(client, scope, home, cwd, skill)
  fs.mkdirSync(target, { recursive: true })
  for (const [file, content] of Object.entries(skillFiles(skill))) fs.writeFileSync(path.join(target, file), content)
  return target
}

/** Installs the named skills (default: every shipped skill) and returns their directories. */
export function installSkills(client: AgentClient, scope: 'user' | 'project', skills: readonly SkillName[] = SKILLS, home?: string, cwd?: string): string[] {
  return skills.map((skill) => installSkill(client, scope, home, cwd, skill))
}

/** Validates a `--skill` value; undefined means every skill. */
export function parseSkillOption(value: string | undefined): readonly SkillName[] | string {
  if (value === undefined) return SKILLS
  return (SKILLS as readonly string[]).includes(value) ? [value as SkillName] : `--skill must be one of: ${SKILLS.join(', ')}`
}

/** MCP configuration that references the token through the environment, never inline. */
export function mcpConfigSnippet(client: AgentClient, publicUrl: string, transport: 'http' | 'stdio'): string {
  const endpoint = new URL('/mcp/v1', publicUrl).href
  if (client === 'claude-code') {
    if (transport === 'http') {
      return [
        '# Claude Code (remote MCP). Keep ALICE_TOKEN in your shell environment or a secret manager.',
        `claude mcp add --scope user --transport http alice ${endpoint} --header 'Authorization: Bearer \${ALICE_TOKEN}'`,
        '',
        '# or commit this .mcp.json (Claude Code expands ${ALICE_TOKEN} from the environment):',
        JSON.stringify({ mcpServers: { alice: { type: 'http', url: endpoint, headers: { Authorization: 'Bearer ${ALICE_TOKEN}' } } } }, null, 2),
      ].join('\n')
    }
    const origin = new URL(publicUrl).origin
    return [
      '# Claude Code (local stdio adapter). The adapter reads the token file on every connection, so a',
      '# rotated token needs only a reconnect. Store it with mode 0600 in ~/.config/alice/token.',
      `claude mcp add --scope user -e ALICE_URL=${origin} -e ALICE_TOKEN_FILE=$HOME/.config/alice/token --transport stdio alice -- alice-mcp-stdio`,
      '',
      '# or the equivalent .mcp.json entry:',
      JSON.stringify(
        { mcpServers: { alice: { type: 'stdio', command: 'alice-mcp-stdio', args: [], env: { ALICE_URL: origin, ALICE_TOKEN_FILE: path.join(os.homedir(), '.config', 'alice', 'token') } } } },
        null,
        2,
      ),
    ].join('\n')
  }
  return [
    '# Codex: add to ~/.codex/config.toml. Store the token in a file readable only by you:',
    '#   umask 077 && printf %s "$ALICE_TOKEN" > ~/.config/alice/token',
    '[mcp_servers.alice]',
    'command = "alice-mcp-stdio"',
    `env = { ALICE_URL = "${publicUrl}", ALICE_TOKEN_FILE = "${path.join('~', '.config', 'alice', 'token').replace('~', os.homedir())}" }`,
  ].join('\n')
}
