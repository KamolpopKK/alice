import fs from 'node:fs'
import path from 'node:path'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'
// @ts-expect-error Build helper is ESM JavaScript shared with release packaging.
import { cliBuildOptions } from '../../scripts/cli-build.mjs'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { APP_VERSION, MCP_CONTRACT_VERSION } from '../../src/shared/version'
import { runCli, startApp, tempDataDir, type RunningApp } from '../helpers/app'
import { bootstrapOwner, createAgent, type AgentHandle } from '../helpers/client'
import { connectWithTransport } from '../helpers/mcp'
import { ALL_TOOLS } from '../helpers/tools'
import { DOCUMENT_HELP } from '../../src/cli/commands/document'
import { KNOWLEDGE_HELP } from '../../src/cli/commands/knowledge'

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

  it('orders the workflow: discovery, questions, internal check, backlog creation, ready, short report', () => {
    const steps = ['## 2. Discover', 'one question at a time', '## 3. Draft and check, without a chat review', 'status: "backlog"', '## 5. Make eligible tasks ready and report', 'status: "ready"', 'report briefly']
    const at = steps.map((s) => plan.indexOf(s))
    expect(at.every((i) => i > 0)).toBe(true)
    expect(at).toEqual([...at].sort((a, b) => a - b))
  })

  // แผนเขียนลงบอร์ดได้ทันที: ไม่มีร่างในแชทให้อนุมัติ และไม่ถามก่อนเปลี่ยนงานที่พร้อมเป็น ready
  it('writes plans directly and makes eligible leaves ready without a confirmation step', () => {
    expect(plan).toMatch(/without showing the draft in chat or waiting for approval/)
    expect(plan).toMatch(/Right after creation, without asking/)
    expect(plan).not.toMatch(/Show the complete plan in chat|after the person approves it|explicit approval|after confirmation/)
    expect(template).not.toMatch(/before asking for approval|เลยไหมครับ\?/)
    expect(template).toContain('## Report after creation')
    // การเริ่มทำงานยังต้องให้คนเลือกเอง
    expect(plan).toMatch(/Writing a plan\n  or making its tasks ready never implies permission to start/)
    expect(plan).toMatch(/Do not pick a mode from silence or from the plan having been written/)
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
    expect(plan).toMatch(/never write a plan with placeholders or missing main design decisions/)
    expect(plan).toMatch(/token is a secret/i)
    expect(plan).not.toMatch(/claim_task|complete_task/)
  })
})

