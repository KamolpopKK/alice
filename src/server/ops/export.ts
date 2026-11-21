import fs from 'node:fs'
import path from 'node:path'
import { APP_VERSION } from '../../shared/version'
import { currentSchemaVersion, openDatabase } from '../db/database'
import { OpsError } from './errors'
import { exportFileName } from './paths'

export const EXPORT_FORMAT = 'alice-export'
export const EXPORT_FORMAT_VERSION = 2

/** Streams a JSON document entity-by-entity so large workspaces never sit in memory at once. */
class JsonWriter {
  private fd: number
  private first: boolean[] = []

  constructor(file: string) {
    this.fd = fs.openSync(file, 'w')
  }
  raw(text: string) {
    fs.writeSync(this.fd, text)
  }
  openObject() {
    this.raw('{')
    this.first.push(true)
  }
  closeObject() {
    this.raw('}')
    this.first.pop()
  }
  private sep() {
    if (this.first[this.first.length - 1]) this.first[this.first.length - 1] = false
    else this.raw(',')
  }
  field(key: string, value: unknown) {
    this.sep()
    this.raw(`\n${JSON.stringify(key)}:${JSON.stringify(value)}`)
  }
  array(key: string, rows: Iterable<unknown>): number {
    this.sep()
    this.raw(`\n${JSON.stringify(key)}:[`)
    let n = 0
    for (const row of rows) {
      this.raw(`${n ? ',' : ''}\n${JSON.stringify(row)}`)
      n++
    }
    this.raw('\n]')
    return n
  }
  close() {
    fs.closeSync(this.fd)
  }
}

function frontMatter(data: Record<string, unknown>): string {
  // JSON เป็น YAML ที่ถูกต้อง จึงปลอดภัยกับอักขระพิเศษในชื่อเรื่อง
  return `---\n${Object.entries(data)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n')}\n---\n\n`
}

const parseLabels = <T extends { labels?: string }>(row: T) => ({ ...row, labels: row.labels ? (JSON.parse(row.labels) as string[]) : [] })

function documentMetadata(db: ReturnType<typeof openDatabase>, documentId: string) {
  const tags = db.prepare('SELECT tag_text AS value FROM document_tags WHERE document_id = ? ORDER BY tag_key').all(documentId) as Array<{ value: string }>
  const keywords = db.prepare('SELECT keyword_text AS value FROM document_keywords WHERE document_id = ? ORDER BY keyword_key').all(documentId) as Array<{ value: string }>
  return { tags: tags.map((row) => row.value), searchKeywords: keywords.map((row) => row.value) }
}

export interface ExportSummary {
  dir: string
  counts: Record<string, number>
}

/**
 * Portable export: `workspace.json` with every supported entity (credentials and token hashes are
 * never exported) plus Markdown files for document bodies and task descriptions with comments.
 */
