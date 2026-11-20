import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { alice, buildCli, cliHome, type CliEnv } from '../helpers/cli'
import { readLocator } from '../../src/local/locator'
import { workspacePaths } from '../../src/local/paths'
import { listWorkspaces } from '../../src/local/registry'
import { APP_VERSION } from '../../src/shared/version'

/** Codex and Claude through the CLI only, with skills, identities and revocation. */
const homes: CliEnv[] = []
const json = (s: string) => JSON.parse(s)
const ROOT = path.resolve(import.meta.dirname, '../..')

function home(): CliEnv {
  const h = cliHome('local-agents')
  h.env.HOME = path.join(h.configDir, 'user-home')
  fs.mkdirSync(h.env.HOME, { recursive: true })
  homes.push(h)
  return h
}

beforeAll(async () => {
  await buildCli()
}, 120_000)
afterAll(() => {
  for (const h of homes) {
    try {
      for (const ws of listWorkspaces(h.env.ALICE_HOME)) {
        const l = readLocator(workspacePaths(h.env.ALICE_HOME, ws.id).locator)
        if (l) process.kill(l.pid, 'SIGTERM')
      }
    } catch {
      /* none */
    }
  }
})

describe('Local agent integrations', () => {
  it('enable installs the CLI skills and gives each agent its own identity in every Local workspace', async () => {
    const h = home()
    const personal = json((await alice(h, ['workspace', 'create', '--json'])).stdout).data
    expect((await alice(h, ['task', 'create', '--title', 'Wake the daemon'])).code).toBe(0)

    const enabled = await alice(h, ['integration', 'enable', 'codex', '--json'])
    expect(enabled.code).toBe(0)
    const skill = fs.readFileSync(path.join(h.env.HOME, '.codex/skills/alice/SKILL.md'), 'utf8')
    expect(skill).toBe(fs.readFileSync(path.join(ROOT, 'skill/alice/SKILL.md'), 'utf8'))
    expect(skill).toContain('--as codex')
    expect(fs.existsSync(path.join(h.env.HOME, '.codex/skills/alice-plan/SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(h.env.HOME, '.claude/skills/alice'))).toBe(false)

    // workspace ที่สร้างทีหลังได้ agent ที่เลือกไว้เมื่อเปิดครั้งแรก
    const side = json((await alice(h, ['workspace', 'create', 'Side', '--json'])).stdout).data
    expect((await alice(h, ['task', 'create', '--workspace', 'side', '--title', 'In side', '--status', 'ready'])).code).toBe(0)
    const claim = await alice(h, ['--as', 'codex', '--workspace', 'side', 'task', 'list', '--status', 'ready', '--assignee', 'none', '--json'])
    const task = json(claim.stdout).data[0]
    expect(json((await alice(h, ['--as', 'codex', '--workspace', 'side', 'task', 'claim', task.id, '--json'])).stdout).data.assignee).toMatchObject({ displayName: 'Codex', kind: 'agent' })
    const context = json((await alice(h, ['--as', 'codex', '--workspace', 'side', 'task', 'context', task.id, '--json'])).stdout)
    expect(context).toMatchObject({ ok: true, workspace: { id: side.id, kind: 'local' }, data: { task: { id: task.id } } })
    expect((await alice(h, ['--as', 'claude-code', '--workspace', 'side', 'task', 'list'])).code).toBe(3)

    const list = json((await alice(h, ['integration', 'list', '--json'])).stdout).data
    const codex = list.find((a: { client: string }) => a.client === 'codex')
    expect(codex).toMatchObject({ optedIn: true, skills: { alice: APP_VERSION, 'alice-plan': APP_VERSION, 'alice-spec': APP_VERSION } })
    expect(codex.credentials.sort()).toEqual(['personal', 'side'])
    expect(JSON.stringify(list)).not.toContain('alice_lc_')
    // agent เปลี่ยน integration เองไม่ได้
    expect((await alice(h, ['--as', 'codex', 'integration', 'disable', 'codex'])).code).toBe(3)
    void personal
  })

  it('disable revokes at once, keeps history and assignments, warns, and unassigns only on request', async () => {
    const h = home()
    json((await alice(h, ['workspace', 'create', '--json'])).stdout)
    const task = json((await alice(h, ['task', 'create', '--title', 'Codex owns this', '--status', 'ready', '--json'])).stdout).data
    expect((await alice(h, ['integration', 'enable', 'claude-code'])).code).toBe(0)
    expect((await alice(h, ['--as', 'claude', 'task', 'claim', task.id])).code).toBe(0)
    expect((await alice(h, ['--as', 'claude', 'task', 'comment', task.id, '--body', 'Started'])).code).toBe(0)

    const disabled = await alice(h, ['integration', 'disable', 'claude-code'])
    expect(disabled.code).toBe(0)
    expect(disabled.stderr).toContain('1 open task(s) are still assigned to Claude')
    expect((await alice(h, ['--as', 'claude', 'task', 'list'])).code).toBe(3)
    const shown = json((await alice(h, ['task', 'show', task.id, '--comments', '--json'])).stdout).data
    expect(JSON.stringify(shown)).toContain('Claude')
    expect(shown.task?.assignee?.displayName ?? shown.assignee?.displayName).toBe('Claude')

    expect((await alice(h, ['integration', 'unassign', 'claude-code', '--yes'])).stderr).toContain('--workspace')
    const unassigned = json((await alice(h, ['integration', 'unassign', 'claude-code', '--workspace', 'personal', '--yes', '--json'])).stdout).data
    expect(unassigned.unassigned).toEqual([task.id])
    const after = json((await alice(h, ['task', 'show', task.id, '--json'])).stdout).data
    expect([after.task?.status ?? after.status, after.task?.assignee ?? after.assignee]).toEqual(['ready', null])
  })

  it('refresh reinstalls stale skills of opted-in agents only; doctor repairs missing skill files', async () => {
    const h = home()
    json((await alice(h, ['workspace', 'create', '--json'])).stdout)
    expect((await alice(h, ['integration', 'enable', 'codex'])).code).toBe(0)
    const file = path.join(h.env.HOME, '.codex/skills/alice/SKILL.md')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^version: .*$/m, 'version: 0.1.0'))
    fs.mkdirSync(path.join(h.env.HOME, '.claude/skills/alice'), { recursive: true })
    fs.writeFileSync(path.join(h.env.HOME, '.claude/skills/alice/SKILL.md'), 'version: 0.1.0\n')
    const refreshed = json((await alice(h, ['integration', 'refresh', '--json'])).stdout).data.refreshed
    expect(refreshed).toEqual([{ client: 'codex', installed: ['alice'] }])
    expect(fs.readFileSync(file, 'utf8')).toContain(`version: ${APP_VERSION}`)
    // Claude ไม่ได้เปิด: ไม่ถูกแตะ
    expect(fs.readFileSync(path.join(h.env.HOME, '.claude/skills/alice/SKILL.md'), 'utf8')).toBe('version: 0.1.0\n')

    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^version: .*$/m, 'version: 0.0.1'))
    expect((await alice(h, ['doctor', '--repair', '--yes'])).code).toBe(0)
    expect(fs.readFileSync(file, 'utf8')).toContain(`version: ${APP_VERSION}`)
  })
})
