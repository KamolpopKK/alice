import { createHash } from 'node:crypto'
import { openDatabase, type DB } from '../db/database'
import { newId } from '../ids'
import { OpsError } from './errors'

export const PURGE_SCOPES = ['revisions', 'archived', 'activity'] as const
export type PurgeScope = (typeof PURGE_SCOPES)[number]

export interface PurgePlan {
  cutoff: string
  scopes: PurgeScope[]
  /** Superseded document revisions created before the cutoff (current revisions are kept). */
  revisions: string[]
  /** Tasks archived before the cutoff. */
  tasks: string[]
  /** Documents archived before the cutoff. */
  documents: string[]
  /** Projects archived before the cutoff that will have no tasks left (never the system project). */
  projects: string[]
  /** Archived projects skipped because tasks still belong to them. */
  skippedProjects: string[]
  /** Activity events recorded before the cutoff. */
  activityEvents: number
  /** Short hash of the plan; required to execute exactly this plan. */
  confirmation: string
}

const ids = (db: DB, sql: string, ...params: unknown[]) => (db.prepare(sql).all(...params) as Array<{ id: string }>).map((r) => r.id)

export function planPurge(db: DB, cutoffInput: string, scopes: PurgeScope[]): PurgePlan {
  const time = Date.parse(cutoffInput)
  if (Number.isNaN(time)) throw new OpsError('--before must be an ISO date or date-time, e.g. 2025-01-01')
  if (time > Date.now()) throw new OpsError('--before cannot be in the future')
  if (scopes.length === 0) throw new OpsError(`Choose at least one scope: ${PURGE_SCOPES.map((s) => `--${s}`).join(' ')}`)
  const cutoff = new Date(time).toISOString()
  const has = (s: PurgeScope) => scopes.includes(s)

  const revisions = has('revisions')
    ? ids(db, `SELECT r.id FROM document_revisions r JOIN documents d ON d.id = r.document_id WHERE r.created_at < ? AND r.number < d.revision ORDER BY r.document_id, r.number`, cutoff)
    : []
  const tasks = has('archived') ? ids(db, 'SELECT id FROM tasks WHERE archived_at IS NOT NULL AND archived_at < ? ORDER BY id', cutoff) : []
  const documents = has('archived') ? ids(db, 'SELECT id FROM documents WHERE archived_at IS NOT NULL AND archived_at < ? ORDER BY id', cutoff) : []
  const candidates = has('archived') ? ids(db, 'SELECT id FROM projects WHERE system_key IS NULL AND archived_at IS NOT NULL AND archived_at < ? ORDER BY id', cutoff) : []
  const purgedTasks = new Set(tasks)
  const projects: string[] = []
  const skippedProjects: string[] = []
  for (const p of candidates) {
    const remaining = ids(db, 'SELECT id FROM tasks WHERE project_id = ?', p).filter((t) => !purgedTasks.has(t))
    ;(remaining.length ? skippedProjects : projects).push(p)
  }
  const activityEvents = has('activity') ? (db.prepare('SELECT count(*) AS n FROM activity_events WHERE created_at < ?').get(cutoff) as { n: number }).n : 0
  const body = { cutoff, scopes: [...scopes].sort(), revisions, tasks, documents, projects, skippedProjects, activityEvents }
  const confirmation = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 12)
  return { ...body, scopes: body.scopes as PurgeScope[], confirmation }
}

export function describePlan(plan: PurgePlan): string {
  const lines = [
    `Purge plan for content before ${plan.cutoff} (scopes: ${plan.scopes.join(', ')})`,
    `  document revisions (superseded): ${plan.revisions.length}`,
    `  archived tasks (with their comments, labels and links): ${plan.tasks.length}`,
    `  archived documents (with all revisions and links): ${plan.documents.length}`,
    `  archived projects: ${plan.projects.length}${plan.skippedProjects.length ? ` (skipped ${plan.skippedProjects.length} that still contain tasks)` : ''}`,
    `  activity events: ${plan.activityEvents}`,
    '',
    'The Untitled system project and current document revisions are never purged.',
  ]
  for (const [label, list] of [
    ['tasks', plan.tasks],
    ['documents', plan.documents],
    ['projects', plan.projects],
  ] as const) {
    if (list.length) lines.push(`  ${label}: ${list.slice(0, 50).join(', ')}${list.length > 50 ? ` … (+${list.length - 50})` : ''}`)
  }
  return lines.join('\n')
}

