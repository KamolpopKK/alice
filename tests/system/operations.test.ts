import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli, startApp, tempDataDir, type RunningApp } from '../helpers/app'
import { HttpClient, OWNER, bootstrapOwner, createAgent, inviteHuman } from '../helpers/client'
import { connectMcp } from '../helpers/mcp'
import { APP_VERSION } from '../../src/shared/version'

let app: RunningApp
let owner: HttpClient
let backupDir: string
let snapshotAtBackup: unknown

async function all(client: HttpClient, url: string): Promise<any[]> {
  const items: any[] = []
  let cursor: string | null = null
  do {
    const sep = url.includes('?') ? '&' : '?'
    const res: any = await client.get(`${url}${sep}limit=200${cursor ? `&cursor=${cursor}` : ''}`)
    items.push(...res.body.items)
    cursor = res.body.nextCursor
  } while (cursor)
  return items
}

/** Everything externally visible through the public API. */
async function snapshot(client: HttpClient) {
  const tasks = await all(client, '/api/tasks?archived=all&sort=created')
  const documents = await all(client, '/api/documents?archived=all')
  return {
    actors: (await client.get('/api/actors')).body.items,
    agents: (await client.get('/api/agents')).body.items.map((a: any) => ({ ...a, tokens: a.tokens.map((t: any) => ({ ...t, lastUsedAt: null })) })),
    projects: (await client.get('/api/projects?archived=all')).body.items,
    tasks,
    comments: await Promise.all(tasks.map((t) => all(client, `/api/tasks/${t.id}/comments`))),
    relations: await Promise.all(tasks.map(async (t) => (await client.get(`/api/tasks/${t.id}/relations`)).body)),
    documents: await Promise.all(documents.map(async (d) => (await client.get(`/api/documents/${d.id}`)).body.document)),
    revisions: await Promise.all(documents.map((d) => all(client, `/api/documents/${d.id}/revisions`))),
    activity: await all(client, '/api/activity'),
  }
}

async function login(url: string) {
  const client = new HttpClient(url)
  await client.post('/api/auth/login', { username: OWNER.username, password: OWNER.password })
  return client
}

beforeAll(async () => {
  app = await startApp()
  owner = await bootstrapOwner(app)
  await inviteHuman(owner, 'bob', 'Bob')
  const agent = await createAgent(owner, 'Ops Agent')
  const mcp = await connectMcp(app.url, agent.token)
  const project = (await owner.post('/api/projects', { name: 'Ops project', labels: ['ops'] })).body.project
  const t1 = (await owner.post('/api/tasks', { title: 'Backup me', projectId: project.id, status: 'ready', labels: ['x'] })).body.task
  const t2 = (await owner.post('/api/tasks', { title: 'Child', parentId: t1.id })).body.task
  await owner.post(`/api/tasks/${t2.id}/blockers`, { blockerId: t1.id })
  await mcp.ok('claim_task', { id: t1.id })
  await mcp.ok('add_comment', { taskId: t1.id, body: 'ความคืบหน้า: 50%' })
  const doc = (await owner.post('/api/documents', { title: 'Runbook', body: 'v1' })).body.document
  await owner.patch(`/api/documents/${doc.id}`, { body: 'v2' })
  await owner.post(`/api/documents/${doc.id}/links`, { taskId: t1.id })
  await owner.post(`/api/documents/${doc.id}/links`, { projectId: project.id })
  const dup = (await owner.post('/api/documents', { title: 'Runbook', sourceUrl: 'https://example.com/runbook' })).body.document
  await owner.post(`/api/documents/${dup.id}/archive`)
  await mcp.close()

  snapshotAtBackup = await snapshot(owner)
  backupDir = path.join(tempDataDir('backups'), 'b1')
  const res = runCli(['backup', '--out', backupDir], { ALICE_DATA_DIR: app.dataDir })
  expect(res.status, res.stderr).toBe(0)
  // เปลี่ยนข้อมูลหลัง backup — ต้องไม่อยู่ใน restore
  await owner.post('/api/tasks', { title: 'After backup' })
})
afterAll(async () => app?.stop())

