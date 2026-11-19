import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { HttpClient, bootstrapOwner, inviteHuman } from '../helpers/client'
import { alice, buildCli, cliHome, startAlice, type CliEnv } from '../helpers/cli'
import { testDir } from '../helpers/tmp'

const V1 = '/client/v1'

/** Writes a project folder with a .alice/ board, like an agent keeps it without the app. */
function writeBoard(files: Record<string, string>): string {
  const root = path.join(testDir('alice-import-'), 'shop-app')
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, '.alice', file)), { recursive: true })
    fs.writeFileSync(path.join(root, '.alice', file), text)
  }
  return root
}

const BOARD = {
  'board.md': '---\nname: Shop app\n---\nNotes for the team.\n',
  'docs/D-1-checkout-design.md': '---\nid: D-1\ntitle: Checkout design\nsource_url: https://example.com/spec\n---\n# Checkout\n\nPay in one step.\n',
  'tasks/T-1-checkout.md': '---\nid: T-1\ntitle: Checkout\nstatus: in_progress\nassignee: Mia Member\nlabels: [plan:checkout]\n---\n## Outcome\nPeople can pay.\n',
  'tasks/T-2-payment-form.md':
    '---\nid: T-2\ntitle: Payment form\nstatus: ready\npriority: high\ndue: 2030-01-15\nparent: T-1\nblocked_by: [T-3]\ndocs: [D-1]\nlabels: [plan:checkout, ui]\n---\n## Outcome\nA form that takes a card.\n\n## Activity\n- 2026-11-19 claude-code: created from the plan\n- 2026-11-19 Mia: please keep it short\n',
  'tasks/T-3-api-keys.md': '---\nid: T-3\ntitle: Payment API keys\nstatus: done\nassignee: Nobody Here\nparent: T-1\n---\nGet keys from the provider.\n',
}

