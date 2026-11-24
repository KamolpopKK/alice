import path from 'node:path'
import { openDatabase } from '../../src/server/db/database'
import { indexDocumentLinks } from '../../src/server/domain/document-link-index'
import { indexResource } from '../../src/server/domain/search'
import { evenKeys } from '../../src/server/domain/order-keys'
import { seedScale } from './seed'

export const KNOWLEDGE_ENVELOPE = { documents: 10000, links: 100000, topics: 1000, memberships: 20000, largeBodies: 500 }
export const knowledgeDocId = (i: number) => `doc_knowledge_${String(i).padStart(5, '0')}`
export async function seedKnowledge(dataDir: string) {
  await seedScale(dataDir, { humans: 1, agents: 1, projects: 10, tasks: 10, comments: 0, documents: 0, blockers: 0 })
  const db = openDatabase(path.join(dataDir, 'alice.db'))
  const workspace = (db.prepare('SELECT id FROM workspaces').get() as { id: string }).id
  const actor = (db.prepare('SELECT id FROM actors WHERE is_owner = 1').get() as { id: string }).id
  const projects = (db.prepare('SELECT id FROM projects WHERE system_key IS NULL ORDER BY id').all() as { id: string }[]).map((p) => p.id)
  const now = new Date().toISOString()
  const insert = db.prepare(`INSERT INTO documents(id,workspace_id,title,body,revision,knowledge_status,reviewed_at,reviewed_by,reviewed_revision,archived_at,created_by,updated_by,created_at,updated_at)
    VALUES(?,?,?,?,1,?,?,?,?,?,?,?,?,?)`)
  const rev = db.prepare('INSERT INTO document_revisions(id,document_id,number,title,body,created_by,created_at) VALUES(?,?,1,?,?,?,?)')
  const projectLink = db.prepare('INSERT INTO project_documents(project_id,document_id,created_by,created_at) VALUES(?,?,?,?)')
  for (let batch = 0; batch < 10000; batch += 100) db.transaction(() => {
    for (let i = batch; i < batch + 100; i++) {
      const id = knowledgeDocId(i), title = `Knowledge needle source ${i}`
      const targets = new Set<number>([i === 0 ? 1 : 0])
      for (let j = 1; targets.size < 10; j++) if ((i + j) % 10000 !== i) targets.add((i + j) % 10000)
      const prefix = `# Source ${i}\n\n` + [...targets].map((n) => `[ref](/documents/${knowledgeDocId(n)})`).join(' ') + '\n\n'
      const size = i % 20 === 0 ? 50000 : 2048 + (i % 7) * 768
      const body = prefix + 'reference context '.repeat(Math.ceil((size - prefix.length) / 18)).slice(0, size - prefix.length)
      const current = i % 4 === 0, archived = i % 20 === 1
      const status = current ? 'current' : i % 4 === 1 ? 'draft' : i % 4 === 2 ? 'superseded' : 'unreviewed'
      insert.run(id, workspace, title, body, status, current ? now : null, current ? actor : null, current ? 1 : null, archived ? now : null, actor, actor, now, now)
      rev.run(`rev_knowledge_${i}`, id, title, body, actor, now)
      projectLink.run(projects[i % projects.length], id, actor, now)
      indexResource(db, { kind: 'document', resourceId: id, title, displayTitle: title, body, archived })
      indexDocumentLinks(db, { id, body, revision: 1 })
    }
  })()
  process.stderr.write('knowledge fixture: 10000 documents and 100000 links prepared\n')
  const keys = evenKeys(20)
  const topic = db.prepare(`INSERT INTO knowledge_topics(id,workspace_id,project_id,name,name_key,description,revision,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?,?,?)`)
  const member = db.prepare('INSERT INTO knowledge_topic_documents(topic_id,document_id,order_key,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
  db.transaction(() => {
    for (let i = 0; i < 1000; i++) {
      const id = `knt_knowledge_${String(i).padStart(4, '0')}`, name = `Topic ${String(i).padStart(4, '0')}`
      topic.run(id, workspace, projects[i % projects.length], name, name.toLowerCase(), 'Start with the ordered source documents.', actor, actor, now, now)
      for (let j = 0; j < 20; j++) member.run(id, knowledgeDocId((i * 7 + j) % 10000), keys[j], actor, actor, now, now)
    }
  })()
  const counts = Object.fromEntries(['documents', 'document_inline_links', 'knowledge_topics', 'knowledge_topic_documents'].map((name) => [name, (db.prepare(`SELECT count(*) AS n FROM ${name}`).get() as { n: number }).n]))
  const sizes = db.prepare('SELECT min(length(body)) AS min, max(length(body)) AS max, sum(length(body) = 50000) AS large FROM documents').get()
  const sqlite = db.prepare('SELECT sqlite_version() AS version').get()
  db.close()
  return { projectId: projects[0], topicId: 'knt_knowledge_0000', counts, sizes, sqlite }
}