describe('backup and restore', () => {
  it('produces a consistent database and manifest while the server runs', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, 'manifest.json'), 'utf8'))
    expect(manifest).toMatchObject({ format: 'alice-backup', formatVersion: 1, appVersion: APP_VERSION, database: { file: 'alice.db' } })
    expect(manifest.counts.tasks).toBe(2)
    expect(manifest.counts.document_revisions).toBe(3)
    const db = new Database(path.join(backupDir, 'alice.db'), { readonly: true })
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
    db.close()
  })

  it('restores into an inactive installation with identical externally visible state', async () => {
    const target = tempDataDir('restore')
    const res = runCli(['restore', '--from', backupDir], { ALICE_DATA_DIR: target })
    expect(res.status, res.stderr).toBe(0)
    const restored = await startApp({ dataDir: target })
    try {
      const client = await login(restored.url)
      const after = await snapshot(client)
      expect(after).toEqual(snapshotAtBackup)
      expect((await client.get('/api/search?q=backup')).body.items.map((r: any) => r.title)).toEqual(['Backup me'])
    } finally {
      await restored.stop()
    }
  })

  it('refuses tampered, incompatible and invalid backups without touching the target', () => {
    const tampered = path.join(tempDataDir('tamper'), 'b')
    fs.cpSync(backupDir, tampered, { recursive: true })
    const file = path.join(tampered, 'alice.db')
    const bytes = fs.readFileSync(file)
    bytes[bytes.length - 100] ^= 0xff
    fs.writeFileSync(file, bytes)
    const target = tempDataDir('restore-bad')
    const res = runCli(['restore', '--from', tampered], { ALICE_DATA_DIR: target })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('checksum does not match')
    expect(fs.existsSync(path.join(target, 'alice.db'))).toBe(false)

    const newer = path.join(tempDataDir('newer'), 'b')
    fs.cpSync(backupDir, newer, { recursive: true })
    const manifest = JSON.parse(fs.readFileSync(path.join(newer, 'manifest.json'), 'utf8'))
    fs.writeFileSync(path.join(newer, 'manifest.json'), JSON.stringify({ ...manifest, schemaVersion: 999 }))
    const res2 = runCli(['restore', '--from', newer], { ALICE_DATA_DIR: target })
    expect(res2.stderr).toContain('newer than this Alice')

    const res3 = runCli(['restore', '--from', tempDataDir('empty')], { ALICE_DATA_DIR: target })
    expect(res3.stderr).toContain('not an Alice backup')
    expect(fs.readdirSync(target)).toEqual([])
  })

  it('refuses to replace a running or existing installation unless explicitly asked', async () => {
    const running = runCli(['restore', '--from', backupDir, '--replace-existing'], { ALICE_DATA_DIR: app.dataDir })
    expect(running.status).toBe(1)
    expect(running.stderr).toMatch(/Alice is running \(pid \d+\)/)

    const target = tempDataDir('existing')
    expect(runCli(['restore', '--from', backupDir], { ALICE_DATA_DIR: target }).status).toBe(0)
    const again = runCli(['restore', '--from', backupDir], { ALICE_DATA_DIR: target })
    expect(again.stderr).toContain('--replace-existing')
    const replaced = runCli(['restore', '--from', backupDir, '--replace-existing'], { ALICE_DATA_DIR: target })
    expect(replaced.status).toBe(0)
    expect(replaced.stdout).toContain('previous database moved to')
    expect(fs.readdirSync(target).some((f) => f.startsWith('pre-restore-'))).toBe(true)
  })

  it('refuses a second server on the same data directory', async () => {
    await expect(startApp({ dataDir: app.dataDir })).rejects.toThrow(/Another Alice server/)
  })
})

