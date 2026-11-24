import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { bootstrapOwner, createAgent, HttpClient, type ApiResponse } from '../helpers/client'
import { connectMcp, type McpHandle } from '../helpers/mcp'

let app: RunningApp
let owner: HttpClient
let mcp: McpHandle
let curatorHttp: HttpClient
let project: string
const mutation = () => randomUUID()
beforeAll(async () => {
  app = await startApp()
  owner = await bootstrapOwner(app)
  project = (await owner.post('/api/projects', { name: 'Knowledge' })).body.project.id
  const curator = await createAgent(owner, 'Curator')
  curatorHttp = new HttpClient(app.url)
  curatorHttp.bearer = curator.token
  mcp = await connectMcp(app.url, curator.token)
})
afterAll(async () => {
  await mcp?.close()
  await app?.stop()
})
const path = () => `/client/v1/projects/${project}/knowledge/topics`

describe('project knowledge topics', () => {
  it('creates, updates, archives and restores with the same HTTP/MCP domain rules', async () => {
    const input = { name: 'Authentication', description: 'Start with the current account specification.', mutationId: mutation() }
    const res = await owner.post(path(), input)
    expect(res.status).toBe(201)
    const topic = res.body.topic
    expect(topic).toMatchObject({ projectId: project, name: input.name, description: input.description, revision: 1, archivedAt: null })
    expect((await mcp.ok('get_knowledge_topic', { id: topic.id })).topic).toEqual(topic)
    const changed = await mcp.ok('update_knowledge_topic', { id: topic.id, name: 'Accounts', expectedRevision: 1, mutationId: mutation() })
    expect(changed.topic).toMatchObject({ name: 'Accounts', revision: 2 })
    expect((await owner.patch(`/client/v1/knowledge/topics/${topic.id}`, { name: 'Old edit', expectedRevision: 1, mutationId: mutation() })).body.error.code).toBe('CONFLICT')
    const archive = await owner.post(`/client/v1/knowledge/topics/${topic.id}/archive`, { expectedRevision: 2, mutationId: mutation() })
    expect(archive.body.topic.archivedAt).toBeTruthy()
    expect((await owner.get(path())).body.items.find((t: any) => t.id === topic.id)).toBeUndefined()
    expect((await owner.get(path() + '?archived=archived')).body.items.map((t: any) => t.id)).toContain(topic.id)
    expect((await mcp.ok('restore_knowledge_topic', { id: topic.id, expectedRevision: 3, mutationId: mutation() })).topic).toMatchObject({ archivedAt: null, revision: 4 })
  })

  it('replays across channels before revision checks and rejects mutationId payload reuse', async () => {
    const input = { projectId: project, name: 'Replay', mutationId: mutation() }
    const created = await mcp.ok('create_knowledge_topic', input)
    expect(await mcp.ok('create_knowledge_topic', input)).toEqual(created)
    const body = { name: 'Replayed edit', expectedRevision: 1, mutationId: mutation() }
    const changed = await owner.patch(`/client/v1/knowledge/topics/${created.topic.id}`, body)
    expect(changed.status).toBe(200)
    expect((await owner.patch(`/client/v1/knowledge/topics/${created.topic.id}`, body)).body).toEqual(changed.body)
    const agentChange = { id: created.topic.id, name: 'Agent replay', expectedRevision: 2, mutationId: mutation() }
    const agentResult = await mcp.ok('update_knowledge_topic', agentChange)
    expect(await mcp.ok('update_knowledge_topic', agentChange)).toEqual(agentResult)
    const bad = await owner.patch(`/client/v1/knowledge/topics/${created.topic.id}`, { ...body, name: 'Another request' })
    expect(bad.body.error.code).toBe('IDEMPOTENCY_CONFLICT')
    expect((await mcp.call('update_knowledge_topic', { id: created.topic.id, ...body })).isError).toBe(true)
    expect((await curatorHttp.get(path())).status).toBe(401)
    const events = (await owner.get(`/api/activity?resourceType=project&resourceId=${project}&limit=200`)).body.items
    expect(events.filter((e: any) => e.verb === 'knowledge.topic.created' && e.data.topicId === created.topic.id)).toHaveLength(1)
  })

  it('normalizes active names, paginates and validates inputs without touching Document review', async () => {
    const doc = (await owner.post('/api/documents', { title: 'Reference', body: 'The actual source.' })).body.document
    await owner.post(`/api/documents/${doc.id}/review`, { expectedRevision: 1 })
    expect((await owner.post(path(), { name: 'Unicode', mutationId: mutation() })).status).toBe(201)
    expect((await owner.post(path(), { name: 'ＵＮＩＣＯＤＥ', mutationId: mutation() })).body.error.code).toBe('CONFLICT')
    for (const body of [{ name: '', mutationId: mutation() }, { name: 'Long', description: 'x'.repeat(2001), mutationId: mutation() }, { name: 'No mutation' }]) {
      expect((await owner.post(path(), body)).status).toBe(400)
    }
    const ids: string[] = []
    let cursor: string | null = null
    do {
      const r: ApiResponse = await owner.get(path() + `?limit=1${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`)
      expect(r.status).toBe(200)
      ids.push(...r.body.items.map((t: any) => t.id))
      cursor = r.body.nextCursor
    } while (cursor)
    expect(new Set(ids).size).toBe(ids.length)
    expect((await owner.get(`/api/documents/${doc.id}`)).body.document).toMatchObject({ revision: 1, status: 'current', body: 'The actual source.' })
    expect((await owner.get(path() + '?cursor=not-a-cursor')).status).toBe(400)
  })

  it('enforces auth, unknown ids and archived project boundaries', async () => {
    expect((await new HttpClient(app.url).get(path())).status).toBe(401)
    expect((await owner.get('/client/v1/knowledge/topics/knt_foreign')).status).toBe(404)
    expect((await owner.post('/client/v1/projects/prj_foreign/knowledge/topics', { name: 'Foreign', mutationId: mutation() })).status).toBe(404)
    const p = (await owner.post('/api/projects', { name: 'Closed project' })).body.project
    await owner.post(`/api/projects/${p.id}/archive`)
    expect((await owner.post(`/client/v1/projects/${p.id}/knowledge/topics`, { name: 'Closed', mutationId: mutation() })).body.error.code).toBe('INVALID_STATE')
  })

  it('rolls back the entire creation when its activity write fails', async () => {
    const failed = await startApp({ env: { ALICE_TEST_FAIL_ACTIVITY_VERB: 'knowledge.topic.created' } })
    try {
      const c = await bootstrapOwner(failed)
      const p = (await c.post('/api/projects', { name: 'Failure fixture' })).body.project.id
      const route = `/client/v1/projects/${p}/knowledge/topics`
      expect((await c.post(route, { name: 'Must roll back', mutationId: mutation() })).status).toBe(500)
      expect((await c.get(route)).body.items).toEqual([])
      expect((await c.get('/api/activity?limit=200')).body.items.some((e: any) => e.verb === 'knowledge.topic.created')).toBe(false)
    } finally { await failed.stop() }
  })
})
