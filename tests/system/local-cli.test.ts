import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { alice, buildCli, cliHome, type CliEnv } from '../helpers/cli'
import { tempDataDir } from '../helpers/app'
import { call, waitFor } from '../helpers/local'
import { capabilityAccount, type CapabilityHolder } from '../../src/local/capabilities'
import { readLocator } from '../../src/local/locator'
import { listWorkspaces } from '../../src/local/registry'
import { isProcessAlive, workspacePaths } from '../../src/local/paths'

/** The built CLI against real Local daemons, with Desktop closed. */
const homes: CliEnv[] = []
function home(): CliEnv {
  const h = cliHome('local-cli')
  // daemon ที่ CLI สตาร์ทใช้ credential store เดียวกับ CLI (ไฟล์ทดสอบ)
  homes.push(h)
  return h
}
const appData = (h: CliEnv) => h.env.ALICE_HOME
const json = (stdout: string) => JSON.parse(stdout)
const storedCapability = (h: CliEnv, wsId: string, holder: CapabilityHolder = 'owner') =>
  (JSON.parse(fs.readFileSync(h.credentialFile, 'utf8')) as Record<string, string>)[capabilityAccount(wsId, holder)] ?? null

beforeAll(async () => {
  await buildCli()
}, 120_000)

afterAll(() => {
  for (const h of homes) {
    try {
      for (const ws of listWorkspaces(appData(h))) {
        const locator = readLocator(workspacePaths(appData(h), ws.id).locator)
        if (locator) process.kill(locator.pid, 'SIGTERM')
      }
    } catch {
      /* nothing started */
    }
  }
})

async function ownerUrl(h: CliEnv, wsId: string) {
  const locator = readLocator(workspacePaths(appData(h), wsId).locator)!
  return { baseUrl: `http://127.0.0.1:${locator.port}`, owner: storedCapability(h, wsId)!, pid: locator.pid }
}

