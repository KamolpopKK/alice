import path from 'node:path'
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { afterAll, expect, it } from 'vitest'
import { prepareDocumentLinks, documentLinksReady } from '../../src/server/domain/document-link-index'
import { ensureDaemon } from '../../src/local/daemon-client'
import { ensureDefaultWorkspace } from '../../src/local/registry'
import { workspacePaths, isProcessAlive } from '../../src/local/paths'
import { startApp } from '../helpers/app'
import { bootstrapOwner } from '../helpers/client'
import { call, localEnv, localHome, SERVER_COMMAND, stopLocalDaemons, storedCapability, waitFor } from '../helpers/local'

afterAll(stopLocalDaemons)

it('prepares legacy current bodies before Remote readiness without source/history/review edits', async () => {
  const first = await startApp()
  const owner = await bootstrapOwner(first)
  const doc = (await owner.post('/api/documents', { title: 'Legacy reviewed source', body: '[Old reference](/documents/doc_legacy_target)' })).body.document
  await owner.post(`/api/documents/${doc.id}/review`, { expectedRevision: 1 })
  const original = (await owner.get(`/api/documents/${doc.id}`)).body.document
  const revisions = (await owner.get(`/api/documents/${doc.id}/revisions`)).body
  await first.stop()
  const db = new Database(path.join(first.dataDir, 'alice.db'))
  db.exec('DELETE FROM document_inline_links; DELETE FROM document_link_index_state')
  db.close()
  const next = await startApp({ dataDir: first.dataDir })
  try {
    expect((await fetch(next.url + '/readyz')).status).toBe(200)
    expect(next.output()).toContain('alice.knowledge.ready')
    expect(next.output().indexOf('alice.knowledge.ready')).toBeLessThan(next.output().indexOf('alice.listening'))
    const check = new Database(path.join(first.dataDir, 'alice.db'))
    try { expect(check.prepare('SELECT * FROM document_inline_links').all()).toEqual([{ source_document_id: doc.id, target_document_id: 'doc_legacy_target' }]) } finally { check.close() }
    // The session remains valid across a restart.
    const cookie = owner.cookie!
    const read = async (suffix: string) => (await fetch(next.url + `/api/documents/${doc.id}${suffix}`, { headers: { cookie } })).json()
    expect((await read('')).document).toEqual(original)
    expect(await read('/revisions')).toEqual(revisions)
  } finally { await next.stop() }
})

it('interrupted batches resume only unfinished projections; parser failures stay visible', async () => {
  const first = await startApp()
  const owner = await bootstrapOwner(first)
  const doc = (await owner.post('/api/documents', { title: 'Seed', body: '[Ref](/documents/doc_seed_target)' })).body.document
  await first.stop()
  const db = new Database(path.join(first.dataDir, 'alice.db'))
  try {
    const source = db.prepare('SELECT * FROM documents WHERE id = ?').get(doc.id) as Record<string, unknown>
    const columns = Object.keys(source)
    const insert = db.prepare(`INSERT INTO documents (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
    db.transaction(() => { for (let i = 0; i < 205; i++) insert.run(...columns.map((key) => key === 'id' ? `doc_legacy_${String(i).padStart(3, '0')}` : source[key])) })()
    process.env.ALICE_TEST_LINK_PREP_FAIL_AFTER_BATCHES = '1'
    await expect(prepareDocumentLinks(db)).rejects.toThrow(/interruption/)
    delete process.env.ALICE_TEST_LINK_PREP_FAIL_AFTER_BATCHES
    expect(db.prepare('SELECT count(*) AS n FROM document_link_index_state').get()).toEqual({ n: 101 })
    expect(documentLinksReady(db)).toBe(false)
    db.exec(`CREATE TRIGGER protect_prepared BEFORE DELETE ON document_inline_links WHEN OLD.source_document_id = 'doc_legacy_000' BEGIN SELECT RAISE(ABORT, 'reparsed committed batch'); END`)
    process.env.ALICE_TEST_LINK_INDEX_FAILURE = 'parser'
    await expect(prepareDocumentLinks(db)).rejects.toThrow(/parser failure/)
    delete process.env.ALICE_TEST_LINK_INDEX_FAILURE
    expect(documentLinksReady(db)).toBe(false)
    await prepareDocumentLinks(db)
    expect(documentLinksReady(db)).toBe(true)
    expect(db.prepare('SELECT count(*) AS n FROM document_link_index_state').get()).toEqual({ n: 206 })
    await prepareDocumentLinks(db)
  } finally {
    delete process.env.ALICE_TEST_LINK_PREP_FAIL_AFTER_BATCHES
    delete process.env.ALICE_TEST_LINK_INDEX_FAILURE
    db.close()
  }
})

it('Local startup fails closed with a recovery record, then resumes before publishing a locator', async () => {
  const home = localHome()
  const { workspace } = ensureDefaultWorkspace(home)
  const paths = workspacePaths(home, workspace.id)
  const start = (extra = {}) => ensureDaemon(home, workspace, { env: localEnv(home, extra), command: SERVER_COMMAND })
  const first = await start()
  const token = storedCapability(home, workspace.id)!
  const doc = (await call(first.baseUrl, '/client/v1/documents', { token, body: { title: 'Local legacy', body: '[Target](/documents/doc_local_target)' } })).data.document
  await call(first.baseUrl, '/local/v1/shutdown', { token, body: {} })
  await waitFor(() => !isProcessAlive(first.locator.pid))
  const db = new Database(paths.db)
  db.exec('DELETE FROM document_inline_links; DELETE FROM document_link_index_state')
  db.close()
  await expect(start({ ALICE_TEST_LINK_INDEX_FAILURE: 'parser' })).rejects.toThrow(/could not start/)
  expect(fs.existsSync(paths.locator)).toBe(false)
  expect(JSON.parse(fs.readFileSync(path.join(paths.dir, 'recovery.json'), 'utf8')).message).toContain('parser failure')
  const next = await start()
  expect((await call(next.baseUrl, `/client/v1/documents/${doc.id}`, { token })).data.document.body).toBe('[Target](/documents/doc_local_target)')
  const check = new Database(paths.db)
  try { expect(documentLinksReady(check)).toBe(true) } finally { check.close() }
  expect(fs.existsSync(path.join(paths.dir, 'recovery.json'))).toBe(false)
})
