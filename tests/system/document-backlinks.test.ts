import { randomUUID } from 'node:crypto'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { bootstrapOwner, createAgent, HttpClient } from '../helpers/client'
import { connectMcp, type McpHandle } from '../helpers/mcp'
let app: RunningApp
let owner: HttpClient
let mcp: McpHandle
const make = async (title: string, body = 'Original source') => (await owner.post('/api/documents', { title, body })).body.document
const backlinks = (id: string) => `/client/v1/documents/${id}/backlinks`
beforeAll(async () => {
  app = await startApp()
  owner = await bootstrapOwner(app)
  mcp = await connectMcp(app.url, (await createAgent(owner, 'Reference reader')).token)
})
afterAll(async () => {
  await mcp?.close()
  await app?.stop()
})

it('merges inline/manual references while keeping related/supersedes/membership separate', async () => {
  const target = await make('Target')
  const both = await make('Both', `[target](/documents/${target.id}) [again](/documents/${target.id}#part)`)
  const related = await make('Related')
  const replacement = await make('Replacement')
  await owner.post(`/api/documents/${both.id}/relations`, { targetId: target.id, type: 'references' })
  await owner.post(`/api/documents/${related.id}/relations`, { targetId: target.id, type: 'related' })
  await owner.post(`/api/documents/${replacement.id}/relations`, { targetId: target.id, type: 'supersedes', acknowledgeSupersedes: true })
  const project = (await owner.post('/api/projects', { name: 'Reference project' })).body.project
  const topic = (await owner.post(`/client/v1/projects/${project.id}/knowledge/topics`, { name: 'Reading source', mutationId: randomUUID() })).body.topic
  await owner.put(`/client/v1/knowledge/topics/${topic.id}/documents/${target.id}`, { expectedRevision: 1, mutationId: randomUUID() })
  const page = (await owner.get(backlinks(target.id))).body
  expect(page.items).toHaveLength(1)
  expect(page.items[0]).toMatchObject({ document: { id: both.id, revision: 1, status: 'unreviewed' }, provenance: ['inline', 'references'] })
  expect(page.items[0].document.body).toBeUndefined()
  expect(await mcp.ok('list_document_backlinks', { id: target.id })).toEqual(page)
  const memberships = await mcp.ok('list_document_topics', { id: target.id })
  expect(memberships.items).toMatchObject([{ topic: { id: topic.id }, project: { id: project.id } }])
  await owner.patch(`/api/documents/${both.id}`, { body: 'Removed the inline reference.' })
  expect((await owner.get(backlinks(target.id))).body.items[0].provenance).toEqual(['references'])
  await owner.delete(`/api/documents/${both.id}/relations`, { targetId: target.id, type: 'references' })
  expect((await owner.get(backlinks(target.id))).body.items).toEqual([])
  await owner.post(`/api/documents/${both.id}/revisions/1/restore`)
  expect((await owner.get(backlinks(target.id))).body.items[0]).toMatchObject({ document: { revision: 3 }, provenance: ['inline'] })
})

it('paginates deterministic sources, preserves identity on rename, excludes archived by default', async () => {
  const target = await make('Rename target')
  const sources: {
    id: string
    title: string
  }[] = []
  for (let i = 0; i < 4; i++) sources.push(await make(`Source ${i}`, `[target](/documents/${target.id})`))
  const ids: string[] = []
  let cursor: string | null = null
  do {
    const page: any = await mcp.ok('list_document_backlinks', { id: target.id, limit: 1, ...(cursor ? { cursor } : {}) })
    ids.push(...page.items.map((x: any) => x.document.id))
    cursor = page.nextCursor
  } while (cursor)
  expect(ids).toEqual(sources.map((d) => d.id).sort())
  await owner.patch(`/api/documents/${target.id}`, { title: 'Renamed target' })
  await owner.patch(`/api/documents/${sources[0].id}`, { title: 'Renamed source' })
  expect((await owner.get(backlinks(target.id))).body.items.find((x: any) => x.document.id === sources[0].id).document.title).toBe('Renamed source')
  await owner.post(`/api/documents/${sources[0].id}/archive`)
  expect((await owner.get(backlinks(target.id))).body.items).toHaveLength(3)
  const archived = (await owner.get(backlinks(target.id) + '?archived=all')).body.items.find((x: any) => x.document.id === sources[0].id)
  expect(archived.document.archivedAt).toBeTruthy()
  expect(archived.document.excerpt).toBe('')
  await owner.post(`/api/documents/${target.id}/archive`)
  expect((await owner.get(backlinks(target.id) + '?archived=all')).body.items).toHaveLength(4)
  await owner.post(`/api/documents/${sources[0].id}/restore`)
  expect((await owner.get(backlinks(target.id))).body.items).toHaveLength(4)
})

it('never exposes foreign source/target metadata and validates cursor scope/auth', async () => {
  const target = await make('Local target')
  const db = new Database(path.join(app.dataDir, 'alice.db'))
  try {
    db.prepare("INSERT INTO workspaces(id, name, created_at) VALUES ('wsp_foreign', 'Foreign', ?)").run(new Date().toISOString())
    const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(target.id) as Record<string, unknown>
    const columns = Object.keys(row)
    db.prepare(`INSERT INTO documents (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map((k) => k === 'id' ? 'doc_foreign' : k === 'workspace_id' ? 'wsp_foreign' : row[k]))
    db.prepare('INSERT INTO document_inline_links(source_document_id, target_document_id) VALUES (?, ?)').run('doc_foreign', target.id)
  } finally { db.close() }
  expect((await owner.get(backlinks(target.id))).body.items).toEqual([])
  expect((await owner.get(backlinks('doc_foreign'))).status).toBe(404)
  expect((await owner.get(backlinks('doc_missing'))).status).toBe(404)
  expect((await new HttpClient(app.url).get(backlinks(target.id))).status).toBe(401)
  expect((await owner.get(backlinks(target.id) + '?cursor=invalid')).status).toBe(400)
  for (let i = 0; i < 2; i++) await make(`Cursor source ${i}`, `[ref](/documents/${target.id})`)
  const cursor = (await owner.get(backlinks(target.id) + '?limit=1')).body.nextCursor
  const other = await make('Other target')
  expect((await owner.get(backlinks(other.id) + '?cursor=' + encodeURIComponent(cursor))).status).toBe(400)
})