describe('alice-think skill', () => {
  const think = fs.readFileSync(path.join(ROOT, 'skill/alice-think/SKILL.md'), 'utf8')

  it('has front matter that tracks the server and sends other work to the other skills', () => {
    const front = /^---\n([\s\S]*?)\n---\n/.exec(think)![1]
    expect(front).toMatch(/^name: alice-think$/m)
    expect(front).toContain(`version: ${APP_VERSION}`)
    const description = /^description: (.+)$/m.exec(front)![1]
    expect(description).toMatch(/use alice-plan/)
    expect(description).toMatch(/use alice\)/)
    expect(think).toContain(`MCP contract v${MCP_CONTRACT_VERSION}`)
  })

  it('names only MCP tools that exist in the contract', () => {
    const named = new Set([...think.matchAll(/`([a-z]+(?:_[a-z]+)+)\b/g)].map((m) => m[1]).filter((n) => /^(get|list|create|update|archive|restore|claim|complete|add|link|unlink|search|set|remove)_/.test(n)))
    for (const name of named) expect(ALL_TOOLS).toContain(name)
    for (const tool of ['search_documents', 'create_task', 'create_document', 'update_document', 'link_document', 'list_projects']) {
      expect(think).toContain(`\`${tool}`)
    }
  })

  it('triages first, confirms small work compactly, and questions only the rest', () => {
    const steps = ['## 1. Triage', '**Small and clear**', '## 2. Small and clear: compact confirmation', '## 3. Question', 'Ask in **rounds**', '## 4. Write the brief', '## 5. Confirm', '`create_document']
    const at = steps.map((s) => think.indexOf(s))
    expect(at.every((i) => i > 0)).toBe(true)
    expect(at).toEqual([...at].sort((a, b) => a - b))
    const small = think.slice(think.indexOf('## 2. Small'), think.indexOf('## 3. Question'))
    expect(small).toContain('status: "ready"')
    expect(small).toContain('Ask the person to confirm creation')
    expect(small).toContain('why a separate brief,\nspec or plan is not needed')
    expect(small).not.toMatch(/create_document/)
    expect(think).toMatch(/decision frontier is empty and a coverage audit passes/)
    // ถามเป็นรอบ; agent หาข้อเท็จจริงและเลือกรายละเอียดภายในตามแนวทางเดิมเอง
    const grill = think.slice(think.indexOf('## 3. Question'), think.indexOf('## 4. Write the brief'))
    for (const rule of ['every open question whose prerequisites are already settled', '❓ **Q1', '➡️', 'so that "yes" accepts your recommendation', 'Facts are your job; product decisions are the person\'s', '"I don\'t know" is an answer', 'user-visible behaviour,\n  scope, costs or commitments', 'Choose internal details yourself', '**Agreed**', '**Changed**', '**Remaining**', '**Recommendation**']) {
      expect(grill).toContain(rule)
    }
    expect(grill).not.toMatch(/up to \d+ questions/)
  })

  it('keeps unfinished thinking in chat and allows agreed standalone spikes', () => {
    expect(think).not.toMatch(/Draft:|save a draft|resume.*draft/i)
    const stopping = think.slice(think.indexOf('**Stopping before the brief is done.**'), think.indexOf('## 4. Write the brief'))
    expect(stopping).toContain('do not save an unfinished\nbrief to Alice')
    expect(stopping).toContain('summarize the agreements and remaining questions in chat')
    const spikes = think.slice(think.indexOf('## Spikes'), think.indexOf('## Recovering from errors'))
    for (const rule of ['only after the person agrees', 'does\nnot require a saved brief', 'labels: ["spike"]', 'description must stand on its own', 'context', 'question', 'expected result', 'time limit', 'If a saved brief exists', 'never create a document just to support a spike', 'wait for the findings before finishing the brief']) expect(spikes).toContain(rule)
  })

  it('settles product agreements and recommends design or planning without invoking them', () => {
    const grill = think.slice(think.indexOf('## 3. Question'), think.indexOf('## 4. Write the brief'))
    expect(grill).toContain('the decision frontier is empty and a coverage audit passes')
    expect(grill).toContain('An unknown that could\n  change an agreement blocks handover')
    expect(grill).toContain('record their owner, next step and why they do not block')
    const handover = think.slice(think.indexOf('## 5. Confirm'), think.indexOf('## Spikes'))
    expect(handover).toContain('**Technical design needed:** recommend `alice-spec`')
    expect(handover).toContain('**Existing technical patterns are sufficient:** recommend `alice-plan`')
    expect(handover).toContain('do not invoke `alice-spec` or `alice-plan`')
    expect(handover).toContain('brief id/path and related references')
    expect(handover).toContain('If `alice-spec` is not\n     installed, say so')
  })

  it('selects a project during discovery and uses one confirmation bundle', () => {
    const grill = think.slice(think.indexOf('## 3. Question'), think.indexOf('## 4. Write the brief'))
    expect(grill).toContain('Choose the project during discovery')
    expect(grill).toContain('Settle this before showing the brief or task for approval, or creating an agreed spike')
    expect(grill).toContain('Build the confirmation bundle in step 5')
    expect(grill).toContain('complete title, description and project')
    expect(grill).toContain('neither route creates or saves silently')
    const approval = think.slice(think.indexOf('## 5. Confirm'), think.indexOf('## Spikes'))
    expect(approval).toContain('Show one confirmation bundle in chat')
    expect(approval).toContain('Act only on explicit approval')
    expect(approval).toContain('one approval of both the shared understanding and the content')
    expect(approval).toMatch(/project\s+selected during discovery/)
  })

  it('never saves a brief before approval and never works the tasks itself', () => {
    expect(think).toMatch(/Never save a brief to Alice before the person approves it/)
    expect(think).toMatch(/Never claim, start or complete tasks while thinking/)
    expect(think).not.toMatch(/claim_task|complete_task/)
    expect(think).toMatch(/token is a secret/i)
  })
})

