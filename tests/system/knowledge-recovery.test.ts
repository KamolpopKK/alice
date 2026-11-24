import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, expect, it } from 'vitest'
import { startApp, tempDataDir, type RunningApp } from '../helpers/app'
import { bootstrapOwner } from '../helpers/client'
import { createBackup, restoreBackup, verifyBackup } from '../../src/server/ops/backup'
import { exportWorkspace } from '../../src/server/ops/export'
import { migrate, openDatabase } from '../../src/server/db/database'
import { MIGRATIONS } from '../../src/server/db/migrations'
import { prepareDocumentLinks, documentLinksReady } from '../../src/server/domain/document-link-index'

const running: RunningApp[] = []
afterAll(async () => { for (const app of running) await app.stop() })

it('round-trips authoritative curation/history/review, exports v3 without derived state and rebuilds projections', async () => {
  const app = await startApp()
  running.push(app)
  const owner = await bootstrapOwner(app)
  const p = (await owner.post('/api/projects', { name: 'Recovery project' })).body.project
  const target = (await owner.post('/api/documents', { title: 'Target', body: 'Source' })).body.document
  const d = (await owner.post('/api/documents', { title: 'Reviewed source', body: `[target](/documents/${target.id})` })).body.document
  await owner.patch(`/api/documents/${d.id}`, { title: 'Reviewed renamed source' })
  await owner.post(`/api/documents/${d.id}/review`, { expectedRevision: 2 })
  await owner.post(`/api/documents/${d.id}/relations`, { targetId: target.id, type: 'references' })
  const t = (await owner.post(`/client/v1/projects/${p.id}/knowledge/topics`, { name: 'Start here', mutationId: randomUUID() })).body.topic
  for (const [i, doc] of [d, target].entries()) await owner.put(`/client/v1/knowledge/topics/${t.id}/documents/${doc.id}`, { expectedRevision: i + 1, mutationId: randomUUID() })
  const file = path.join(app.dataDir, 'alice.db')
  const tables = ['knowledge_topics', 'knowledge_topic_documents', 'documents', 'document_revisions', 'document_relations', 'project_documents']
  const snapshot = (db: ReturnType<typeof openDatabase>) => Object.fromEntries(tables.map((name) => [name, db.prepare(`SELECT * FROM ${name}`).all().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]))
  const original = openDatabase(file)
  const before = snapshot(original); original.close()
  const backup = path.join(tempDataDir('knowledge-backup'), 'copy')
  await createBackup(file, backup)
  const manifest = verifyBackup(backup)
  expect(manifest.counts).toMatchObject({ knowledge_topics: 1, knowledge_topic_documents: 2, document_inline_links: 1, document_link_index_state: 2 })
  const out = path.join(tempDataDir('knowledge-export'), 'export')
  exportWorkspace(file, out)
  const exported = JSON.parse(fs.readFileSync(path.join(out, 'workspace.json'), 'utf8'))
  expect(exported.formatVersion).toBe(3)
  expect(exported.knowledgeTopics).toMatchObject([{ id: t.id, revision: 3 }])
  expect(exported.knowledgeTopicDocuments.map((x: any) => x.documentId)).toEqual([d.id, target.id])
  expect(exported.documentInlineLinks).toBeUndefined()
  expect(exported.documentLinkIndexState).toBeUndefined()
  expect(Object.keys(exported)).not.toContain('idempotencyRecords')
  expect(JSON.stringify(exported)).not.toMatch(/password_hash|token_hash|refresh_token|plaintextToken/)
  expect(fs.readFileSync(path.join(out, exported.documents.find((x: any) => x.id === d.id).markdown), 'utf8')).toContain(`[target](/documents/${target.id})`)
  const restoredDir = tempDataDir('knowledge-restored')
  restoreBackup(backup, restoredDir, { replaceExisting: false })
  const restored = openDatabase(path.join(restoredDir, 'alice.db'))
  expect(snapshot(restored)).toEqual(before)
  restored.exec('DELETE FROM document_inline_links; DELETE FROM document_link_index_state')
  expect(documentLinksReady(restored)).toBe(false)
  await prepareDocumentLinks(restored)
  expect(documentLinksReady(restored)).toBe(true)
  expect(snapshot(restored)).toEqual(before)
  expect(restored.prepare('SELECT * FROM document_inline_links').all()).toEqual([{ source_document_id: d.id, target_document_id: target.id }])
  expect(() => migrate(restored, MIGRATIONS.slice(0, 17))).toThrow(/newer/)
  restored.close()
  await app.stop()
})

it('upgrade adds empty curation and preserves old reviewed sources; restoring a prior-schema backup permits downgrade', async () => {
  const dir = tempDataDir('knowledge-preupgrade')
  const file = path.join(dir, 'alice.db'), db = openDatabase(file)
  migrate(db, MIGRATIONS.slice(0, 17))
  const now = new Date().toISOString()
  db.prepare("INSERT INTO workspaces(id,name,created_at) VALUES('wsp_old_knowledge','Old',?)").run(now)
  db.prepare("INSERT INTO actors(id,workspace_id,kind,display_name,is_owner,created_at,updated_at) VALUES('usr_old_knowledge','wsp_old_knowledge','human','Owner',1,?,?)").run(now, now)
  db.prepare("INSERT INTO documents(id,workspace_id,title,body,revision,knowledge_status,reviewed_at,reviewed_by,reviewed_revision,created_by,updated_by,created_at,updated_at) VALUES('doc_old_knowledge','wsp_old_knowledge','Old','[ref](/documents/doc_missing)',1,'current',?,'usr_old_knowledge',1,'usr_old_knowledge','usr_old_knowledge',?,?)").run(now, now, now)
  const original = db.prepare('SELECT * FROM documents').all()
  const backup = path.join(tempDataDir('prior-schema-backup'), 'backup')
  await createBackup(file, backup)
  migrate(db)
  await prepareDocumentLinks(db)
  expect(db.prepare('SELECT count(*) AS n FROM knowledge_topics').get()).toEqual({ n: 0 })
  expect(db.prepare('SELECT count(*) AS n FROM knowledge_topic_documents').get()).toEqual({ n: 0 })
  expect(db.prepare('SELECT * FROM documents').all()).toEqual(original)
  expect(() => migrate(db, MIGRATIONS.slice(0, 17))).toThrow(/newer/)
  db.close()
  // Downgrade requires the untouched prior-schema copy, not running old code on upgraded data.
  const old = openDatabase(path.join(backup, 'alice.db'))
  expect(migrate(old, MIGRATIONS.slice(0, 17))).toEqual([])
  expect(old.prepare('SELECT * FROM documents').all()).toEqual(original)
  old.close()
})
