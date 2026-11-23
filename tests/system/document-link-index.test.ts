import Database from 'better-sqlite3'
import path from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { bootstrapOwner, HttpClient } from '../helpers/client'

let app: RunningApp
let owner: HttpClient
let db: Database.Database
beforeAll(async () => {
  app = await startApp()
  owner = await bootstrapOwner(app)
  db = new Database(path.join(app.dataDir, 'alice.db'))
})
afterAll(async () => {
  db?.close()
  await app?.stop()
})
const edges = (id: string) => db.prepare('SELECT target_document_id FROM document_inline_links WHERE source_document_id = ? ORDER BY target_document_id').all(id)
const state = (id: string) => db.prepare('SELECT content_revision, parser_version FROM document_link_index_state WHERE source_document_id = ?').get(id)

it('indexes only current bodies atomically across create, edit and restore; keeps unresolved IDs', async () => {
  const body = '[one](/documents/doc_one) [one again](/documents/doc_one#x) [missing](/documents/doc_missing)'
  const doc = (await owner.post('/api/documents', { title: 'Source', body })).body.document
  expect(edges(doc.id)).toEqual([{ target_document_id: 'doc_missing' }, { target_document_id: 'doc_one' }])
  expect(state(doc.id)).toEqual({ content_revision: 1, parser_version: 1 })
  expect((await owner.patch(`/api/documents/${doc.id}`, { body: '[two](/documents/doc_two)' })).status).toBe(200)
  expect(edges(doc.id)).toEqual([{ target_document_id: 'doc_two' }])
  expect(state(doc.id)).toEqual({ content_revision: 2, parser_version: 1 })
  expect((await owner.post(`/api/documents/${doc.id}/revisions/1/restore`)).status).toBe(200)
  expect(state(doc.id)).toEqual({ content_revision: 3, parser_version: 1 })
  expect(edges(doc.id)).toHaveLength(2)
  expect(db.prepare('SELECT count(*) AS n FROM document_relations WHERE source_document_id = ?').get(doc.id)).toEqual({ n: 0 })
})

it('title-only advances state without rewriting edges; metadata/review do not reparse or write state', async () => {
  const doc = (await owner.post('/api/documents', { title: 'Guarded', body: '[target](/documents/doc_target)' })).body.document
  db.exec(`CREATE TRIGGER forbid_edge_rewrite BEFORE DELETE ON document_inline_links BEGIN SELECT RAISE(ABORT, 'unexpected edge rewrite'); END`)
  try {
    expect((await owner.patch(`/api/documents/${doc.id}`, { title: 'Renamed' })).status).toBe(200)
    expect(state(doc.id)).toEqual({ content_revision: 2, parser_version: 1 })
    db.exec(`CREATE TRIGGER forbid_state_rewrite BEFORE UPDATE ON document_link_index_state BEGIN SELECT RAISE(ABORT, 'unexpected state rewrite'); END`)
    try {
      expect((await owner.patch(`/api/documents/${doc.id}`, { tags: ['knowledge'], searchKeywords: ['guide'] })).status).toBe(200)
      expect((await owner.post(`/api/documents/${doc.id}/review`, { expectedRevision: 2 })).status).toBe(200)
    } finally { db.exec('DROP TRIGGER forbid_state_rewrite') }
  } finally { db.exec('DROP TRIGGER forbid_edge_rewrite') }
  expect(edges(doc.id)).toEqual([{ target_document_id: 'doc_target' }])
})

it('index failure rolls source, immutable revisions, edges, review and activity back together', async () => {
  const doc = (await owner.post('/api/documents', { title: 'Atomic source', body: '[original](/documents/doc_original)' })).body.document
  await owner.post(`/api/documents/${doc.id}/review`, { expectedRevision: 1 })
  const original = (await owner.get(`/api/documents/${doc.id}`)).body.document
  const history = (await owner.get(`/api/documents/${doc.id}/revisions`)).body
  db.exec(`CREATE TRIGGER fail_index BEFORE UPDATE ON document_link_index_state BEGIN SELECT RAISE(ABORT, 'fixture index failure'); END`)
  try {
    expect((await owner.patch(`/api/documents/${doc.id}`, { body: '[changed](/documents/doc_changed)' })).status).toBe(500)
    expect((await owner.post(`/api/documents/${doc.id}/revisions/1/restore`)).status).toBe(500)
  } finally { db.exec('DROP TRIGGER fail_index') }
  expect((await owner.get(`/api/documents/${doc.id}`)).body.document).toEqual(original)
  expect((await owner.get(`/api/documents/${doc.id}/revisions`)).body).toEqual(history)
  expect(edges(doc.id)).toEqual([{ target_document_id: 'doc_original' }])
  expect(state(doc.id)).toEqual({ content_revision: 1, parser_version: 1 })
  const activity = (await owner.get(`/api/activity?resourceType=document&resourceId=${doc.id}`)).body.items
  expect(activity.filter((e: any) => e.resourceId === doc.id).map((e: any) => e.verb)).toEqual(['document.reviewed', 'document.created'])
})

it.each(['parser', 'index', 'activity'])('%s failure leaves no partial document create', async (failure) => {
  const failed = await startApp({ env: failure === 'activity' ? { ALICE_TEST_FAIL_ACTIVITY_VERB: 'document.created' } : { ALICE_TEST_LINK_INDEX_FAILURE: failure } })
  try {
    const c = await bootstrapOwner(failed)
    expect((await c.post('/api/documents', { title: 'Never committed', body: '[missing](/documents/doc_missing)' })).status).toBe(500)
    expect((await c.get('/api/documents')).body.items).toEqual([])
    const check = new Database(path.join(failed.dataDir, 'alice.db'))
    try {
      for (const table of ['document_revisions', 'document_inline_links', 'document_link_index_state']) expect(check.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 })
    } finally { check.close() }
  } finally { await failed.stop() }
})
