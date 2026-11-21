import { describe, expect, it } from 'vitest'
import { MigrationError, currentSchemaVersion, migrate, openDatabase } from '../../src/server/db/database'
import { MIGRATIONS } from '../../src/server/db/migrations'

describe('migration runner', () => {
  it('has strictly increasing versions', () => {
    MIGRATIONS.forEach((m, i) => expect(m.version).toBe(i + 1))
  })

  it('applies in order once and is a no-op afterwards', () => {
    const db = openDatabase(':memory:')
    const migrations = [
      { version: 1, name: 'a', sql: 'CREATE TABLE a (x INTEGER)' },
      { version: 2, name: 'b', sql: 'ALTER TABLE a ADD COLUMN y INTEGER' },
    ]
    expect(migrate(db, migrations)).toEqual([1, 2])
    expect(migrate(db, migrations)).toEqual([])
    expect(currentSchemaVersion(db)).toBe(2)
  })

  it('rolls back a failing migration and keeps earlier ones', () => {
    const db = openDatabase(':memory:')
    const migrations = [
      { version: 1, name: 'a', sql: 'CREATE TABLE a (x INTEGER)' },
      { version: 2, name: 'broken', sql: 'CREATE TABLE b (x INTEGER); SELECT * FROM missing_table' },
    ]
    expect(() => migrate(db, migrations)).toThrow(MigrationError)
    expect(currentSchemaVersion(db)).toBe(1)
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'b'`).get()).toBeUndefined()
  })

  it('refuses databases from newer builds or with altered migrations', () => {
    const db = openDatabase(':memory:')
    migrate(db, [{ version: 1, name: 'a', sql: 'CREATE TABLE a (x INTEGER)' }, { version: 2, name: 'b', sql: 'CREATE TABLE b (x INTEGER)' }])
    expect(() => migrate(db, [{ version: 1, name: 'a', sql: 'CREATE TABLE a (x INTEGER)' }])).toThrow(/newer/)
    expect(() =>
      migrate(db, [
        { version: 1, name: 'a', sql: 'CREATE TABLE a (x TEXT)' },
        { version: 2, name: 'b', sql: 'CREATE TABLE b (x INTEGER)' },
      ]),
    ).toThrow(/differs/)
  })

  it('backfills document knowledge without changing revisions or existing links', () => {
    const db = openDatabase(':memory:')
    migrate(db, MIGRATIONS.slice(0, 15))
    const now = '2026-11-21T00:00:00.000Z'
    db.prepare(`INSERT INTO workspaces (id, name, created_at) VALUES ('wsp_old', 'Old', ?)`).run(now)
    db.prepare(
      `INSERT INTO actors (id, workspace_id, kind, display_name, is_owner, created_at, updated_at)
       VALUES ('usr_old', 'wsp_old', 'human', 'Old owner', 1, ?, ?)`,
    ).run(now, now)
    db.prepare(
      `INSERT INTO projects (id, workspace_id, name, description, labels, created_by, updated_by, created_at, updated_at)
       VALUES ('prj_old', 'wsp_old', 'Old project', '', '[]', 'usr_old', 'usr_old', ?, ?)`,
    ).run(now, now)
    db.prepare(
      `INSERT INTO tasks (id, workspace_id, project_id, title, status, priority, priority_rank, labels, created_by, updated_by, created_at, updated_at)
       VALUES ('tsk_old', 'wsp_old', 'prj_old', 'Old task', 'backlog', 'none', 0, '[]', 'usr_old', 'usr_old', ?, ?)`,
    ).run(now, now)
    db.prepare(
      `INSERT INTO documents (id, workspace_id, title, body, revision, created_by, updated_by, created_at, updated_at)
       VALUES ('doc_old', 'wsp_old', 'Old document', 'old body', 1, 'usr_old', 'usr_old', ?, ?)`,
    ).run(now, now)
    db.prepare(
      `INSERT INTO document_revisions (id, document_id, number, title, body, created_by, created_at)
       VALUES ('rev_old', 'doc_old', 1, 'Old document', 'old body', 'usr_old', ?)`,
    ).run(now)
    db.prepare(`INSERT INTO task_documents (task_id, document_id, created_by, created_at) VALUES ('tsk_old', 'doc_old', 'usr_old', ?)`).run(now)
    db.prepare(`INSERT INTO project_documents (project_id, document_id, created_by, created_at) VALUES ('prj_old', 'doc_old', 'usr_old', ?)`).run(now)

    expect(migrate(db, MIGRATIONS)).toEqual([16])
    expect(db.prepare(`SELECT revision, knowledge_status, owner_id, reviewed_at, reviewed_by, reviewed_revision FROM documents WHERE id = 'doc_old'`).get()).toEqual({
      revision: 1,
      knowledge_status: 'unreviewed',
      owner_id: null,
      reviewed_at: null,
      reviewed_by: null,
      reviewed_revision: null,
    })
    expect(db.prepare(`SELECT count(*) AS count FROM document_revisions WHERE document_id = 'doc_old'`).get()).toEqual({ count: 1 })
    expect(db.prepare(`SELECT count(*) AS count FROM task_documents WHERE document_id = 'doc_old'`).get()).toEqual({ count: 1 })
    expect(db.prepare(`SELECT count(*) AS count FROM project_documents WHERE document_id = 'doc_old'`).get()).toEqual({ count: 1 })
    expect(db.prepare(`SELECT count(*) AS count FROM document_tags WHERE document_id = 'doc_old'`).get()).toEqual({ count: 0 })
    expect(db.prepare(`SELECT count(*) AS count FROM document_keywords WHERE document_id = 'doc_old'`).get()).toEqual({ count: 0 })

    expect(() => db.prepare(`UPDATE documents SET knowledge_status = 'current' WHERE id = 'doc_old'`).run()).toThrow(/invalid document review state/)
    expect(() => db.prepare(`UPDATE documents SET reviewed_at = ? WHERE id = 'doc_old'`).run(now)).toThrow(/invalid document review state/)
    expect(() =>
      db
        .prepare(`UPDATE documents SET knowledge_status = 'current', reviewed_at = ?, reviewed_by = 'usr_old', reviewed_revision = 1 WHERE id = 'doc_old'`)
        .run(now),
    ).not.toThrow()
    db.close()
  })
})