describe('portable export', () => {
  it('writes JSON for every entity and Markdown with collision-safe paths, without secrets', () => {
    const out = path.join(tempDataDir('export'), 'e')
    const res = runCli(['export', '--out', out], { ALICE_DATA_DIR: app.dataDir })
    expect(res.status, res.stderr).toBe(0)
    const data = JSON.parse(fs.readFileSync(path.join(out, 'workspace.json'), 'utf8'))
    expect(data).toMatchObject({ format: 'alice-export', formatVersion: 1 })
    for (const key of ['actors', 'projects', 'tasks', 'taskBlockers', 'comments', 'documents', 'documentRevisions', 'taskDocuments', 'projectDocuments', 'activity']) {
      expect(Array.isArray(data[key]), key).toBe(true)
      expect(data[key].length, key).toBeGreaterThan(0)
    }
    expect(data.tasks.find((t: any) => t.title === 'Child').parentId).toBeTruthy()
    const raw = fs.readFileSync(path.join(out, 'workspace.json'), 'utf8')
    expect(raw).not.toMatch(/scrypt\$|password|token_hash|alice_at_/)

    const docs = fs.readdirSync(path.join(out, 'documents'))
    expect(docs.filter((f) => f.startsWith('runbook--'))).toHaveLength(2)
    const runbook = docs.map((f) => fs.readFileSync(path.join(out, 'documents', f), 'utf8')).find((c) => c.includes('v2'))!
    expect(runbook).toMatch(/^---\nid: "doc_/)
    const taskMd = fs.readFileSync(path.join(out, data.tasks.find((t: any) => t.title === 'Backup me').markdown), 'utf8')
    expect(taskMd).toContain('# Backup me')
    expect(taskMd).toContain('ความคืบหน้า: 50%')
    expect(taskMd).toContain('Ops Agent (agent)')
    expect(runCli(['export', '--out', out], { ALICE_DATA_DIR: app.dataDir }).stderr).toContain('not empty')
  })
})

describe('maintenance purge', () => {
  it('dry-runs exact effects, requires confirmation, and never purges the system project', async () => {
    const project = (await owner.post('/api/projects', { name: 'Doomed project' })).body.project
    const task = (await owner.post('/api/tasks', { title: 'Doomed task', projectId: project.id })).body.task
    await owner.post(`/api/tasks/${task.id}/comments`, { body: 'zeppelin comment' })
    await owner.post(`/api/tasks/${task.id}/archive`)
    await owner.post(`/api/projects/${project.id}/archive`)
    const keepProject = (await owner.post('/api/projects', { name: 'Archived but busy' })).body.project
    await owner.post('/api/tasks', { title: 'Still here', projectId: keepProject.id })
    await owner.post(`/api/projects/${keepProject.id}/archive`)
    const doc = (await owner.post('/api/documents', { title: 'Churned', body: 'r1' })).body.document
    await owner.patch(`/api/documents/${doc.id}`, { body: 'r2' })
    await owner.patch(`/api/documents/${doc.id}`, { body: 'r3' })
    await new Promise((r) => setTimeout(r, 20))
    const cutoff = new Date().toISOString()

    const dry = runCli(['purge', '--before', cutoff, '--archived', '--revisions'], { ALICE_DATA_DIR: app.dataDir })
    expect(dry.status, dry.stderr).toBe(0)
    expect(dry.stdout).toContain('archived tasks (with their comments, labels and links): 1')
    expect(dry.stdout).toContain('archived projects: 1 (skipped 1 that still contain tasks)')
    expect(dry.stdout).toMatch(/document revisions \(superseded\): \d+/)
    expect(dry.stdout).toContain('archived documents (with all revisions and links): 1')
    const code = /--confirm ([0-9a-f]{12})/.exec(dry.stdout)![1]
    expect((await owner.get(`/api/tasks/${task.id}`)).status).toBe(200)

    expect(runCli(['purge', '--before', cutoff, '--archived', '--revisions', '--execute'], { ALICE_DATA_DIR: app.dataDir }).stderr).toContain('--confirm')
    expect(runCli(['purge', '--before', cutoff, '--archived', '--revisions', '--execute', '--confirm', '000000000000'], { ALICE_DATA_DIR: app.dataDir }).stderr).toContain('does not match')

    const exec = runCli(['purge', '--before', cutoff, '--archived', '--revisions', '--execute', '--confirm', code], { ALICE_DATA_DIR: app.dataDir })
    expect(exec.status, exec.stderr).toBe(0)
    expect((await owner.get(`/api/tasks/${task.id}`)).status).toBe(404)
    expect((await owner.get(`/api/projects/${project.id}`)).status).toBe(404)
    expect((await owner.get(`/api/projects/${keepProject.id}`)).status).toBe(200)
    expect((await owner.get('/api/search?q=zeppelin&archived=all')).body.items).toHaveLength(0)
    const revisions = (await owner.get(`/api/documents/${doc.id}/revisions`)).body.items
    expect(revisions.map((r: any) => r.number)).toEqual([3])
    expect((await owner.get(`/api/documents/${doc.id}`)).body.document.body).toBe('r3')
    const projects = (await owner.get('/api/projects?archived=all')).body.items
    expect(projects.filter((p: any) => p.isSystem)).toHaveLength(1)
    const latest = (await owner.get('/api/activity?limit=1')).body.items[0]
    expect(latest).toMatchObject({ verb: 'maintenance.purged', actor: { displayName: 'Olivia Owner' } })

    expect(runCli(['purge', '--before', '2999-01-01', '--archived'], { ALICE_DATA_DIR: app.dataDir }).stderr).toContain('future')
    expect(runCli(['purge', '--before', cutoff], { ALICE_DATA_DIR: app.dataDir }).stderr).toContain('at least one scope')
  })
})