describe('Local workspaces from the CLI', () => {
  it('creates a workspace, auto-starts one daemon with Desktop closed and keeps stdout machine-clean', async () => {
    const h = home()
    const created = await alice(h, ['workspace', 'create', '--json'])
    expect(created.code).toBe(0)
    const ws = json(created.stdout)
    expect(ws).toMatchObject({ ok: true, workspace: { kind: 'local', alias: 'personal', name: 'Personal' }, data: { name: 'Personal' } })

    const add = await alice(h, ['task', 'create', '--title', 'Write the Local CLI tests'])
    expect(add.code).toBe(0)
    expect(add.stderr).toContain('Starting Local workspace "personal"')
    expect(add.stderr).toContain('Workspace: Personal (personal, Local)')

    // คำสั่งพร้อมกันหลายตัวใช้ daemon ตัวเดียว
    const runs = await Promise.all(Array.from({ length: 4 }, (_, i) => alice(h, ['task', 'create', '--title', `Parallel ${i}`, '--json'])))
    for (const r of runs) {
      expect(r.code).toBe(0)
      expect(r.stderr).not.toContain('Starting')
      expect(json(r.stdout)).toMatchObject({ ok: true, workspace: { id: ws.data.id, kind: 'local' } })
    }
    const list = await alice(h, ['task', 'list', '--json'])
    const body = json(list.stdout)
    expect(body.ok).toBe(true)
    expect(body.data.map((t: { title: string }) => t.title).sort()).toEqual(['Parallel 0', 'Parallel 1', 'Parallel 2', 'Parallel 3', 'Write the Local CLI tests'])
    const lines = await alice(h, ['task', 'list', '--jsonl'])
    for (const line of lines.stdout.trim().split('\n')) expect(JSON.parse(line)).toMatchObject({ ok: true, workspace: { kind: 'local' } })

    const who = json((await alice(h, ['whoami', '--json'])).stdout)
    expect(who.data.actor).toMatchObject({ displayName: 'Local Owner', isOwner: true })
    expect((await alice(h, ['auth', 'login'])).stderr).toContain('Local workspaces need no sign in')
    const open = json((await alice(h, ['open', 'task', body.data[0].id, '--print', '--json'])).stdout)
    expect(open.data.url).toBe(`alice://open/task/${body.data[0].id}?workspace=${ws.data.id}`)

    const listed = json((await alice(h, ['workspace', 'list', '--json'])).stdout)
    expect(listed.data).toEqual([expect.objectContaining({ id: ws.data.id, alias: 'personal', kind: 'local', active: true, state: 'running' })])
  })

  it('applies the selection precedence and refuses to guess', async () => {
    const h = home()
    const personal = json((await alice(h, ['workspace', 'create', '--json'])).stdout).data
    const side = json((await alice(h, ['workspace', 'create', 'Side project', '--alias', 'side', '--json'])).stdout).data

    // ไม่มี active และมีหลาย workspace: หยุดก่อนแก้ไขอะไร พร้อมรายการให้เลือก
    const ambiguous = await alice(h, ['task', 'create', '--title', 'Where?', '--json'])
    expect(ambiguous.code).toBe(2)
    const err = json(ambiguous.stdout)
    expect(err).toMatchObject({ ok: false, workspace: null, error: { code: 'VALIDATION_ERROR' } })
    expect(err.error.choices.map((c: { alias: string }) => c.alias).sort()).toEqual(['personal', 'side'])
    expect(fs.existsSync(workspacePaths(appData(h), personal.id).locator)).toBe(false)
    // profile แรกกลายเป็น active ตามพฤติกรรมเดิมของ Remote
    expect((await alice(h, ['profile', 'add', 'team', '--server', 'https://alice.example.com'])).code).toBe(0)

    const project = tempDataDir('bound-project')
    const nested = path.join(project, 'src', 'deep')
    fs.mkdirSync(nested, { recursive: true })
    const current = async (args: string[] = [], extraEnv: Record<string, string> = {}) =>
      json((await alice(h, ['workspace', 'current', '--json', ...args], { cwd: nested, extraEnv })).stdout).data

    expect((await alice(h, ['workspace', 'bind', 'team', '--portable'], { cwd: project })).code).toBe(0)
    expect(await current()).toMatchObject({ alias: 'team', kind: 'remote', source: 'portable-binding' })
    expect((await alice(h, ['workspace', 'bind', 'side', '--portable'], { cwd: project })).stderr).toContain('Portable bindings name a shared Remote workspace')
    expect((await alice(h, ['workspace', 'bind', 'side'], { cwd: project })).code).toBe(0)
    expect(await current()).toMatchObject({ id: side.id, source: 'local-binding' })
    expect(await current([], { ALICE_WORKSPACE: 'personal' })).toMatchObject({ id: personal.id, source: 'environment' })
    expect(await current(['--workspace', side.id], { ALICE_WORKSPACE: 'personal' })).toMatchObject({ id: side.id, source: 'option' })
    expect((await alice(h, ['workspace', 'current', '--workspace', 'Side project'], { cwd: nested })).stderr).toMatch(/display name.*side/)

    // binding ไม่ถูกเขียนเองโดยคำสั่งอื่น; ลบแล้วใช้ active ของ CLI
    expect((await alice(h, ['workspace', 'unbind'], { cwd: nested })).code).toBe(0)
    expect((await alice(h, ['workspace', 'unbind', '--portable'], { cwd: nested })).code).toBe(0)
    expect(fs.readdirSync(path.join(project, '.alice'))).toEqual([])
    expect((await alice(h, ['workspace', 'use', 'side'])).code).toBe(0)
    expect(await current()).toMatchObject({ id: side.id, source: 'active' })
    expect((await alice(h, ['profile', 'use', 'team'])).code).toBe(0)
    expect(await current()).toMatchObject({ alias: 'team', source: 'active' })

    expect((await alice(h, ['workspace', 'alias', 'side', 'team'])).stderr).toContain('already a Remote profile name')
    expect((await alice(h, ['workspace', 'rename', 'side', 'Personal'])).code).toBe(0)
    const renamed = json((await alice(h, ['workspace', 'list', '--json'])).stdout).data.filter((w: { kind: string }) => w.kind === 'local')
    expect(renamed.map((w: { name: string }) => w.name)).toEqual(['Personal', 'Personal'])
    expect(renamed.find((w: { alias: string }) => w.alias === 'side').id).toBe(side.id)
  })

  it('agent mode acts as the selected agent with the agent rules enforced server-side', async () => {
    const h = home()
    const ws = json((await alice(h, ['workspace', 'create', '--json'])).stdout).data
    const task = json((await alice(h, ['task', 'create', '--title', 'For Codex', '--status', 'ready', '--json'])).stdout).data
    const notEnabled = await alice(h, ['--as', 'codex', 'task', 'list', '--json'])
    expect(notEnabled.code).toBe(3)
    expect(json(notEnabled.stdout).error.message).toContain('Codex integration is not enabled')

    const { baseUrl, owner } = await ownerUrl(h, ws.id)
    expect((await call(baseUrl, '/local/v1/integrations/codex', { token: owner, body: { enabled: true } })).data).toMatchObject({ enabled: true, actor: { displayName: 'Codex', kind: 'agent', isOwner: false } })
    const codexCap = storedCapability(h, ws.id, 'codex')!

    const claim = await alice(h, ['--as', 'codex', 'task', 'claim', task.id, '--json'])
    expect(json(claim.stdout)).toMatchObject({ ok: true, workspace: { id: ws.id } })
    const noSummary = await alice(h, ['task', 'complete', task.id, '--json'], { extraEnv: { ALICE_AGENT: 'codex' } })
    expect(noSummary.code).toBe(2)
    expect(json(noSummary.stdout)).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
    expect((await alice(h, ['--as', 'codex', 'task', 'complete', task.id, '--summary', 'Done by Codex'])).code).toBe(0)
    const activity = json((await alice(h, ['task', 'activity', task.id, '--json'])).stdout).data
    expect(activity.filter((e: { actor?: { displayName?: string } | null; actorName?: string }) => JSON.stringify(e).includes('Codex')).length).toBeGreaterThan(0)

    // agent ทำงานเจ้าของไม่ได้ และ capability ของ agent ไม่ผ่าน argv
    expect((await call(baseUrl, '/local/v1/integrations/claude-code', { token: codexCap, body: { enabled: true } })).status).toBe(403)
    expect((await call(baseUrl, '/local/v1/shutdown', { token: codexCap, body: {} })).status).toBe(403)
    expect((await alice(h, ['--as', 'codex', 'task', 'create', '--title', 'Pretend done', '--status', 'done'])).code).toBe(4)
    expect((await alice(h, ['--as', 'claude', 'workspace', 'use', 'personal'])).code).toBe(0)

    // ปิด integration: คำสั่งถัดไปของ agent ล้มทันที แต่ประวัติยังอยู่
    await call(baseUrl, '/local/v1/integrations/codex', { token: owner, body: { enabled: false } })
    expect((await alice(h, ['--as', 'codex', 'task', 'list'])).code).toBe(3)
    expect(json((await alice(h, ['task', 'show', task.id, '--json'])).stdout).data.status).toBe('done')
  })

  it('a CLI-started daemon idles out and the next command starts it again', async () => {
    const h = home()
    const ws = json((await alice(h, ['workspace', 'create', '--json'])).stdout).data
    const env = { ALICE_LOCAL_IDLE_MS: '1000' }
    expect((await alice(h, ['task', 'create', '--title', 'one'], { extraEnv: env })).code).toBe(0)
    const { pid } = await ownerUrl(h, ws.id)
    await waitFor(() => !isProcessAlive(pid))
    const again = await alice(h, ['task', 'list', '--json'], { extraEnv: env })
    expect(again.stderr).toContain('Starting Local workspace')
    expect(json(again.stdout).data).toHaveLength(1)
  })
})
