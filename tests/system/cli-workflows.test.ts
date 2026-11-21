import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp, tempDataDir, type RunningApp } from '../helpers/app'
import { HttpClient, bootstrapOwner, createAgent, inviteHuman } from '../helpers/client'
import { activityFor } from '../helpers/db'
import { alice, buildCli, cliHome, startAlice, type CliEnv } from '../helpers/cli'
import { connectMcp } from '../helpers/mcp'

describe('alice CLI domain workflows', () => {
  let app: RunningApp
  let owner: HttpClient
  let member: HttpClient
  let home: CliEnv
  let me: { id: string; displayName: string }
  const run = (args: string[], input?: string) => alice(home, args, input === undefined ? {} : { input })
  const json = async (args: string[], input?: string) => {
    const res = await run([...args, '--json'], input)
    if (res.code !== 0) throw new Error(`alice ${args.join(' ')} failed (${res.code}): ${res.stderr}`)
    return JSON.parse(res.stdout)
  }

  beforeAll(async () => {
    app = await startApp({
      env: {
        ALICE_DEVICE_POLL_INTERVAL: '1',
        ALICE_AUTH_RATE_LIMIT: '10000',
        ALICE_CLIENT_RATE_LIMIT: '10000',
        ALICE_DEVICE_RATE_LIMIT: '10000',
      },
    })
    owner = await bootstrapOwner(app)
    member = await inviteHuman(owner, 'mia', 'Mia Member')
    await buildCli()
    home = cliHome()
    await alice(home, ['profile', 'add', 'work', '--server', app.url])
    const login = await startAlice(home, ['auth', 'login', '--no-browser'])
    const [, code] = await login.waitForStderr(/code ([A-Z]{4}-[A-Z]{4})/)
    await member.post('/client/v1/device/approve', { userCode: code })
    expect((await login.done).code).toBe(0)
    me = (await json(['whoami'])).actor
  })
  afterAll(async () => {
    await app?.stop()
  })

  it('creates, updates, archives and restores projects as the signed-in human', async () => {
    const created = await json(['project', 'create', '--name', 'Mobile app', '--description', 'Ship v2', '--label', 'mobile,q3'])
    expect(created).toMatchObject({ name: 'Mobile app', description: 'Ship v2', labels: ['mobile', 'q3'], createdBy: { displayName: 'Mia Member', kind: 'human' } })
    expect(activityFor(app, created.id)[0]).toMatchObject({ verb: 'project.created', actor_id: me.id })

    const table = await run(['project', 'list'])
    expect(table.stdout.split('\n')[0]).toMatch(/^ID\s+NAME\s+LABELS/)
    expect(table.stdout).toContain('Mobile app')

    expect((await json(['project', 'update', created.id, '--clear-labels'])).labels).toEqual([])
    const refused = await run(['project', 'archive', created.id])
    expect(refused.code).toBe(2)
    expect(refused.stderr).toContain('--yes')
    expect((await json(['project', 'show', created.id])).archivedAt).toBeNull()
    expect((await json(['project', 'archive', created.id, '--yes'])).archivedAt).not.toBeNull()
    expect((await json(['project', 'restore', created.id])).archivedAt).toBeNull()
  })

  it('runs the task workflow with faithful filters, Markdown from stdin and relationships', async () => {
    const description = '# Plan\n\n- ขั้นที่ 1: ออกแบบ\n- step `two` with "quotes" and $HOME\n\n```sh\necho done\n```\n'
    const task = await json(['task', 'create', '--title', 'Design onboarding', '--description-file', '-', '--project', 'mobile APP', '--priority', 'high', '--due', '2030-01-15', '--label', 'ux', '--assignee', 'me'], description)
    expect(task).toMatchObject({ title: 'Design onboarding', description, priority: 'high', labels: ['ux'], assignee: { displayName: 'Mia Member' }, project: { name: 'Mobile app' } })
    expect(task.dueAt.slice(0, 10)).toBe('2030-01-15')

    const mine = await json(['task', 'list', '--assignee', 'me', '--status', 'backlog'])
    expect(mine.map((t: { id: string }) => t.id)).toEqual([task.id])
    const jsonl = await run(['task', 'list', '--project', 'Mobile app', '--jsonl'])
    const lines = jsonl.stdout.trim().split('\n')
    expect(lines.map((l) => JSON.parse(l).id)).toEqual([task.id])
    // stderr มีแค่คำเตือน ไม่มีข้อมูล
    expect(jsonl.stderr).not.toContain(task.id)
    expect(jsonl.stderr.trim().split('\n').every((l) => l.startsWith('warning:'))).toBe(true)

    const updated = await json(['task', 'update', task.id, '--status', 'ready', '--no-due', '--priority', 'urgent'])
    expect(updated).toMatchObject({ status: 'ready', dueAt: null, priority: 'urgent' })
    expect((await json(['task', 'assign', task.id, 'none'])).assignee).toBeNull()

    const claimed = await json(['task', 'claim', task.id])
    expect(claimed).toMatchObject({ status: 'in_progress', assignee: { displayName: 'Mia Member' } })
    const again = await run(['task', 'claim', task.id])
    expect(again.code).toBe(4)
    expect(again.stderr).toContain('cannot be claimed')

    const commentFile = path.join(tempDataDir('cli-md'), 'note.md')
    fs.writeFileSync(commentFile, 'Checked the **flows**.\nLooks good.')
    const comment = await json(['task', 'comment', task.id, '--body-file', commentFile])
    expect(comment.body).toBe('Checked the **flows**.\nLooks good.')
    expect((await json(['task', 'comments', task.id])).map((c: { id: string }) => c.id)).toEqual([comment.id])

    const sub = await json(['task', 'create', '--title', 'Wireframes', '--parent', task.id])
    const blocker = await json(['task', 'create', '--title', 'Brand colors'])
    await json(['task', 'block', task.id, '--by', blocker.id])
    const rel = await json(['task', 'relations', task.id])
    expect(rel.children.map((t: { id: string }) => t.id)).toEqual([sub.id])
    expect(rel.blockers.map((t: { id: string }) => t.id)).toEqual([blocker.id])
    const cycle = await run(['task', 'block', blocker.id, '--by', task.id])
    expect(cycle.code).toBe(4)
    await json(['task', 'unblock', task.id, '--by', blocker.id])
    expect((await json(['task', 'parent', sub.id, 'none'])).parentId).toBeNull()

    const done = await json(['task', 'complete', task.id, '--summary', 'Flows approved'])
    expect(done.task.status).toBe('done')
    expect(done.comment.body).toBe('Flows approved')
    expect((await run(['task', 'archive', sub.id])).code).toBe(2)
    expect((await json(['task', 'archive', sub.id, '--yes'])).archivedAt).not.toBeNull()
    expect((await json(['task', 'list', '--archived', 'archived'])).map((t: { id: string }) => t.id)).toContain(sub.id)
    expect((await json(['task', 'restore', sub.id])).archivedAt).toBeNull()

    const verbs = (await json(['task', 'activity', task.id])).map((e: { verb: string; actor: { displayName: string } }) => [e.verb, e.actor.displayName])
    expect(verbs).toContainEqual(['task.claimed', 'Mia Member'])
    expect(verbs).toContainEqual(['task.completed', 'Mia Member'])
    for (const e of activityFor(app, task.id)) expect(e.actor_id).toBe(me.id)

    const detail = await run(['task', 'show', task.id, '--comments'])
    expect(detail.stdout).toContain('Design onboarding')
    expect(detail.stdout).toContain('completion summary')
  })

  it('pages automatically within an explicit bound', async () => {
    for (let i = 0; i < 7; i++) await json(['task', 'create', '--title', `Paged ${i}`, '--label', 'paged'])
    const first = await run(['task', 'list', '--label', 'paged', '--limit', '3', '--json'])
    expect(JSON.parse(first.stdout)).toHaveLength(3)
    expect(first.stderr).toContain('Showing the first 3')
    expect(JSON.parse((await run(['task', 'list', '--label', 'paged', '--all', '--json'])).stdout)).toHaveLength(7)
    expect((await run(['task', 'list', '--limit', '0'])).code).toBe(2)
    expect((await run(['task', 'list', '--status', 'doing'])).code).toBe(2)
  })

  it('never resolves an ambiguous or unknown name to a mutation target', async () => {
    await owner.post('/client/v1/projects', { name: 'Ops' })
    await owner.post('/client/v1/projects', { name: 'ops' })
    const before = (await owner.get('/client/v1/tasks?q=Ambiguity')).body.items.length
    const ambiguous = await run(['task', 'create', '--title', 'Ambiguity check', '--project', 'Ops'])
    expect(ambiguous.code).toBe(2)
    expect(ambiguous.stderr).toMatch(/matches 2 projects: prj_\w+, prj_\w+/)
    const unknown = await run(['task', 'create', '--title', 'Ambiguity check', '--project', 'Nowhere'])
    expect(unknown.code).toBe(4)
    expect((await owner.get('/client/v1/tasks?q=Ambiguity')).body.items.length).toBe(before)
    expect((await run(['task', 'show', 'tsk_doesnotexist000000'])).code).toBe(4)
    expect((await run(['task', 'create', '--title', ''])).code).toBe(2)
  })

  it('keeps document bodies byte-for-byte and manages links and revisions', async () => {
    const body = 'บันทึกการออกแบบ\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nTrailing spaces kept:   \n\n'
    const file = path.join(tempDataDir('cli-doc'), 'design.md')
    fs.writeFileSync(file, body)
    const task = (await owner.post('/client/v1/tasks', { title: 'Doc target' })).body.task
    const knowledgeOwner = await createAgent(owner, 'Knowledge CLI Bot')
    const doc = await json([
      'doc', 'create', '--title', 'Design notes', '--body-file', file, '--task', task.id,
      '--tag', 'architecture,release', '--keyword', 'system design', '--keyword', 'launch guide', '--status', 'draft', '--owner', knowledgeOwner.id,
    ])
    expect(doc).toMatchObject({ body, tags: ['architecture', 'release'], searchKeywords: ['launch guide', 'system design'], status: 'draft', owner: { id: knowledgeOwner.id } })
    expect(doc.links.tasks.map((t: { id: string }) => t.id)).toEqual([task.id])
    const raw = await run(['doc', 'show', doc.id, '--body-only'])
    expect(raw.stdout).toBe(body)

    const v2 = await json(['doc', 'update', doc.id, '--body-file', '-'], 'Second version\n')
    expect(v2.revision).toBe(2)
    expect((await json(['doc', 'revisions', doc.id])).map((r: { number: number }) => r.number)).toEqual([2, 1])
    expect((await run(['doc', 'restore-revision', doc.id, '1'])).code).toBe(2)
    const restored = await json(['doc', 'restore-revision', doc.id, '1', '--yes'])
    expect(restored).toMatchObject({ revision: 3, body })

    const metadata = await json(['doc', 'update', doc.id, '--tag', 'architecture,production', '--keyword', 'deployment', '--owner', 'none'])
    expect(metadata).toMatchObject({ revision: 3, tags: ['architecture', 'production'], searchKeywords: ['deployment'], owner: null })
    expect((await json(['doc', 'list', '--tag', 'production', '--status', 'draft', '--owner', 'none'])).map((d: { id: string }) => d.id)).toContain(doc.id)
    const reviewed = await json(['doc', 'review', doc.id, '--revision', '3'])
    expect(reviewed).toMatchObject({ status: 'current', reviewedRevision: 3, reviewedBy: { displayName: 'Mia Member' } })
    expect((await json(['doc', 'unreview', doc.id, '--revision', '3'])).reviewedAt).toBeNull()
    const v4 = await json(['doc', 'update', doc.id, '--body', 'Fourth version'])
    expect(v4.revision).toBe(4)
    const staleReview = await run(['doc', 'review', doc.id, '--revision', '3', '--json'])
    expect(staleReview.code).toBe(4)
    expect(staleReview.stderr).toContain('revision 4, not 3')

    const related = await json(['doc', 'create', '--title', 'Related CLI note', '--body', 'Related'])
    expect((await json(['doc', 'relate', doc.id, related.id, '--type', 'related'])).changed).toBe(true)
    expect((await json(['doc', 'relations', doc.id, '--type', 'related'])).map((r: { document: { id: string } }) => r.document.id)).toContain(related.id)
    expect((await json(['doc', 'unrelate', doc.id, related.id, '--type', 'related'])).changed).toBe(true)
    const old = await json(['doc', 'create', '--title', 'Old CLI guide', '--body', 'Old'])
    await json(['doc', 'review', old.id, '--revision', '1'])
    const refusedSupersedes = await run(['doc', 'relate', doc.id, old.id, '--type', 'supersedes'])
    expect(refusedSupersedes.code).toBe(2)
    expect(refusedSupersedes.stderr).toContain('mark the target Superseded')
    expect(refusedSupersedes.stderr).toContain('--yes')
    await json(['doc', 'relate', doc.id, old.id, '--type', 'supersedes', '--yes'])
    expect((await json(['doc', 'show', old.id])).status).toBe('superseded')

    await json(['doc', 'link', doc.id, '--project', 'Mobile app'])
    const unlinked = await json(['doc', 'unlink', doc.id, '--task', task.id])
    expect(unlinked.changed).toBe(true)
    expect((await json(['doc', 'search', 'Design'])).map((d: { id: string }) => d.id)).toContain(doc.id)
    const search = await json(['search', 'deployment', '--kind', 'document', '--tag', 'production', '--owner', 'none'])
    expect(search[0]).toMatchObject({ id: doc.id, status: 'unreviewed', match: { field: 'keyword', value: 'deployment' }, owner: null })
    const humanSearch = await run(['search', 'deployment', '--kind', 'document'])
    expect(humanSearch.stdout).toMatch(/STATUS\s+OWNER\s+MATCH REASON/)
    expect(humanSearch.stdout).toContain('keyword: deployment')
    expect((await json(['doc', 'archive', doc.id, '--yes'])).archivedAt).not.toBeNull()
    expect((await json(['doc', 'restore', doc.id])).archivedAt).toBeNull()
    expect((await run(['doc', 'link', doc.id])).code).toBe(2)
  })

  it('shows actors, activity and search with machine-readable output', async () => {
    const actors = await json(['actor', 'list'])
    expect(actors.map((a: { displayName: string }) => a.displayName)).toEqual(expect.arrayContaining(['Olivia Owner', 'Mia Member']))
    const activity = await run(['activity', '--limit', '5', '--jsonl'])
    const events = activity.stdout.trim().split('\n').map((l) => JSON.parse(l))
    expect(events).toHaveLength(5)
    expect(events.every((e) => typeof e.verb === 'string')).toBe(true)
    const results = await json(['search', 'onboarding', '--kind', 'task'])
    expect(results[0]).toMatchObject({ kind: 'task', title: 'Design onboarding' })
    expect(results[0].snippet).not.toMatch(/[\u0001\u0002]/)
  })

  it('creates work an MCP agent can claim, with attribution intact on both sides', async () => {
    const created = await json(['task', 'create', '--title', 'Agent pickup', '--status', 'ready'])
    const bot = await createAgent(owner, 'Pickup Bot')
    const mcp = await connectMcp(app.url, bot.token)
    const claim = await mcp.ok('claim_task', { id: created.id })
    expect(claim.task.assignee.displayName).toBe('Pickup Bot')
    await mcp.close()
    const seen = await json(['task', 'show', created.id])
    expect(seen).toMatchObject({ status: 'in_progress', assignee: { displayName: 'Pickup Bot', kind: 'agent' }, createdBy: { displayName: 'Mia Member', kind: 'human' } })
  })

  it('opens resources in Desktop when registered and falls back to the Web URL', async () => {
    const task = (await owner.post('/client/v1/tasks', { title: 'Open me' })).body.task
    const web = await alice(home, ['open', 'task', task.id, '--print', '--json'], { extraEnv: { ALICE_DESKTOP: '0' } })
    expect(JSON.parse(web.stdout)).toEqual({ via: 'web', url: `${app.url}/tasks/${task.id}`, profile: 'work' })
    const desktop = await alice(home, ['open', 'task', task.id, '--print'], { extraEnv: { ALICE_DESKTOP: '1' } })
    expect(desktop.stdout.trim()).toBe(`alice://open/task/${task.id}?profile=work`)
    const forcedWeb = await alice(home, ['open', 'doc', 'doc_abcdefgh', '--web', '--print'], { extraEnv: { ALICE_DESKTOP: '1' } })
    expect(forcedWeb.stdout.trim()).toBe(`${app.url}/documents/doc_abcdefgh`)
    const bad = await alice(home, ['open', 'task', 'prj_wrongkind', '--print'], { extraEnv: { ALICE_DESKTOP: '1' } })
    expect(bad.code).toBe(2)
    expect(bad.stdout).toBe('')
    expect((await run(['open', 'user', 'usr_x', '--print'])).code).toBe(2)
  })
})