export function exportWorkspace(dbPath: string, outDir: string): ExportSummary {
  if (!fs.existsSync(dbPath)) throw new OpsError(`No database at ${dbPath}`)
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) throw new OpsError(`Export directory ${outDir} is not empty`)
  fs.mkdirSync(path.join(outDir, 'documents'), { recursive: true })
  fs.mkdirSync(path.join(outDir, 'tasks'), { recursive: true })
  const db = openDatabase(dbPath, { readonly: true })
  const counts: Record<string, number> = {}
  const json = new JsonWriter(path.join(outDir, 'workspace.json'))
  try {
    db.exec('BEGIN') // snapshot เดียวกันตลอดการ export
    const iter = (sql: string) => db.prepare(sql).iterate() as IterableIterator<Record<string, any>>
    json.openObject()
    json.field('format', EXPORT_FORMAT)
    json.field('formatVersion', EXPORT_FORMAT_VERSION)
    json.field('appVersion', APP_VERSION)
    json.field('schemaVersion', currentSchemaVersion(db))
    json.field('exportedAt', new Date().toISOString())
    json.field('workspace', db.prepare('SELECT id, name, created_at AS createdAt FROM workspaces').get())
    counts.actors = json.array(
      'actors',
      iter(`SELECT a.id, a.kind, a.display_name AS displayName, a.is_owner AS isOwner, c.username, a.created_at AS createdAt, a.deactivated_at AS deactivatedAt
            FROM actors a LEFT JOIN human_credentials c ON c.actor_id = a.id ORDER BY a.created_at, a.id`),
    )
    counts.projects = json.array(
      'projects',
      (function* () {
        for (const p of iter(`SELECT id, system_key AS systemKey, name, description, labels, archived_at AS archivedAt, created_by AS createdBy,
          updated_by AS updatedBy, created_at AS createdAt, updated_at AS updatedAt FROM projects ORDER BY created_at, id`))
          yield parseLabels(p)
      })(),
    )
    counts.tasks = json.array(
      'tasks',
      (function* () {
        for (const t of iter(`SELECT id, project_id AS projectId, parent_id AS parentId, title, description, status, priority, due_at AS dueAt,
          assignee_id AS assigneeId, labels, completed_at AS completedAt, archived_at AS archivedAt, created_by AS createdBy, updated_by AS updatedBy,
          created_at AS createdAt, updated_at AS updatedAt FROM tasks ORDER BY created_at, id`))
          yield { ...parseLabels(t), markdown: `tasks/${exportFileName(t.title, t.id)}` }
      })(),
    )
    counts.taskBlockers = json.array('taskBlockers', iter('SELECT task_id AS taskId, blocker_id AS blockerId, created_by AS createdBy, created_at AS createdAt FROM task_blockers ORDER BY created_at, task_id, blocker_id'))
    counts.comments = json.array('comments', iter('SELECT id, task_id AS taskId, actor_id AS authorId, kind, body, created_at AS createdAt FROM comments ORDER BY created_at, id'))
    counts.documents = json.array(
      'documents',
      (function* () {
        for (const d of iter(`SELECT id, title, source_url AS sourceUrl, revision, knowledge_status AS status, owner_id AS ownerId,
          reviewed_at AS reviewedAt, reviewed_by AS reviewedBy, reviewed_revision AS reviewedRevision, archived_at AS archivedAt,
          created_by AS createdBy, updated_by AS updatedBy, created_at AS createdAt, updated_at AS updatedAt FROM documents ORDER BY created_at, id`))
          yield { ...d, ...documentMetadata(db, d.id), markdown: `documents/${exportFileName(d.title, d.id)}` }
      })(),
    )
    counts.documentRevisions = json.array(
      'documentRevisions',
      iter('SELECT id, document_id AS documentId, number, title, body, source_url AS sourceUrl, restored_from AS restoredFrom, created_by AS createdBy, created_at AS createdAt FROM document_revisions ORDER BY document_id, number'),
    )
    counts.taskDocuments = json.array('taskDocuments', iter('SELECT task_id AS taskId, document_id AS documentId, created_by AS createdBy, created_at AS createdAt FROM task_documents ORDER BY created_at, task_id'))
    counts.projectDocuments = json.array('projectDocuments', iter('SELECT project_id AS projectId, document_id AS documentId, created_by AS createdBy, created_at AS createdAt FROM project_documents ORDER BY created_at, project_id'))
    counts.documentTags = json.array('documentTags', iter('SELECT document_id AS documentId, tag_key AS tagKey, tag_text AS tag FROM document_tags ORDER BY document_id, tag_key'))
    counts.documentKeywords = json.array('documentKeywords', iter('SELECT document_id AS documentId, keyword_key AS keywordKey, keyword_text AS keyword FROM document_keywords ORDER BY document_id, keyword_key'))
    counts.documentRelations = json.array(
      'documentRelations',
      iter(`SELECT source_document_id AS sourceDocumentId, target_document_id AS targetDocumentId, relation_type AS type,
        created_by AS createdBy, created_at AS createdAt FROM document_relations ORDER BY source_document_id, target_document_id, relation_type`),
    )
    counts.activity = json.array(
      'activity',
      (function* () {
        for (const e of iter('SELECT id, actor_id AS actorId, verb, resource_type AS resourceType, resource_id AS resourceId, data, created_at AS createdAt FROM activity_events ORDER BY seq'))
          yield { ...e, data: JSON.parse(e.data) }
      })(),
    )
    json.closeObject()

    // Markdown: documents
    const docLinks = db.prepare(`SELECT 'task' AS type, task_id AS id FROM task_documents WHERE document_id = ? UNION ALL SELECT 'project', project_id FROM project_documents WHERE document_id = ?`)
    const relationsFor = db.prepare(`SELECT source_document_id AS sourceDocumentId, target_document_id AS targetDocumentId, relation_type AS type
      FROM document_relations WHERE source_document_id = ? OR target_document_id = ? ORDER BY source_document_id, target_document_id, relation_type`)
    for (const d of iter(`SELECT id, title, body, source_url, revision, knowledge_status, owner_id, reviewed_at, reviewed_by, reviewed_revision,
      archived_at, updated_at FROM documents ORDER BY id`)) {
      const links = docLinks.all(d.id, d.id) as Array<{ type: string; id: string }>
      const meta = {
        id: d.id,
        title: d.title,
        sourceUrl: d.source_url,
        revision: d.revision,
        status: d.knowledge_status,
        ownerId: d.owner_id,
        ...documentMetadata(db, d.id),
        reviewedAt: d.reviewed_at,
        reviewedBy: d.reviewed_by,
        reviewedRevision: d.reviewed_revision,
        archivedAt: d.archived_at,
        updatedAt: d.updated_at,
        links,
        relations: relationsFor.all(d.id, d.id),
      }
      fs.writeFileSync(path.join(outDir, 'documents', exportFileName(d.title, d.id)), frontMatter(meta) + d.body + (d.body.endsWith('\n') ? '' : '\n'))
    }
    // Markdown: tasks (description + comment thread)
    const commentsFor = db.prepare(`SELECT c.kind, c.body, c.created_at, a.display_name, a.kind AS actor_kind FROM comments c JOIN actors a ON a.id = c.actor_id WHERE c.task_id = ? ORDER BY c.created_at, c.id`)
    for (const t of iter(`SELECT t.id, t.title, t.description, t.status, t.priority, t.due_at, t.labels, t.archived_at, t.project_id, p.name AS project
        FROM tasks t JOIN projects p ON p.id = t.project_id ORDER BY t.id`)) {
      const meta = { id: t.id, title: t.title, project: t.project, projectId: t.project_id, status: t.status, priority: t.priority, dueAt: t.due_at, labels: JSON.parse(t.labels), archivedAt: t.archived_at }
      let body = frontMatter(meta) + `# ${t.title}\n\n${t.description}\n`
      const comments = commentsFor.all(t.id) as Array<Record<string, string>>
      if (comments.length) {
        body += `\n## Comments\n`
        for (const c of comments) {
          body += `\n### ${c.display_name}${c.actor_kind === 'agent' ? ' (agent)' : ''} — ${c.created_at}${c.kind === 'completion_summary' ? ' — completion summary' : ''}\n\n${c.body}\n`
        }
      }
      fs.writeFileSync(path.join(outDir, 'tasks', exportFileName(t.title, t.id)), body)
    }
    db.exec('COMMIT')
  } finally {
    json.close()
    db.close()
  }
  fs.writeFileSync(path.join(outDir, 'README.md'), `# Alice export\n\n\`workspace.json\` holds all entities (format ${EXPORT_FORMAT} v${EXPORT_FORMAT_VERSION}). \`documents/\` and \`tasks/\` hold Markdown with JSON front matter. Credentials and tokens are not exported.\n`)
  return { dir: outDir, counts }
}