describe('alice-curate skill', () => {
  const dir = path.join(ROOT, 'skill/alice-curate')
  const curate = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')
  const template = fs.readFileSync(path.join(dir, 'TEMPLATE.md'), 'utf8')
  const between = (from: string, to: string) => curate.slice(curate.indexOf(from), curate.indexOf(to))

  it('has YAML front matter that tracks the server and routes understanding to alice-understand', () => {
    const front = parseYaml(/^---\n([\s\S]*?)\n---\n/.exec(curate)![1])
    expect(front).toMatchObject({ name: 'alice-curate', version: APP_VERSION, description: expect.any(String) })
    expect(front.description.length).toBeGreaterThan(40)
    expect(front.description.length).toBeLessThanOrEqual(1024)
    expect(front.description).toContain('use alice-understand')
    expect(curate).toContain(`MCP contract v${MCP_CONTRACT_VERSION}`)
    expect(between('## When to use another skill', '## Recovering from errors')).toContain('`alice-understand`')
  })

  it('links only files that exist in its flat installed package', () => {
    for (const text of [curate, template]) {
      for (const [, link] of text.matchAll(/\]\(([^)#]+\.md)(?:#[^)]*)?\)/g)) {
        expect(fs.existsSync(path.join(dir, link)) || fs.existsSync(path.join(ROOT, 'skill/_shared', link)), link).toBe(true)
      }
    }
    for (const guide of ['DOCUMENT-KNOWLEDGE.md', 'TEMPLATE.md', 'PROJECT-FILES.md']) expect(curate).toContain(`[${guide}](${guide})`)
  })

  it('names only MCP tools and CLI commands that exist', () => {
    const both = `${curate}\n${template}`
    const named = new Set([...both.matchAll(/`([a-z]+(?:_[a-z]+)+)\b/g)].map((m) => m[1]).filter((n) => /^(get|list|create|update|archive|restore|claim|complete|add|link|unlink|search|set|remove|put|review|clear)_/.test(n)))
    for (const name of named) expect(ALL_TOOLS).toContain(name)
    for (const tool of ['search_documents', 'list_knowledge_topics', 'get_knowledge_topic', 'list_topic_documents', 'get_knowledge_context', 'get_document_preview', 'list_document_topics', 'list_document_relations', 'list_document_backlinks', 'get_document_outline', 'get_document', 'update_document', 'put_topic_document', 'remove_topic_document', 'update_knowledge_topic', 'link_document_relation']) {
      expect(curate).toContain(`\`${tool}`)
    }
    // คำสั่ง CLI ที่ skill อ้างต้องอยู่ใน help จริง
    for (const command of ['--knowledge-project', 'outline', 'content', 'backlinks', 'topics', 'relations']) expect(DOCUMENT_HELP).toContain(command)
    for (const command of ['topic list', 'topic update', 'member list', 'member put', 'member remove', 'context']) expect(KNOWLEDGE_HELP).toContain(command)
  })

  it('agrees scope and depth first and recommends A without treating it as the answer', () => {
    const scope = between('## 1. Agree scope and depth', '## 2. Inspect the structure')
    for (const rule of ['Reuse the workspace already chosen', 'One project by default', 'whole workspace only when the person asks', 'never\n  inspect the rest of its project', '**A — Focused inspection** (recommended)', '**B — Full content comparison**', 'more time and tokens', 'your recommendation is not the person\'s choice', 'Do not ask again when the\n  request already states scope and depth']) {
      expect(scope).toContain(rule)
    }
    expect(template).toContain('I will wait for your choice before starting')
  })

  it('inspects structure from project links and curation without overclaiming', () => {
    const structure = between('## 2. Inspect the structure', '## 3. Read content')
    for (const rule of ['`knowledgeProjectId` (actual\n   project links union active topic membership)', 'deduplicate\n   by document id', 'not from search excerpts', 'archived, unavailable or superseded', 'information to weigh, not errors on their own', 'because of its age, or a duplicate because titles look alike']) {
      expect(structure).toContain(rule)
    }
    const content = between('## 3. Read content', '## 4. Report in chat')
    for (const rule of ['`CONFLICT`', 'do not combine\nwindows from different revisions', 'Record the reason for each read', 'Read every document in the inventory to its end', 'Never fall back to A without saying so', 'never call the comparison complete', 'revision actually read and the heading or offset range', 'never\nclaim that every duplicate or conflict was found', '**Fact**', '**Suspicion**', '**Conflict**', '**Unknown**']) {
      expect(content).toContain(rule)
    }
  })

  it('reports in chat and stops without writes unless items are approved', () => {
    const report = between('## 4. Report in chat', '## 5. Propose')
    for (const rule of ['what was found → evidence → impact → proposal', 'separate from items that need a decision', 'no issues were found within the inspected scope', 'never certify', 'Do not save the report as a Document or create tasks unless the person asks', 'Without approval nothing changes']) {
      expect(report).toContain(rule)
    }
    expect(between('## Safety', '## Naming tasks')).toContain('Inspection never writes')
    expect(template).toContain('This is not a guarantee that the whole library is correct')
    expect(template).toContain('| # | Class | Found | Evidence | Impact | Proposal |')
    expect(curate).not.toMatch(/claim_task|complete_task|create_task|create_document|review_document|archive_document|archive_knowledge_topic/)
  })

  it('applies only the approved subset after re-reading the latest state', () => {
    const apply = between('## 5. Propose and apply', '## Curating project files')
    for (const rule of ['the revision\nit is based on', 'effect on revision and review', 'approve all, some or none', 'does not approve review, archive, restore or supersedes', 'Re-read the latest document', 'propose the revised item and\n   wait for approval', 'other people\'s edits survive', 'has no compare-and-swap', '`expectedRevision` and a new `mutationId`', 'same\n   `mutationId` and payload', 'applied, failed (with the error), not applied and why']) {
      expect(apply).toContain(rule)
    }
    for (const result of ['Applied', 'Not applied — changed since proposal', 'Failed', 'Not applied — not approved']) expect(template).toContain(result)
  })

  it('keeps project files to their own Markdown format', () => {
    const files = between('## Curating project files', '## When to use another skill')
    for (const rule of ['there are no topics,\nlifecycle status, review, backlinks or typed relations', 'Do not invent topics or\nstatus fields']) expect(files).toContain(rule)
  })
})

describe('alice-spec distribution', () => {
  it('installs only alice-spec with the shared project files guide for either client', () => {
    for (const client of ['codex', 'claude-code']) {
      const home = tempDataDir('spec-only')
      const result = runCli(['install-skill', '--client', client, '--skill', 'alice-spec'], { HOME: home })
      expect(result.status).toBe(0)
      const dir = path.join(home, client === 'codex' ? '.codex' : '.claude', 'skills')
      expect(fs.readdirSync(dir)).toEqual(['alice-spec'])
      const source = path.join(ROOT, 'skill/alice-spec')
      for (const file of fs.readdirSync(source)) {
        expect(fs.readFileSync(path.join(dir, 'alice-spec', file), 'utf8')).toBe(fs.readFileSync(path.join(source, file), 'utf8'))
      }
      const text = fs.readFileSync(path.join(dir, 'alice-spec/SKILL.md'), 'utf8')
      const front = parseYaml(/^---\n([\s\S]*?)\n---\n/.exec(text)![1])
      expect(front).toMatchObject({ name: 'alice-spec', version: APP_VERSION, description: expect.any(String) })
      expect(front.description.length).toBeLessThanOrEqual(1024)
      expect(text).toContain(`MCP contract v${MCP_CONTRACT_VERSION}`)
      const named = [...text.matchAll(/`([a-z]+(?:_[a-z]+)+)\b/g)].map((m) => m[1]).filter((n) => /^(get|list|create|update|archive|restore|claim|complete|add|link|unlink|search|set|remove)_/.test(n))
      for (const tool of named) expect(ALL_TOOLS).toContain(tool)
      expect(fs.readFileSync(path.join(dir, 'alice-spec/PROJECT-FILES.md'), 'utf8')).toBe(fs.readFileSync(path.join(ROOT, 'skill/_shared/PROJECT-FILES.md'), 'utf8'))
      expect(fs.readFileSync(path.join(dir, 'alice-spec/DOCUMENT-KNOWLEDGE.md'), 'utf8')).toBe(fs.readFileSync(path.join(ROOT, 'skill/_shared/DOCUMENT-KNOWLEDGE.md'), 'utf8'))
      expect(fs.readFileSync(path.join(dir, 'alice-spec/OUTPUT-FORMATS.md'), 'utf8')).toBe(fs.readFileSync(path.join(ROOT, 'skill/_shared/OUTPUT-FORMATS.md'), 'utf8'))
    }
  })
})

describe('documented installation in a clean environment', () => {
  it('standalone CLI installs the complete flat demo package for both clients without production setup', async () => {
    const bundle = tempDataDir('demo-bundle')
    await build({ ...cliBuildOptions(bundle, ROOT), logLevel: 'silent' })
    for (const client of ['codex', 'claude-code']) {
      const home = tempDataDir('demo-installed')
      const result = spawnSync(process.execPath, [path.join(bundle, 'alice.js'), 'install-skill', '--client', client, '--skill', 'alice-demo'], {
        cwd: home,
        env: { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') },
        encoding: 'utf8', timeout: 30_000,
      })
      expect(result.status, result.stderr).toBe(0)
      const installed = path.join(home, client === 'codex' ? '.codex' : '.claude', 'skills', 'alice-demo')
      for (const file of fs.readdirSync(path.join(ROOT, 'skill/alice-demo'))) {
        expect(fs.readFileSync(path.join(installed, file), 'utf8')).toBe(fs.readFileSync(path.join(ROOT, 'skill/alice-demo', file), 'utf8'))
      }
      for (const file of fs.readdirSync(path.join(ROOT, 'skill/_shared'))) {
        expect(fs.readFileSync(path.join(installed, file), 'utf8')).toBe(fs.readFileSync(path.join(ROOT, 'skill/_shared', file), 'utf8'))
      }
      expect(fs.existsSync(path.join(home, '.venv'))).toBe(false)
      expect(fs.existsSync(path.join(home, 'node_modules'))).toBe(false)
    }
  })

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
    for (const skill of ['alice', 'alice-plan', 'alice-think', 'alice-spec', 'alice-understand', 'alice-demo']) {
      expect(all.stdout).toContain(`Installed the ${skill} skill to ${path.join(home, '.claude/skills', skill)}`)
      expect(fs.readFileSync(path.join(home, '.claude/skills', skill, 'SKILL.md'), 'utf8')).toBe(fs.readFileSync(path.join(ROOT, 'skill', skill, 'SKILL.md'), 'utf8'))
      for (const file of fs.readdirSync(path.join(ROOT, 'skill', skill))) {
        expect(fs.readFileSync(path.join(home, '.claude/skills', skill, file), 'utf8')).toBe(fs.readFileSync(path.join(ROOT, 'skill', skill, file), 'utf8'))
      }
    }

    const only = tempDataDir('skills-only')
    expect(runCli(['install-skill', '--client', 'codex', '--skill', 'alice-plan'], { HOME: only }).status).toBe(0)
    expect(fs.readdirSync(path.join(only, '.codex/skills'))).toEqual(['alice-plan'])
    // ไฟล์กลาง (skill/_shared/) ติดไปกับทุก skill แม้ติดตั้งตัวเดียว
    const sharedFiles = ['PROJECT-FILES.md', 'DOCUMENT-KNOWLEDGE.md', 'OUTPUT-FORMATS.md']
    for (const file of sharedFiles) {
      const guide = fs.readFileSync(path.join(ROOT, 'skill/_shared', file), 'utf8')
      expect(fs.readFileSync(path.join(only, '.codex/skills/alice-plan', file), 'utf8')).toBe(guide)
      for (const skill of ['alice', 'alice-plan', 'alice-think', 'alice-spec', 'alice-understand', 'alice-demo']) {
        expect(fs.readFileSync(path.join(home, '.claude/skills', skill, file), 'utf8')).toBe(guide)
      }
    }

    const unknown = runCli(['install-skill', '--client', 'codex', '--skill', 'alice-ops'], { HOME: only })
    expect(unknown.status).toBe(1)
    expect(unknown.stderr).toContain('--skill must be one of: alice, alice-plan, alice-think, alice-spec, alice-understand, alice-demo')
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
