import fs from 'node:fs'
import path from 'node:path'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { APP_VERSION, MCP_CONTRACT_VERSION } from '../../src/shared/version'
import { runCli, startApp, tempDataDir, type RunningApp } from '../helpers/app'
import { bootstrapOwner, createAgent, type AgentHandle } from '../helpers/client'
import { connectWithTransport } from '../helpers/mcp'
import { ALL_TOOLS } from '../helpers/tools'

const ROOT = path.resolve(import.meta.dirname, '../..')
const SKILL = fs.readFileSync(path.join(ROOT, 'skill/alice/SKILL.md'), 'utf8')

let app: RunningApp
let agent: AgentHandle

beforeAll(async () => {
  app = await startApp()
  agent = await createAgent(await bootstrapOwner(app), 'Setup Agent')
})
afterAll(async () => app?.stop())

describe('shipped agent skill', () => {
  it('has valid front matter whose version tracks the server', () => {
    const front = /^---\n([\s\S]*?)\n---\n/.exec(SKILL)![1]
    expect(front).toMatch(/^name: alice$/m)
    expect(front).toMatch(/^description: .{40,}$/m)
    expect(front).toContain(`version: ${APP_VERSION}`)
    expect(SKILL).toContain(`MCP contract v${MCP_CONTRACT_VERSION}`)
  })

  it('directs agents to claim, load context, communicate and complete with a summary', () => {
    const order = ['claim_task', 'get_task_context', 'add_comment', 'complete_task'].map((t) => SKILL.indexOf(t))
    expect(order.every((i) => i > 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(SKILL).toContain('CLAIM_FAILED')
    expect(SKILL).toMatch(/never print it/i)
    // ทุก tool ที่ skill อ้างถึงต้องมีจริงใน contract
    const mentioned = [...SKILL.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).filter((n) => n.includes('_') && /^(get|list|create|update|archive|restore|claim|complete|add|link|unlink|search|set|remove)_/.test(n))
    for (const name of mentioned) expect(ALL_TOOLS).toContain(name)
  })
})

describe('alice-plan skill', () => {
  const dir = path.join(ROOT, 'skill/alice-plan')
  const plan = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')
  const template = fs.readFileSync(path.join(dir, 'TEMPLATE.md'), 'utf8')
  const both = `${plan}\n${template}`

  it('has front matter that tracks the server and is distinct from the alice skill', () => {
    const front = /^---\n([\s\S]*?)\n---\n/.exec(plan)![1]
    expect(front).toMatch(/^name: alice-plan$/m)
    expect(front).toContain(`version: ${APP_VERSION}`)
    const description = /^description: (.+)$/m.exec(front)![1]
    expect(description).toMatch(/plan, break down, decompose/)
    expect(description).toMatch(/not for working on an existing task/)
    expect(plan).toContain(`MCP contract v${MCP_CONTRACT_VERSION}`)
    expect(plan).toContain('[TEMPLATE.md](TEMPLATE.md)')
  })

  it('names only MCP tools that exist in the contract', () => {
    const named = new Set([...both.matchAll(/`([a-z]+(?:_[a-z]+)+)\b/g)].map((m) => m[1]).filter((n) => ALL_TOOLS.includes(n) || /^(get|list|create|update|archive|restore|claim|complete|add|link|unlink|search|set|remove)_/.test(n)))
    expect(named.size).toBeGreaterThan(10)
    for (const name of named) expect(ALL_TOOLS).toContain(name)
    for (const tool of ['search', 'search_documents', 'list_tasks', 'create_document', 'create_task', 'add_task_blocker', 'link_document', 'update_task', 'get_task_relations']) {
      expect(plan).toContain(`\`${tool}`)
    }
  })

  it('orders the workflow: discovery, questions, chat draft, approval, backlog creation, release', () => {
    const steps = ['## 2. Discover', 'one question at a time', '## 3. Draft in chat', 'explicit approval', 'status: "backlog"', '## 5. Release', 'status: "ready"']
    const at = steps.map((s) => plan.indexOf(s))
    expect(at.every((i) => i > 0)).toBe(true)
    expect(at).toEqual([...at].sort((a, b) => a - b))
  })

  it('keeps the leaf template complete and the checklist in place', () => {
    const leaf = template.slice(template.indexOf('## Leaf task description'), template.indexOf('## Parent task description'))
    for (const heading of ['Outcome', 'Context', 'Scope', 'References', 'Steps', 'Acceptance criteria', 'Verification', 'Done when']) {
      expect(leaf).toContain(`## ${heading}`)
    }
    expect(template).toContain('## Pre-creation checklist')
    expect(template).toMatch(/planned at <commit>/)
  })

  it('never lets the planner work its own tasks and keeps the token rules', () => {
    expect(plan).toMatch(/Never claim, start or complete the tasks you create/)
    expect(plan).toMatch(/Never create, change or archive anything in Alice before the person approves/)
    expect(plan).toMatch(/token is a secret/i)
    expect(plan).not.toMatch(/claim_task|complete_task/)
  })
})

describe('documented installation in a clean environment', () => {
  it('installs the skill for Claude Code and Codex without touching the source', () => {
    const home = tempDataDir('home')
    for (const client of ['claude-code', 'codex']) {
      const res = runCli(['install-skill', '--client', client], { HOME: home })
      expect(res.status).toBe(0)
      const dir = client === 'claude-code' ? '.claude' : '.codex'
      expect(fs.readFileSync(path.join(home, dir, 'skills/alice/SKILL.md'), 'utf8')).toBe(SKILL)
    }
    const bad = runCli(['install-skill', '--client', 'vim'], { HOME: home })
    expect(bad.status).toBe(1)
    expect(bad.stderr).toContain('--client must be one of')
  })

  it('installs every shipped skill by default, or only the one named with --skill', () => {
    const home = tempDataDir('skills-home')
    const all = runCli(['install-skill', '--client', 'claude-code'], { HOME: home })
    expect(all.status).toBe(0)
    for (const skill of ['alice', 'alice-plan']) {
      expect(all.stdout).toContain(`Installed the ${skill} skill to ${path.join(home, '.claude/skills', skill)}`)
      expect(fs.readFileSync(path.join(home, '.claude/skills', skill, 'SKILL.md'), 'utf8')).toBe(fs.readFileSync(path.join(ROOT, 'skill', skill, 'SKILL.md'), 'utf8'))
    }

    const only = tempDataDir('skills-only')
    expect(runCli(['install-skill', '--client', 'codex', '--skill', 'alice-plan'], { HOME: only }).status).toBe(0)
    expect(fs.readdirSync(path.join(only, '.codex/skills'))).toEqual(['alice-plan'])
    // ไฟล์กลาง (skill/_shared/) ติดไปกับทุก skill แม้ติดตั้งตัวเดียว
    const guide = fs.readFileSync(path.join(ROOT, 'skill/_shared/PROJECT-FILES.md'), 'utf8')
    expect(fs.readFileSync(path.join(only, '.codex/skills/alice-plan/PROJECT-FILES.md'), 'utf8')).toBe(guide)
    for (const skill of ['alice', 'alice-plan']) expect(fs.readFileSync(path.join(home, '.claude/skills', skill, 'PROJECT-FILES.md'), 'utf8')).toBe(guide)

    const unknown = runCli(['install-skill', '--client', 'codex', '--skill', 'alice-ops'], { HOME: only })
    expect(unknown.status).toBe(1)
    expect(unknown.stderr).toContain('--skill must be one of: alice, alice-plan')
  })

  it('Claude Code config connects over remote MCP using the token from the environment', async () => {
    const res = runCli(['mcp-config', '--client', 'claude-code', '--url', app.url], {})
    expect(res.status).toBe(0)
    expect(res.stdout).not.toContain('alice_at_')
    const json = JSON.parse(res.stdout.slice(res.stdout.indexOf('\n{') + 1))
    const server = json.mcpServers.alice
    expect(server.headers.Authorization).toBe('Bearer ${ALICE_TOKEN}')
    // จำลองการ expand env ของ client
    const headers = { Authorization: server.headers.Authorization.replace('${ALICE_TOKEN}', agent.token) }
    const handle = await connectWithTransport(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } }))
    expect((await handle.ok('whoami')).actor.displayName).toBe('Setup Agent')
    await handle.close()
  })

  it('Claude Code stdio config connects with the token file and no token in the config', async () => {
    const home = tempDataDir('claude-home')
    const tokenFile = path.join(home, '.config/alice/token')
    fs.mkdirSync(path.dirname(tokenFile), { recursive: true })
    fs.writeFileSync(tokenFile, agent.token, { mode: 0o600 })
    const res = runCli(['mcp-config', '--client', 'claude-code', '--transport', 'stdio', '--url', app.url], { HOME: home })
    expect(res.status).toBe(0)
    expect(res.stdout).not.toContain('alice_at_')
    expect(res.stdout).toContain(`-e ALICE_TOKEN_FILE=$HOME/.config/alice/token --transport stdio alice -- alice-mcp-stdio`)
    const server = JSON.parse(res.stdout.slice(res.stdout.indexOf('\n{') + 1)).mcpServers.alice
    expect(server).toMatchObject({ type: 'stdio', command: 'alice-mcp-stdio', env: { ALICE_URL: new URL(app.url).origin, ALICE_TOKEN_FILE: tokenFile } })
    expect(server.env).not.toHaveProperty('ALICE_TOKEN')
    const handle = await connectWithTransport(
      new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', path.join(ROOT, 'src/stdio/adapter.ts')],
        cwd: ROOT,
        env: { PATH: process.env.PATH ?? '', ...server.env },
      }),
    )
    expect((await handle.ok('whoami')).actor.displayName).toBe('Setup Agent')
    await handle.close()
  })

  it('Codex config runs the stdio adapter with a token file', async () => {
    const home = tempDataDir('codex-home')
    const tokenFile = path.join(home, '.config/alice/token')
    fs.mkdirSync(path.dirname(tokenFile), { recursive: true })
    fs.writeFileSync(tokenFile, agent.token, { mode: 0o600 })
    const res = runCli(['mcp-config', '--client', 'codex', '--url', app.url], { HOME: home })
    expect(res.stdout).toContain('[mcp_servers.alice]')
    expect(res.stdout).not.toContain('alice_at_')
    const envLine = /env = \{ ALICE_URL = "([^"]+)", ALICE_TOKEN_FILE = "([^"]+)" \}/.exec(res.stdout)!
    expect(envLine[2]).toBe(tokenFile)
    const handle = await connectWithTransport(
      new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', path.join(ROOT, 'src/stdio/adapter.ts')],
        cwd: ROOT,
        env: { PATH: process.env.PATH ?? '', ALICE_URL: envLine[1], ALICE_TOKEN_FILE: envLine[2] },
      }),
    )
    expect((await handle.ok('whoami')).actor.displayName).toBe('Setup Agent')
    await handle.close()
  })
})