function chunked<T>(items: T[], size = 500): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Executes a reviewed plan atomically. The plan is recomputed and must match the confirmation code. */
export function executePurge(dbPath: string, cutoff: string, scopes: PurgeScope[], confirmation: string): PurgePlan {
  const db = openDatabase(dbPath)
  try {
    return db
      .transaction(() => {
        const plan = planPurge(db, cutoff, scopes)
        if (plan.confirmation !== confirmation) {
          throw new OpsError(`Confirmation ${confirmation} does not match the current plan (${plan.confirmation}). Re-run the dry run and review it again.`)
        }
        db.prepare(`INSERT INTO installation (key, value) VALUES ('maintenance_purge', ?)`).run(new Date().toISOString())
        const run = (sql: string, list: string[]) => {
          for (const part of chunked(list)) db.prepare(sql.replace('(?)', `(${part.map(() => '?').join(',')})`)).run(...part)
        }
        run('DELETE FROM document_revisions WHERE id IN (?)', plan.revisions)

        const removeSearch = (kind: string, list: string[]) => {
          for (const part of chunked(list)) {
            const rows = db.prepare(`SELECT rowid FROM search_docs WHERE kind = ? AND resource_id IN (${part.map(() => '?').join(',')})`).all(kind, ...part) as { rowid: number }[]
            for (const r of rows) {
              db.prepare('DELETE FROM search_index WHERE rowid = ?').run(r.rowid)
              db.prepare('DELETE FROM search_docs WHERE rowid = ?').run(r.rowid)
            }
          }
        }
        // tasks และสิ่งที่ผูกกับ task
        for (const part of chunked(plan.tasks)) {
          const marks = part.map(() => '?').join(',')
          const commentIds = ids(db, `SELECT id FROM comments WHERE task_id IN (${marks})`, ...part)
          removeSearch('comment', commentIds)
          db.prepare(`DELETE FROM comments WHERE task_id IN (${marks})`).run(...part)
          db.prepare(`DELETE FROM task_documents WHERE task_id IN (${marks})`).run(...part)
          db.prepare(`DELETE FROM task_blockers WHERE task_id IN (${marks}) OR blocker_id IN (${marks})`).run(...part, ...part)
          db.prepare(`UPDATE tasks SET parent_id = NULL WHERE parent_id IN (${marks})`).run(...part)
          db.prepare(`DELETE FROM task_labels WHERE task_id IN (${marks})`).run(...part)
          // Task block ใน Pad ที่อ้าง task ที่ถูก purge: ลบเฉพาะ block (task block ไม่มีลูกเสมอ)
          const padBlocks = ids(db, `SELECT id FROM pad_blocks WHERE task_id IN (${marks})`, ...part)
          for (const blockId of padBlocks) {
            const doc = db.prepare('SELECT rowid FROM pad_search_docs WHERE block_id = ?').get(blockId) as { rowid: number } | undefined
            if (doc) {
              db.prepare('DELETE FROM pad_search_index WHERE rowid = ?').run(doc.rowid)
              db.prepare('DELETE FROM pad_search_docs WHERE rowid = ?').run(doc.rowid)
            }
          }
          db.prepare(`DELETE FROM pad_blocks WHERE task_id IN (${marks})`).run(...part)
        }
        removeSearch('task', plan.tasks)
        run('DELETE FROM tasks WHERE id IN (?)', plan.tasks)

        for (const part of chunked(plan.documents)) {
          const marks = part.map(() => '?').join(',')
          db.prepare(`DELETE FROM document_revisions WHERE document_id IN (${marks})`).run(...part)
          db.prepare(`DELETE FROM task_documents WHERE document_id IN (${marks})`).run(...part)
          db.prepare(`DELETE FROM project_documents WHERE document_id IN (${marks})`).run(...part)
        }
        removeSearch('document', plan.documents)
        run('DELETE FROM documents WHERE id IN (?)', plan.documents)

        run('UPDATE pads SET default_project_id = NULL WHERE default_project_id IN (?)', plan.projects)
        run('DELETE FROM project_documents WHERE project_id IN (?)', plan.projects)
        run('DELETE FROM projects WHERE id IN (?)', plan.projects)
        if (plan.activityEvents > 0) db.prepare('DELETE FROM activity_events WHERE created_at < ?').run(plan.cutoff)
        db.prepare(`DELETE FROM installation WHERE key = 'maintenance_purge'`).run()

        // บันทึกการ purge ไว้ใน activity ในนามของ owner เพื่อให้ตรวจสอบย้อนหลังได้
        const owner = db.prepare('SELECT id, workspace_id FROM actors WHERE is_owner = 1').get() as { id: string; workspace_id: string } | undefined
        const workspace = owner?.workspace_id ?? (db.prepare(`SELECT value FROM installation WHERE key = 'workspace_id'`).get() as { value: string }).value
        db.prepare(
          `INSERT INTO activity_events (id, workspace_id, actor_id, verb, resource_type, resource_id, data, created_at) VALUES (?, ?, ?, 'maintenance.purged', 'workspace', ?, ?, ?)`,
        ).run(
          newId('act'),
          workspace,
          owner?.id ?? null,
          workspace,
          JSON.stringify({
            cutoff: plan.cutoff,
            scopes: plan.scopes,
            revisions: plan.revisions.length,
            tasks: plan.tasks.length,
            documents: plan.documents.length,
            projects: plan.projects.length,
            activityEvents: plan.activityEvents,
          }),
          new Date().toISOString(),
        )
        return plan
      })
      .immediate()
  } finally {
    db.close()
  }
}
