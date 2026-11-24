import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import path from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { bootstrapOwner, createAgent, HttpClient } from '../helpers/client'
import { connectMcp, type McpHandle } from '../helpers/mcp'
let app: RunningApp
let owner: HttpClient
let mcp: McpHandle
let project: string
let source: string
let topic: any
let legacy: any
let curated: any
const make = async (title: string, input = {}) => (await owner.post('/api/documents', { title, body: 'Source document.', ...input })).body.document
const makeTopic = async (name: string, p = project) => (await owner.post(`/client/v1/projects/${p}/knowledge/topics`, { name, mutationId: randomUUID() })).body.topic
const link = (t: any, documentId: string, expectedRevision = 1) => owner.put(`/client/v1/knowledge/topics/${t.id}/documents/${documentId}`, { expectedRevision, mutationId: randomUUID() })
const discover = async (query: string) => (await owner.get('/client/v1/documents?' + query)).body
beforeAll(async () => {
  app = await startApp()
  owner = await bootstrapOwner(app)
  mcp = await connectMcp(app.url, (await createAgent(owner, 'Knowledge searcher')).token)
  project = (await owner.post('/api/projects', { name: 'Knowledge destination' })).body.project.id
  source = (await owner.post('/api/projects', { name: 'Original source project' })).body.project.id
  topic = await makeTopic('Accounts')
  legacy = await make('Authentication legacy')
  curated = await make('Authentication source', { tags: ['accounts'], searchKeywords: ['credential rotation'] })
  await owner.post(`/api/documents/${legacy.id}/links`, { projectId: project })
  await owner.post(`/api/documents/${curated.id}/links`, { projectId: source })
  await link(topic, curated.id)
})
afterAll(async () => {
  await mcp?.close()
  await app?.stop()
})

it('unions legacy links with curated cross-project sources and preserves AND filter meanings', async () => {
  const q = `knowledgeProjectId=${project}`
  expect((await discover(q)).items.map((d: any) => d.id).sort()).toEqual([legacy.id, curated.id].sort())
  expect((await discover(q + '&q=Authentication')).items).toHaveLength(2)
  expect((await discover(`projectId=${project}`)).items.map((d: any) => d.id)).toEqual([legacy.id])
  expect((await discover(q + `&projectId=${source}`)).items.map((d: any) => d.id)).toEqual([curated.id])
  expect((await discover(q + '&curatedOnly=true')).items.map((d: any) => d.id)).toEqual([curated.id])
  expect((await discover(q + '&curatedOnly=false')).items).toHaveLength(2)
  expect((await discover(q + `&topicId=${topic.id}&tag=accounts&status=unreviewed&ownerId=none`)).items.map((d: any) => d.id)).toEqual([curated.id])
  expect((await discover(q + `&topicId=${topic.id}&tag=wrong`)).items).toEqual([])
  const byKeyword = await mcp.ok('search_documents', { knowledgeProjectId: project, q: 'credential', curatedOnly: true })
  expect(byKeyword.items).toMatchObject([{ id: curated.id, match: { field: 'keyword', value: 'credential rotation' }, projectContext: { items: [{ id: source }] }, topicContext: { items: [{ id: topic.id }] } }])
  // Existing global search remains lexical, and receives the same additive filters.
  expect((await owner.get(`/client/v1/search?q=credential&knowledgeProjectId=${project}`)).body.items[0]).toMatchObject({ id: curated.id, match: { field: 'keyword' } })
})

it('retains lexical/lifecycle priority without promoting curated superseded over current', async () => {
  const current = await make('Rankneedle guide')
  const superseded = await make('Rankneedle guide', { status: 'superseded' })
  await owner.post(`/api/documents/${current.id}/review`, { expectedRevision: 1 })
  await owner.post(`/api/documents/${current.id}/links`, { projectId: project })
  await link(await makeTopic('Historical source'), superseded.id)
  const results = await discover(`q=Rankneedle&knowledgeProjectId=${project}`)
  expect(results.items.map((d: any) => d.id)).toEqual([current.id, superseded.id])
  expect(results.items[0]).toMatchObject({ status: 'current', reviewedRevision: 1, match: { field: 'title' } })
  expect((await owner.get(`/api/documents/${superseded.id}`)).body.document.status).toBe('superseded')
})

