import Database from 'better-sqlite3'
import path from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { bootstrapOwner, createAgent, HttpClient } from '../helpers/client'
import { connectMcp, type McpHandle } from '../helpers/mcp'
let app: RunningApp
let owner: HttpClient
let mcp: McpHandle
const make = async (body: string) => (await owner.post('/api/documents', { title: 'Window source', body })).body.document
const route = (id: string, kind: string) => `/client/v1/documents/${id}/${kind}`
beforeAll(async () => {
  app = await startApp()
  owner = await bootstrapOwner(app)
  mcp = await connectMcp(app.url, (await createAgent(owner, 'Selective reader')).token)
})
afterAll(async () => {
  await mcp?.close()
  await app?.stop()
})

it('reassembles Unicode Markdown at one revision with explicit review/window provenance', async () => {
  const body = '# บริบท 🐈\n\n' + 'เอกสารภาษาไทย 🐈\n'.repeat(1500)
  const doc = await make(body)
  await owner.post(`/api/documents/${doc.id}/review`, { expectedRevision: 1 })
  let offset = 0
  let assembled = ''
  do {
    const response = await owner.get(route(doc.id, 'content') + `?offset=${offset}&maxChars=1000&expectedRevision=1`)
    expect(response.status).toBe(200)
    const d = response.body.document
    expect(d).toMatchObject({ revision: 1, status: 'current', reviewedRevision: 1, bodyWindow: { offset, totalChars: body.length, returnedChars: d.body.length } })
    expect(d.reviewedBy).toBeTruthy()
    assembled += d.body
    offset = d.bodyWindow.nextOffset
  } while (offset !== null)
  expect(assembled).toBe(body)
  const legacy = await mcp.ok('get_document', { id: doc.id })
  expect(legacy.document.body.length).toBe(20000)
  expect(legacy.document.links).toEqual({ tasks: [], projects: [] })
  const guarded = await mcp.ok('get_document', { id: doc.id, offset: 20000, maxChars: 1000, expectedRevision: 1 })
  expect(guarded.document.body).toBe(body.slice(20000, 21000))
  expect((await owner.get(`/api/documents/${doc.id}`)).body.document.body).toBe(body)
  expect((await owner.get(route(doc.id, 'content') + `?offset=${body.length + 10}`)).body.document.bodyWindow).toMatchObject({ returnedChars: 0, nextOffset: null, truncated: false })
})

it('outline identifies original Thai/emoji heading ranges and rejects changed continuations', async () => {
  const body = '# หัวข้อ 🐈\nIntro\n\n## รายละเอียด\nDetails\n\n# Next\nEnd'
  const doc = await make(body)
  const first = (await owner.get(route(doc.id, 'outline') + '?limit=1')).body
  expect(first.document.revision).toBe(1)
  expect(first.items[0]).toMatchObject({ text: 'หัวข้อ 🐈', level: 1, offset: 0, endOffset: body.indexOf('# Next') })
  const next = await mcp.ok('get_document_outline', { id: doc.id, cursor: first.nextCursor, limit: 1, expectedRevision: 1 })
  expect(next.items[0]).toMatchObject({ text: 'รายละเอียด', level: 2, offset: body.indexOf('## รายละเอียด') })
  expect(body.slice(next.items[0].offset, next.items[0].headingEndOffset)).toBe('## รายละเอียด')
  await owner.patch(`/api/documents/${doc.id}`, { body: body + '\nChanged' })
  expect((await owner.get(route(doc.id, 'content') + '?expectedRevision=1')).body.error.code).toBe('CONFLICT')
  expect((await owner.get(route(doc.id, 'outline') + '?cursor=' + encodeURIComponent(first.nextCursor))).body.error.code).toBe('CONFLICT')
  expect((await mcp.call('get_document', { id: doc.id, expectedRevision: 1 })).isError).toBe(true)
  expect((await mcp.ok('get_document', { id: doc.id })).document.revision).toBe(2)
  expect((await owner.get(route(doc.id, 'outline') + '?cursor=invalid')).status).toBe(400)
})

it('caps preview and provides body-free archived/unavailable states with auth/workspace isolation', async () => {
  const doc = await make('a'.repeat(4500))
  const preview = (await owner.get(route(doc.id, 'preview'))).body
  expect(preview).toMatchObject({ state: 'available', document: { revision: 1 }, bodyWindow: { returnedChars: 2000, totalChars: 4500, truncated: true, nextOffset: 2000 } })
  expect(preview.body.length).toBe(2000)
  expect(await mcp.ok('get_document_preview', { id: doc.id })).toEqual(preview)
  await owner.post(`/api/documents/${doc.id}/archive`)
  expect((await owner.get(route(doc.id, 'preview'))).body).toMatchObject({ state: 'archived', body: null, bodyWindow: null, document: { excerpt: '' } })
  expect((await owner.get(route('doc_missing', 'preview'))).body).toEqual({ state: 'unavailable', document: null, body: null, bodyWindow: null })
  const db = new Database(path.join(app.dataDir, 'alice.db'))
  try {
    db.prepare("INSERT INTO workspaces(id, name, created_at) VALUES ('wsp_other_window', 'Other', ?)").run(new Date().toISOString())
    const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(doc.id) as Record<string, unknown>
    const cols = Object.keys(row)
    db.prepare(`INSERT INTO documents(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((k) => k === 'id' ? 'doc_other_window' : k === 'workspace_id' ? 'wsp_other_window' : row[k]))
  } finally { db.close() }
  expect((await owner.get(route('doc_other_window', 'preview'))).body.state).toBe('unavailable')
  for (const kind of ['content', 'outline', 'preview']) expect((await new HttpClient(app.url).get(route(doc.id, kind))).status).toBe(401)
  for (const kind of ['content', 'outline']) expect((await owner.get(route('doc_other_window', kind))).status).toBe(404)
})

it('enforces approved input boundaries and returns an empty outline for plain content', async () => {
  const doc = await make('No headings')
  expect((await owner.get(route(doc.id, 'outline'))).body.items).toEqual([])
  for (const query of ['maxChars=99', 'maxChars=100001', 'offset=-1', 'offset=0.5', 'expectedRevision=0']) expect((await owner.get(route(doc.id, 'content') + '?' + query)).status).toBe(400)
  for (const maxChars of [100, 100000]) expect((await owner.get(route(doc.id, 'content') + '?maxChars=' + maxChars)).status).toBe(200)
})
