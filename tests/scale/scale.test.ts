import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli, startApp, tempDataDir, type RunningApp } from '../helpers/app'
import { HttpClient } from '../helpers/client'
import { connectMcp, type McpHandle } from '../helpers/mcp'
import { ENVELOPE, SCALE_OWNER, seedScale } from './seed'

/** p95 latency budgets in milliseconds for the declared envelope (documented in docs/release.md). */
export const BUDGETS_MS = {
  'list tasks (filtered, sorted)': 250,
  'list tasks (page 3 via cursor)': 250,
  'board (6 columns × 50)': 800,
  'my tasks': 250,
  'full-text search': 400,
  'task context (MCP)': 300,
  'list_tasks (MCP)': 300,
  'recent activity': 150,
  'create task': 150,
  'update task': 150,
}
const MAX_RSS_MB = 512
const RUNS = 25

let app: RunningApp
let client: HttpClient
let mcp: McpHandle
const results: Record<string, { p50: number; p95: number; max: number }> = {}

async function measure(name: keyof typeof BUDGETS_MS, fn: (i: number) => Promise<unknown>) {
  await fn(-1) // warm-up
  const times: number[] = []
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now()
    await fn(i)
    times.push(performance.now() - t)
  }
  times.sort((a, b) => a - b)
  const q = (p: number) => Math.round(times[Math.min(times.length - 1, Math.floor(p * times.length))] * 10) / 10
  results[name] = { p50: q(0.5), p95: q(0.95), max: Math.round(times[times.length - 1]) }
  return results[name]
}