it('bounds topic provenance with a real continuation and avoids duplicate document rows', async () => {
  for (let i = 0; i < 6; i++) await link(await makeTopic(`Additional ${i}`), curated.id)
  const result = (await discover(`q=credential&knowledgeProjectId=${project}`)).items[0]
  expect(result.topicContext.items).toHaveLength(5)
  expect(result.topicContext.total).toBe(7)
  expect(result.topicContext.nextCursor).toBeTruthy()
  const next = await owner.get(`/client/v1/documents/${curated.id}/topics?archived=all&cursor=${encodeURIComponent(result.topicContext.nextCursor)}`)
  expect(next.body.items).toHaveLength(2)
  expect(new Set([...result.topicContext.items.map((t: any) => t.id), ...next.body.items.map((t: any) => t.topic.id)]).size).toBe(7)
  expect((await discover(`q=credential&knowledgeProjectId=${project}`)).items).toHaveLength(1)
  const first = await discover(`knowledgeProjectId=${project}&limit=1`)
  const second = await discover(`knowledgeProjectId=${project}&limit=1&cursor=${encodeURIComponent(first.nextCursor)}`)
  expect(second.items[0].id).not.toBe(first.items[0].id)
})

it('validates topic/project/workspace scope and archived cases without hiding ordinary Documents', async () => {
  const otherTopic = await makeTopic('Other project topic', source)
  for (const suffix of ['', '&q=Authentication']) {
    expect((await owner.get(`/client/v1/documents?knowledgeProjectId=${project}&topicId=${otherTopic.id}${suffix}`)).status).toBe(400)
    expect((await owner.get(`/client/v1/documents?knowledgeProjectId=prj_unknown${suffix}`)).status).toBe(404)
    expect((await owner.get(`/client/v1/documents?topicId=knt_unknown${suffix}`)).status).toBe(404)
  }
  const archivedTopic = await makeTopic('Archived curation')
  const only = await make('Archivedtopicneedle')
  await link(archivedTopic, only.id)
  await owner.post(`/client/v1/knowledge/topics/${archivedTopic.id}/archive`, { expectedRevision: 2, mutationId: randomUUID() })
  expect((await discover(`q=Archivedtopicneedle&knowledgeProjectId=${project}`)).items).toEqual([])
  expect((await discover('q=Archivedtopicneedle')).items).toHaveLength(1)
  expect((await owner.get(`/client/v1/documents?topicId=${archivedTopic.id}`)).body.error.code).toBe('INVALID_STATE')
  await owner.post(`/api/documents/${only.id}/archive`)
  expect((await discover('q=Archivedtopicneedle')).items).toEqual([])
  expect((await discover('q=Archivedtopicneedle&archived=all')).items).toHaveLength(1)
  expect((await new HttpClient(app.url).get(`/client/v1/documents?knowledgeProjectId=${project}`)).status).toBe(401)
  const db = new Database(path.join(app.dataDir, 'alice.db'))
  try {
    db.prepare("INSERT INTO workspaces(id,name,created_at) VALUES ('wsp_search_foreign','Foreign',?)").run(new Date().toISOString())
    // Move a dedicated valid project/topic to a different workspace to exercise both scope validators.
    const foreignProject = (await owner.post('/api/projects', { name: 'Foreign fixture' })).body.project.id
    const foreignTopic = await makeTopic('Foreign fixture topic', foreignProject)
    db.prepare('UPDATE projects SET workspace_id = ? WHERE id = ?').run('wsp_search_foreign', foreignProject)
    db.prepare('UPDATE knowledge_topics SET workspace_id = ? WHERE id = ?').run('wsp_search_foreign', foreignTopic.id)
    expect((await owner.get(`/client/v1/documents?knowledgeProjectId=${foreignProject}`)).status).toBe(404)
    expect((await owner.get(`/client/v1/documents?topicId=${foreignTopic.id}`)).status).toBe(404)
  } finally { db.close() }
})