describe('alice import brings a Markdown board into a workspace', () => {
  let app: RunningApp
  let owner: HttpClient
  let member: HttpClient
  let home: CliEnv

  beforeAll(async () => {
    app = await startApp({ env: { ALICE_DEVICE_POLL_INTERVAL: '1' } })
    owner = await bootstrapOwner(app)
    member = await inviteHuman(owner, 'mia', 'Mia Member')
    await buildCli()
    home = cliHome()
    await alice(home, ['profile', 'add', 'work', '--server', app.url])
    const login = await startAlice(home, ['auth', 'login', '--no-browser'])
    const [, code] = await login.waitForStderr(/code ([A-Z]{4}-[A-Z]{4})/)
    await member.post(`${V1}/device/approve`, { userCode: code })
    expect((await login.done).code).toBe(0)
  })
  afterAll(async () => {
    await app?.stop()
  })

  it('checks the files first, then creates the project, tasks, relationships, links and history', async () => {
    const root = writeBoard(BOARD)
    const dry = await alice(home, ['import', '--dry-run', '--json'], { cwd: root })
    expect(dry.code, dry.stderr).toBe(0)
    expect(JSON.parse(dry.stdout)).toMatchObject({ dryRun: true, tasks: 3, documents: 1, blockers: 1, project: { name: 'Shop app', new: true } })
    expect((await owner.get(`${V1}/projects`)).body.items.map((p: { name: string }) => p.name)).not.toContain('Shop app')

    const res = await alice(home, ['import', '--json'], { cwd: root })
    expect(res.code, res.stderr).toBe(0)
    const out = JSON.parse(res.stdout)
    expect(out.warnings).toEqual(['No person or agent named "Nobody Here" in this workspace; their tasks are imported unassigned.'])
    const ids = out.tasks as Record<string, string>

    const t1 = (await owner.get(`${V1}/tasks/${ids['T-1']}`)).body.task
    const t2 = (await owner.get(`${V1}/tasks/${ids['T-2']}`)).body.task
    const t3 = (await owner.get(`${V1}/tasks/${ids['T-3']}`)).body.task
    expect(t1).toMatchObject({ title: 'Checkout', status: 'in_progress', assignee: { displayName: 'Mia Member' }, project: { id: out.project.id, name: 'Shop app' }, labels: ['plan:checkout'] })
    expect(t2).toMatchObject({ status: 'ready', priority: 'high', parentId: ids['T-1'], labels: ['plan:checkout', 'ui'], openBlockerCount: 0 })
    expect(t2.dueAt.slice(0, 10)).toBe('2030-01-15')
    expect(t2.description).toBe('## Outcome\nA form that takes a card.')
    expect(t3).toMatchObject({ status: 'done', assignee: null, parentId: ids['T-1'] })

    const relations = (await owner.get(`${V1}/tasks/${ids['T-2']}/relations`)).body
    expect(JSON.stringify(relations)).toContain(ids['T-3'])
    const doc = (await owner.get(`${V1}/documents/${out.documents['D-1']}`)).body.document
    expect(doc).toMatchObject({ title: 'Checkout design', sourceUrl: 'https://example.com/spec', body: '# Checkout\n\nPay in one step.' })
    expect(doc.links.tasks.map((t: { id: string }) => t.id)).toEqual([ids['T-2']])
    expect(doc.links.projects.map((p: { id: string }) => p.id)).toEqual([out.project.id])

    const comments = (await owner.get(`${V1}/tasks/${ids['T-2']}/comments`)).body.items
    expect(comments[0].body).toBe('Imported from tasks/T-2-payment-form.md (T-2).\n\nActivity:\n- 2026-11-19 claude-code: created from the plan\n- 2026-11-19 Mia: please keep it short')
    expect(comments[0].author.displayName).toBe('Mia Member')
    expect((await owner.get(`${V1}/tasks/${ids['T-3']}/comments`)).body.items[0].body).toContain('Assignee in the file: Nobody Here')

    const mapping = JSON.parse(fs.readFileSync(path.join(root, '.alice/imported.json'), 'utf8'))
    expect(mapping).toMatchObject({ project: out.project, tasks: ids, documents: out.documents })

    const again = await alice(home, ['import'], { cwd: root })
    expect(again.code).toBe(4)
    expect(again.stderr).toContain('already imported')
  })

  it('refuses broken files without creating anything, and lists every problem', async () => {
    const root = writeBoard({
      'tasks/T-1-a.md': '---\nid: T-1\ntitle: A\nstatus: doing\nparent: T-9\n---\n',
      'tasks/T-2-b.md': '---\nid: T-1\ntitle: B\nblocked_by: [T-7]\ndocs: [D-4]\n---\n',
      'tasks/T-3-c.md': 'no front matter here\n',
    })
    const before = (await owner.get(`${V1}/projects`)).body.items.length
    const res = await alice(home, ['import'], { cwd: root })
    expect(res.code).toBe(2)
    for (const problem of ['status must be one of', 'parent T-9 is not a task file', 'id T-1 is also used by', 'blocked_by T-7', 'docs D-4', 'tasks/T-3-c.md: missing front matter']) {
      expect(res.stderr).toContain(problem)
    }
    expect(res.stderr).toContain('Nothing was imported')
    expect((await owner.get(`${V1}/projects`)).body.items.length).toBe(before)
  })

  it('imports into an existing project with --project, and will not reuse a taken project name silently', async () => {
    const root = writeBoard({ 'board.md': '---\nname: Shop app\n---\n', 'tasks/T-1-x.md': '---\nid: T-1\ntitle: Extra task\n---\n' })
    const taken = await alice(home, ['import'], { cwd: root })
    expect(taken.code).toBe(2)
    expect(taken.stderr).toContain('A project named "Shop app" already exists')
    const res = await alice(home, ['import', '--project', 'shop APP', '--json'], { cwd: root })
    expect(res.code, res.stderr).toBe(0)
    const task = (await owner.get(`${V1}/tasks/${JSON.parse(res.stdout).tasks['T-1']}`)).body.task
    expect(task).toMatchObject({ title: 'Extra task', status: 'backlog', project: { name: 'Shop app' } })
  })
})
