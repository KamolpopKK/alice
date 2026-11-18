import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENT_GUIDE_CLIENTS, agentSetupGuide, claudeMcpAddCommand, tokenFileCommand } from '../../src/shared/agent-guide'
import { mcpConfigSnippet } from '../../src/server/agent-setup'
import { testDir } from '../helpers/tmp'

const ORIGIN = 'https://alice.example.com'

function allText(client: (typeof AGENT_GUIDE_CLIENTS)[number]['id']): string {
  const guide = agentSetupGuide(client, ORIGIN)
  return [guide.prompt, ...guide.steps.flatMap((s) => [s.title, s.description, s.code])].join('\n')
}

describe('agent setup guide', () => {
  it('normalises the origin and derives the MCP endpoint', () => {
    const guide = agentSetupGuide('claude-code', 'https://alice.example.com/some/path/')
    expect(guide.origin).toBe(ORIGIN)
    expect(guide.mcpUrl).toBe(`${ORIGIN}/mcp/v1`)
  })

  it.each(AGENT_GUIDE_CLIENTS.map((c) => c.id))('%s prompt walks the agent through the whole setup in order', (client) => {
    const { prompt, label } = agentSetupGuide(client, ORIGIN)
    expect(prompt).toContain(label)
    const milestones = [
      'node --version',
      `${ORIGIN}/downloads/alice.js`,
      `${ORIGIN}/downloads/alice-mcp-stdio.js`,
      `${ORIGIN}/downloads/manifest.json`,
      `install-skill --client ${client}`,
      'Connect MCP',
      'place the token myself',
      'whoami',
    ]
    const positions = milestones.map((m) => prompt.indexOf(m))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(prompt).toMatch(/Never ask me for the agent token/)
    expect(prompt).not.toMatch(/sudo /)
  })

  it.each(AGENT_GUIDE_CLIENTS.map((c) => c.id))('%s guide never contains a token value', (client) => {
    const text = allText(client)
    expect(text).not.toMatch(/alice_at_/)
    expect(text).not.toMatch(/Bearer [A-Za-z0-9_]{12,}/)
  })

  it('Claude Code uses the stdio adapter with the token file, matching `alice mcp-config`', () => {
    const guide = agentSetupGuide('claude-code', ORIGIN)
    const command = claudeMcpAddCommand(guide.origin)
    expect(command).toBe(
      `claude mcp add --scope user -e ALICE_URL=${ORIGIN} -e ALICE_TOKEN_FILE=$HOME/.config/alice/token --transport stdio alice -- alice-mcp-stdio`,
    )
    // --transport ต้องคั่นระหว่าง -e กับชื่อ server ไม่งั้น CLI อ่านชื่อเป็น env อีกคู่
    expect(command.indexOf('--transport stdio')).toBeGreaterThan(command.lastIndexOf('-e '))
    expect(command.indexOf('--transport stdio')).toBeLessThan(command.indexOf(' alice --'))
    expect(guide.prompt).toContain(command)
    expect(guide.steps.some((s) => s.code === command)).toBe(true)
    expect(mcpConfigSnippet('claude-code', ORIGIN, 'stdio').split('\n')).toContain(command)
    // ไม่มี token ใน shell profile อีกต่อไป
    const text = allText('claude-code')
    expect(text).not.toContain('export ALICE_TOKEN')
    expect(text).not.toContain('${ALICE_TOKEN}')
  })

  it('Codex appends the stdio adapter config only when it is missing', () => {
    const { prompt, steps } = agentSetupGuide('codex', ORIGIN)
    expect(prompt).toContain('no [mcp_servers.alice] section')
    expect(steps.some((s) => s.code === `alice mcp-config --client codex --url ${ORIGIN} >> ~/.codex/config.toml`)).toBe(true)
  })

  it.each(AGENT_GUIDE_CLIENTS.map((c) => c.id))('%s update guide refreshes tools and skills without touching the token or MCP config', (client) => {
    const { update, label } = agentSetupGuide(client, ORIGIN)
    const order = [`${ORIGIN}/downloads/manifest.json`, 'up to date', `${ORIGIN}/downloads/alice.js`, 'SHA-256', `install-skill --client ${client}`, 'before and after', 'whoami']
    const at = order.map((m) => update.prompt.indexOf(m))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect(at).toEqual([...at].sort((a, b) => a - b))
    expect(update.prompt).toContain(label)
    expect(update.prompt).toMatch(/Never read, print, change or ask for the agent token/)
    expect(update.prompt).toMatch(/Do not change the MCP configuration/)
    expect(update.prompt).not.toMatch(/claude mcp add|mcp-config|read -rs/)
    expect(update.steps.map((s) => s.title)).toEqual(['Compare versions', 'Download the new CLI and MCP adapter', 'Reinstall the skills', 'Restart and check'])
    expect(update.steps.some((s) => s.human)).toBe(false)
    expect([update.prompt, ...update.steps.map((s) => s.code)].join('\n')).not.toMatch(/alice_at_/)
  })

  it('only the token step is marked for the person to run', () => {
    for (const { id } of AGENT_GUIDE_CLIENTS) {
      const human = agentSetupGuide(id, ORIGIN).steps.filter((s) => s.human)
      expect(human).toHaveLength(1)
      expect(human[0].code).toBe(tokenFileCommand())
    }
  })

  it.each(['bash', 'zsh'])('the token command stores stdin silently with mode 0600 under %s', (shell) => {
    if (spawnSync('which', [shell]).status !== 0) return
    const home = testDir('alice-token-')
    const res = spawnSync(shell, ['-c', tokenFileCommand()], { env: { PATH: process.env.PATH, HOME: home }, input: 'alice_at_example\n', encoding: 'utf8' })
    expect(res.status).toBe(0)
    expect(res.stdout).not.toContain('alice_at_example')
    const file = path.join(home, '.config/alice/token')
    expect(fs.readFileSync(file, 'utf8')).toBe('alice_at_example')
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  })
})

describe('Local agent setup guide', () => {
  it('lets each agent set itself up with the alice command only: no server, token, MCP or sudo', async () => {
    const { localAgentSetupGuide, AGENT_GUIDE_CLIENTS, LOCAL_CLI_MISSING } = await import('../../src/shared/agent-guide')
    for (const { id } of AGENT_GUIDE_CLIENTS) {
      const g = localAgentSetupGuide(id)
      for (const cmd of ['alice version', `alice integration enable ${id}`, `alice --as ${id} workspace current --json`, `alice --as ${id} task list --status ready --json`]) expect(g.prompt).toContain(cmd)
      expect(g.prompt).toContain(LOCAL_CLI_MISSING)
      expect(g.steps.map((s) => s.code)).toEqual(['alice version', `alice integration enable ${id}`, `alice --as ${id} workspace current --json`])
      const text = [g.prompt, ...g.steps.map((s) => s.code), ...g.tryPrompts].join('\n')
      // ไม่มีสิ่งที่ Local ไม่มี และไม่มีอะไรหน้าตาเหมือน secret
      expect(text).not.toMatch(/https?:\/\/|\/mcp\/|token file|\.config\/alice|curl |claude mcp|codex mcp|alice_(at|rt|pat)_/i)
      expect(text).not.toMatch(/(^|\s)sudo\s/m)
      expect(g.tryPrompts.length).toBeGreaterThanOrEqual(3)
    }
  })
})
