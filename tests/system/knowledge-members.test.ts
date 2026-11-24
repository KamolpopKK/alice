import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import { startApp, type RunningApp } from '../helpers/app'
import { bootstrapOwner, createAgent, HttpClient } from '../helpers/client'
import { connectMcp, type McpHandle } from '../helpers/mcp'

let app: RunningApp
let owner: HttpClient
let mcp: McpHandle
let project: string
const guard = (revision: number) => ({ expectedRevision: revision, mutationId: randomUUID() })
const route = (topic: string) => `/client/v1/knowledge/topics/${topic}/documents`
const makeTopic = async (name: string) => (await owner.post(`/client/v1/projects/${project}/knowledge/topics`, { name, mutationId: randomUUID() })).body.topic
const makeDoc = async (title: string) => (await owner.post('/api/documents', { title, body: 'Original source body.' })).body.document
beforeAll(async () => {
  app = await startApp()
  owner = await bootstrapOwner(app)
  project = (await owner.post('/api/projects', { name: 'Reading lists' })).body.project.id
  mcp = await connectMcp(app.url, (await createAgent(owner, 'Reading curator')).token)
})
afterAll(async () => {
  await mcp?.close()
  await app?.stop()
})

it('shares references across projects/topics, preserves review and actual project links', async () => {
  const source = (await owner.post('/api/projects', { name: 'Original project' })).body.project.id
  const doc = await makeDoc('Shared overview')
  await owner.post(`/api/documents/${doc.id}/links`, { projectId: source })
  await owner.post(`/api/documents/${doc.id}/review`, { expectedRevision: 1 })
  const original = (await owner.get(`/api/documents/${doc.id}`)).body.document
  const first = await makeTopic('Start here')
  const second = await makeTopic('Advanced')
  const other = (await owner.post(`/client/v1/projects/${source}/knowledge/topics`, { name: 'Source reading', mutationId: randomUUID() })).body.topic
  for (const t of [first, second, other]) {
    expect((await owner.put(`${route(t.id)}/${doc.id}`, guard(1))).body.topic.revision).toBe(2)
    const list = (await owner.get(route(t.id))).body
    expect(list.items).toHaveLength(1)
    expect(list.items[0]).toMatchObject({ document: { id: doc.id, status: 'current', revision: 1 }, projectContext: { items: [{ id: source, name: 'Original project' }], total: 1 } })
    expect(list.items[0].document.body).toBeUndefined()
  }
  expect((await owner.delete(`${route(first.id)}/${doc.id}`, guard(2))).body.changed).toBe(true)
  expect((await owner.get(`/api/documents/${doc.id}`)).body.document).toEqual(original)
  expect((await owner.get(route(second.id))).body.items).toHaveLength(1)
})

it('orders, rejects stale edits and foreign anchors, deduplicates no-ops and replays', async () => {
  const t = await makeTopic('Ordered')
  const a = await makeDoc('First'), b = await makeDoc('Second'), c = await makeDoc('Third')
  let rev = 1
  for (const d of [a, b, c]) expect((await owner.put(`${route(t.id)}/${d.id}`, guard(rev++))).body.changed).toBe(true)
  const cursor = (await owner.get(route(t.id) + '?limit=1')).body.nextCursor
  const input = { ...guard(rev), beforeDocumentId: a.id }
  const moved = await owner.put(`${route(t.id)}/${c.id}`, input)
  expect(moved.body.topic.revision).toBe(++rev)
  expect((await owner.put(`${route(t.id)}/${c.id}`, input)).body).toEqual(moved.body)
  expect((await owner.put(`${route(t.id)}/${c.id}`, { ...input, beforeDocumentId: b.id })).body.error.code).toBe('IDEMPOTENCY_CONFLICT')
  expect((await owner.get(route(t.id) + '?cursor=' + encodeURIComponent(cursor))).body.error.code).toBe('CONFLICT')
  expect((await owner.put(`${route(t.id)}/${a.id}`, guard(1))).body.error.code).toBe('CONFLICT')
  const invalid = { ...guard(rev), beforeDocumentId: (await makeDoc('Not in topic')).id }
  expect((await owner.put(`${route(t.id)}/${a.id}`, invalid)).status).toBe(400)
  expect((await owner.put(`${route(t.id)}/${a.id}`, { ...guard(rev), beforeDocumentId: a.id })).status).toBe(400)
  expect((await owner.put(`${route(t.id)}/${b.id}`, guard(rev))).body).toMatchObject({ changed: false, activityId: null, topic: { revision: rev } })
  const paged: string[] = []
  let next: string | null = null
  do {
    const page: any = await mcp.ok('list_topic_documents', { topicId: t.id, limit: 1, ...(next ? { cursor: next } : {}) })
    paged.push(...page.items.map((x: any) => x.document.id))
    next = page.nextCursor
  } while (next)
  expect(paged).toEqual([c.id, a.id, b.id])
  const replayInput = { topicId: t.id, documentId: a.id, ...guard(rev) }
  const replay = await mcp.ok('put_topic_document', replayInput)
  expect(await mcp.ok('put_topic_document', replayInput)).toEqual(replay)
  expect((await mcp.ok('remove_topic_document', { topicId: t.id, documentId: a.id, ...guard(rev + 1) })).changed).toBe(true)
  const events = (await owner.get(`/api/activity?resourceType=project&resourceId=${project}&limit=200`)).body.items
  expect(events.filter((e: any) => e.verb === 'knowledge.document.put' && e.data.topicId === t.id)).toHaveLength(5)
  const concurrent = await Promise.all([a, b].map((d) => owner.put(`${route(t.id)}/${d.id}`, guard(rev + 2))))
  expect(concurrent.map((r) => r.status).sort()).toEqual([200, 409])
})

