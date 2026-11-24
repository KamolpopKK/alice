import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { bootstrapOwner, createAgent, HttpClient } from '../helpers/client'
import { connectMcp, type McpHandle } from '../helpers/mcp'
let app: RunningApp
let owner: HttpClient
let mcp: McpHandle
let project: string
const route = () => `/client/v1/projects/${project}/knowledge/context`
const topic = async (name: string, description = '') => (await owner.post(`/client/v1/projects/${project}/knowledge/topics`, { name, description, mutationId: randomUUID() })).body.topic
const doc = async (title: string, body = 'Original source') => (await owner.post('/api/documents', { title, body })).body.document
const add = (t: any, d: any, revision: number) => owner.put(`/client/v1/knowledge/topics/${t.id}/documents/${d.id}`, { expectedRevision: revision, mutationId: randomUUID() })
beforeAll(async () => { app = await startApp(); owner = await bootstrapOwner(app); project = (await owner.post('/api/projects', { name: 'Context fixture' })).body.project.id; mcp = await connectMcp(app.url, (await createAgent(owner, 'Context reader')).token) })
afterAll(async () => { await mcp?.close(); await app?.stop() })

it('empty curation returns an explicit fallback without inventing candidates', async () => {
  const legacy = await doc('Legacy only')
  await owner.post(`/api/documents/${legacy.id}/links`, { projectId: project })
  const result = (await owner.get(route())).body
  expect(result.candidates).toEqual({ items: [], nextCursor: null })
  expect(result.fallback).toMatchObject({ tool: 'search_documents', args: { limit: 10 } })
  expect(result.discovery).toBe('curated-order')
})

it('orders topics/readings and deduplicates first positions before pagination with actual provenance', async () => {
  const b = await topic('Beta'), a = await topic('Alpha', 'Read the overview first.')
  const first = await doc('Overview'), second = await doc('Design'), third = await doc('History')
  await add(a, first, 1); await add(a, second, 2); await add(b, first, 1); await add(b, third, 2)
  await owner.post(`/api/documents/${first.id}/review`, { expectedRevision: 1 })
  const foreignProject = (await owner.post('/api/projects', { name: 'Source project' })).body.project.id
  await owner.post(`/api/documents/${first.id}/links`, { projectId: foreignProject })
  const seen = []
  let cursor: string | null = null
  do {
    const r: any = await mcp.ok('get_knowledge_context', { projectId: project, limit: 1, ...(cursor ? { cursor } : {}) })
    seen.push(...r.candidates.items.map((x: any) => x.document.id)); cursor = r.candidates.nextCursor
  } while (cursor)
  expect(seen).toEqual([first.id, second.id, third.id])
  const result = (await owner.get(route())).body
  expect(await mcp.ok('get_knowledge_context', { projectId: project })).toEqual(result)
  expect(result.topics.items[0]).toMatchObject({ name: 'Alpha', description: 'Read the overview first.' })
  expect(result.candidates.items[0]).toMatchObject({ document: { id: first.id, revision: 1, status: 'current', reviewedRevision: 1 }, projectContext: { items: [{ id: foreignProject }] }, read: { content: { args: { expectedRevision: 1 } } } })
  expect(result.candidates.items[0].document.body).toBeUndefined()
  expect((await owner.get(route() + '?topicId=' + b.id)).body.candidates.items.map((x: any) => x.document.id)).toEqual([first.id, third.id])
  await owner.patch(`/api/documents/${first.id}`, { body: 'Changed revision' })
  expect((await mcp.call(result.candidates.items[0].read.content.tool, result.candidates.items[0].read.content.args)).isError).toBe(true)
  expect((await owner.get(route())).body.candidates.items[0].document).toMatchObject({ revision: 2, status: 'unreviewed', reviewedRevision: null })
  await owner.post(`/api/documents/${third.id}/archive`)
  expect((await owner.get(route() + '?topicId=' + b.id)).body.candidates.items.map((x: any) => x.document.id)).toEqual([first.id])
})

it('bounds descriptions/candidates and returns lexical explanations with deliberate continuations', async () => {
  const t = await topic('Long context', 'x'.repeat(2000))
  const docs = []
  for (let i = 0; i < 21; i++) { const d = await doc(`Needle source ${i}`, '# Section\n' + 'large source '.repeat(500)); docs.push(d); await add(t, d, i + 1) }
  const result = await mcp.ok('get_knowledge_context', { projectId: project, topicId: t.id, q: 'Needle' })
  expect(result.candidates.items).toHaveLength(10)
  expect(result.discovery).toBe('lexical')
  expect(result.candidates.items.every((x: any) => x.match.field === 'title' && x.excerpt.length <= 200)).toBe(true)
  expect(result.topics.items[0].description).toHaveLength(500)
  expect(result.budget.truncations[0]).toMatchObject({ continuation: { tool: 'get_knowledge_topic', args: { id: t.id } } })
  expect((await mcp.ok('get_knowledge_topic', { id: t.id })).topic.description).toHaveLength(2000)
  expect(JSON.stringify(result).length).toBeLessThan(96000)
  const next = await mcp.ok('get_knowledge_context', { projectId: project, topicId: t.id, q: 'Needle', cursor: result.candidates.nextCursor })
  expect(new Set([...result.candidates.items, ...next.candidates.items].map((x: any) => x.document.id)).size).toBe(20)
  expect((await owner.get(route() + '?limit=20')).body.candidates.items).toHaveLength(20)
  const first = (await owner.get(route() + '?limit=1')).body
  expect((await owner.get(route() + '?q=changed&cursor=' + encodeURIComponent(first.candidates.nextCursor))).status).toBe(400)
})

it('validates boundaries, scope and auth consistently without rewriting task context', async () => {
  for (const query of ['limit=0', 'limit=21', 'cursor=invalid', 'topicId=knt_unknown']) expect((await owner.get(route() + '?' + query)).status).toBeGreaterThanOrEqual(400)
  expect((await owner.get('/client/v1/projects/prj_foreign/knowledge/context')).status).toBe(404)
  expect((await new HttpClient(app.url).get(route())).status).toBe(401)
  const other = (await owner.post('/api/projects', { name: 'Other scope' })).body.project.id
  const t = (await owner.post(`/client/v1/projects/${other}/knowledge/topics`, { name: 'Other', mutationId: randomUUID() })).body.topic
  expect((await owner.get(route() + '?topicId=' + t.id)).status).toBe(400)
})