function ok<T>(res: { status: number; body: T }): T {
  if (res.status >= 300) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`)
  return res.body
}

beforeAll(async () => {
  const dataDir = tempDataDir('scale')
  const { agentToken } = await seedScale(dataDir)
  app = await startApp({ dataDir })
  client = new HttpClient(app.url)
  ok(await client.post('/api/auth/login', { username: SCALE_OWNER.username, password: SCALE_OWNER.password }))
  mcp = await connectMcp(app.url, agentToken)
})
afterAll(async () => {
  await mcp?.close()
  await app?.stop()
  const report = path.resolve(import.meta.dirname, '../../.alice-test/scale-report.json')
  fs.mkdirSync(path.dirname(report), { recursive: true })
  fs.writeFileSync(report, JSON.stringify({ envelope: ENVELOPE, budgetsMs: BUDGETS_MS, results }, null, 2))
  console.table(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { ...v, budgetP95: BUDGETS_MS[k as keyof typeof BUDGETS_MS] ?? '' }])))
})

describe(`operating envelope: ${ENVELOPE.humans} humans, ${ENVELOPE.agents} agents, ${ENVELOPE.tasks} tasks`, () => {
  it('holds the seeded envelope', async () => {
    const actors = ok(await client.get('/api/actors')) as any
    expect(actors.items.filter((a: any) => a.kind === 'human')).toHaveLength(ENVELOPE.humans)
    expect(actors.items.filter((a: any) => a.kind === 'agent')).toHaveLength(ENVELOPE.agents)
    const metrics = await (await fetch(`${app.url}/readyz`)).json()
    expect(metrics.status).toBe('ready')
  })

  it('serves list, board, search, context, activity and mutations within budget', async () => {
    const projects = (ok(await client.get('/api/projects')) as any).items
    const projectId = projects[3].id
    await measure('list tasks (filtered, sorted)', (i) => client.get(`/api/tasks?projectId=${projectId}&status=ready,in_progress&sort=${['priority', 'due', 'updated'][Math.abs(i) % 3]}&limit=50`).then(ok))
    await measure('list tasks (page 3 via cursor)', async () => {
      let cursor = ''
      for (let p = 0; p < 3; p++) cursor = (ok(await client.get(`/api/tasks?limit=50&sort=updated${cursor ? `&cursor=${cursor}` : ''}`)) as any).nextCursor
    })
    await measure('board (6 columns × 50)', () => client.get(`/api/board?projectId=${projectId}`).then(ok))
    await measure('my tasks', () => client.get('/api/tasks?assigneeId=me&limit=100&sort=due').then(ok))
    const searches = [
      '/api/search?q=billing&limit=20',
      '/api/search?q=invoice%20report&limit=20',
      `/api/search?q=${encodeURIComponent('ลูกค้า')}&limit=20`,
      '/api/documents?q=alias-424&limit=20',
      '/api/documents?q=domain-7&tag=domain-7&status=current,draft,unreviewed&limit=20',
      `/api/search?q=source-18&kind=document&projectId=${projectId}&limit=20`,
      '/api/documents?q=bodyterm-12&ownerId=none&limit=20',
    ]
    await measure('full-text search', (i) => client.get(searches[Math.abs(i) % searches.length]).then(ok))
    const sample = (ok(await client.get('/api/tasks?limit=50&sort=created')) as any).items
    await measure('task context (MCP)', (i) => mcp.ok('get_task_context', { id: sample[Math.abs(i) % sample.length].id }))
    await measure('list_tasks (MCP)', () => mcp.ok('list_tasks', { status: ['ready'], assigneeId: ['none'], limit: 50 }))
    await measure('recent activity', () => client.get('/api/activity?limit=50').then(ok))
    await measure('create task', (i) => client.post('/api/tasks', { title: `Scale create ${i}`, projectId, labels: ['scale'] }).then(ok))
    await measure('update task', (i) => client.patch(`/api/tasks/${sample[Math.abs(i) % sample.length].id}`, { priority: ['low', 'high'][Math.abs(i) % 2] }).then(ok))

    for (const [name, budget] of Object.entries(BUDGETS_MS)) {
      expect(results[name]?.p95, `${name} p95 ${results[name]?.p95}ms > ${budget}ms`).toBeLessThanOrEqual(budget)
    }
  })

  it('keeps server memory bounded', () => {
    const rssKb = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(app.pid)]).toString().trim())
    expect(rssKb / 1024).toBeLessThan(MAX_RSS_MB)
    results['server RSS (MB)' as keyof typeof BUDGETS_MS] = { p50: Math.round(rssKb / 1024), p95: Math.round(rssKb / 1024), max: Math.round(rssKb / 1024) }
  })

  it('backs up, exports and restores scale-shaped data', () => {
    const backup = path.join(tempDataDir('scale-backup'), 'b')
    let t = performance.now()
    expect(runCli(['backup', '--out', backup], { ALICE_DATA_DIR: app.dataDir }).status).toBe(0)
    const backupMs = performance.now() - t
    const manifest = JSON.parse(fs.readFileSync(path.join(backup, 'manifest.json'), 'utf8'))
    expect(manifest.counts.tasks).toBeGreaterThanOrEqual(ENVELOPE.tasks)

    t = performance.now()
    const out = path.join(tempDataDir('scale-export'), 'e')
    expect(runCli(['export', '--out', out], { ALICE_DATA_DIR: app.dataDir }).status).toBe(0)
    const exportMs = performance.now() - t
    expect(fs.readdirSync(path.join(out, 'tasks')).length).toBeGreaterThanOrEqual(ENVELOPE.tasks)

    t = performance.now()
    const target = tempDataDir('scale-restore')
    expect(runCli(['restore', '--from', backup], { ALICE_DATA_DIR: target }).status).toBe(0)
    const restoreMs = performance.now() - t
    for (const [k, v] of Object.entries({ 'backup (CLI, s)': backupMs, 'export (CLI, s)': exportMs, 'restore (CLI, s)': restoreMs })) {
      const s = Math.round(v / 100) / 10
      results[k as keyof typeof BUDGETS_MS] = { p50: s, p95: s, max: s }
    }
  })
})