it('rebalance stays inside its topic and archived references remain readable without writes', async () => {
  const t = await makeTopic('Dense list'), untouched = await makeTopic('Unchanged list')
  const a = await makeDoc('Dense first'), b = await makeDoc('Dense inserted')
  await owner.put(`${route(t.id)}/${a.id}`, guard(1))
  await owner.put(`${route(untouched.id)}/${a.id}`, guard(1))
  const db = new Database(path.join(app.dataDir, 'alice.db'))
  try { db.prepare('UPDATE knowledge_topic_documents SET order_key = ? WHERE topic_id = ?').run('0'.repeat(49) + '1', t.id) } finally { db.close() }
  const inserted = await owner.put(`${route(t.id)}/${b.id}`, { ...guard(2), beforeDocumentId: a.id })
  expect(inserted.status).toBe(200)
  const list = (await owner.get(route(t.id))).body
  expect(list.items.map((x: any) => x.document.id)).toEqual([b.id, a.id])
  expect(list.items.every((x: any) => x.orderKey.length <= 48)).toBe(true)
  expect((await owner.get(route(untouched.id))).body.topic.revision).toBe(2)
  await owner.post(`/api/documents/${a.id}/archive`)
  expect((await owner.get(route(t.id))).body.items[1].document.archivedAt).toBeTruthy()
  expect((await owner.put(`${route(t.id)}/${a.id}`, guard(3))).body.changed).toBe(false)
  const fresh = await makeTopic('Archived selection')
  expect((await owner.put(`${route(fresh.id)}/${a.id}`, guard(1))).body.error.code).toBe('INVALID_STATE')
  await owner.post(`/client/v1/knowledge/topics/${t.id}/archive`, guard(3))
  expect((await owner.delete(`${route(t.id)}/${a.id}`, guard(4))).body.error.code).toBe('INVALID_STATE')
  expect((await new HttpClient(app.url).get(route(t.id))).status).toBe(401)
  expect((await owner.get(route(t.id) + '?cursor=invalid')).status).toBe(400)
})

it('rolls back membership, revision and ledger on activity failure', async () => {
  const failed = await startApp({ env: { ALICE_TEST_FAIL_ACTIVITY_VERB: 'knowledge.document.put' } })
  try {
    const c = await bootstrapOwner(failed)
    const p = (await c.post('/api/projects', { name: 'Rollback reading' })).body.project.id
    const t = (await c.post(`/client/v1/projects/${p}/knowledge/topics`, { name: 'Rollback', mutationId: randomUUID() })).body.topic
    const d = (await c.post('/api/documents', { title: 'Safe source', body: 'Keep me' })).body.document
    const input = guard(1)
    for (let i = 0; i < 2; i++) expect((await c.put(`${route(t.id)}/${d.id}`, input)).status).toBe(500)
    expect((await c.get(route(t.id))).body).toMatchObject({ items: [], topic: { revision: 1 } })
    expect((await c.get('/api/activity?limit=200')).body.items.some((e: any) => e.verb === 'knowledge.document.put')).toBe(false)
  } finally { await failed.stop() }
})
