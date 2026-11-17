// Seeds a running Alice instance with demo data through the public HTTP API.
// Usage: ALICE_URL=http://127.0.0.1:8080 ALICE_BOOTSTRAP_TOKEN=... npx tsx scripts/seed-demo.ts
import { HttpClient, OWNER, createAgent, inviteHuman } from '../tests/helpers/client'

const url = process.env.ALICE_URL ?? 'http://127.0.0.1:8080'
const owner = new HttpClient(url)
const boot = await owner.post('/api/auth/bootstrap', { bootstrapToken: process.env.ALICE_BOOTSTRAP_TOKEN, ...OWNER })
if (boot.status !== 201) throw new Error(`bootstrap failed: ${JSON.stringify(boot.body)}`)
const bob = await inviteHuman(owner, 'bob', 'Bob Builder')
const bobId = (await bob.get('/api/auth/me')).body.actor.id
const agent = await createAgent(owner, 'Codex — backend')
const web = (await owner.post('/api/projects', { name: 'Website relaunch', description: 'New marketing site and docs.', labels: ['web'] })).body.project
const api = (await owner.post('/api/projects', { name: 'Public API', description: 'v2 of the REST API.', labels: ['api'] })).body.project
const tasks: Array<[string, string, string, string, string | null, string[]]> = [
  ['Draft homepage copy', web.id, 'backlog', 'medium', bobId, ['copy']],
  ['ออกแบบหน้าจอต้อนรับ', web.id, 'ready', 'high', null, ['design']],
  ['Set up CDN caching', web.id, 'in_progress', 'urgent', agent.id, ['infra']],
  ['Pagination for /v2/tasks', api.id, 'ready', 'high', null, ['backend']],
  ['Rate limit per token', api.id, 'blocked', 'medium', agent.id, ['backend', 'security']],
  ['Write migration guide', api.id, 'done', 'low', bobId, ['docs']],
  ['Old prototype cleanup', api.id, 'canceled', 'none', null, []],
  ['Triage support inbox', '', 'backlog', 'none', null, []],
]
for (const [title, projectId, status, priority, assigneeId, labels] of tasks) {
  await owner.post('/api/tasks', { title, projectId: projectId || null, status, priority, assigneeId, labels, dueAt: status === 'ready' ? '2026-11-20' : null })
}
console.log(`Seeded ${url} — sign in as ${OWNER.username} / ${OWNER.password}; agent token: ${agent.token}`)
