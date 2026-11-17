import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrate, openDatabase } from '../../src/server/db/database'
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from '../../src/server/db/migrations'
import { startApp, tempDataDir } from '../helpers/app'
import { OWNER, HttpClient } from '../helpers/client'

/** Seeds the minimum data each historical schema can hold, through raw SQL of that era. */
function seedAt(db: ReturnType<typeof openDatabase>, version: number) {
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO workspaces (id, name, created_at) VALUES ('wsp_legacy', 'Alice', ?)`).run(now)
  db.prepare(`INSERT INTO installation (key, value) VALUES ('workspace_id', 'wsp_legacy')`).run()
  if (version >= 2) {
    db.prepare(`INSERT INTO actors (id, workspace_id, kind, display_name, is_owner, created_at, updated_at) VALUES ('usr_legacy', 'wsp_legacy', 'human', 'Legacy Owner', 1, ?, ?)`).run(now, now)
    // รหัสผ่านจริงจะตั้งผ่าน hash ภายหลัง — ทดสอบแค่ว่า schema ขึ้นได้
  }
  if (version >= 3) {
    db.prepare(`INSERT INTO projects (id, workspace_id, system_key, name, created_at, updated_at) VALUES ('prj_legacy_untitled', 'wsp_legacy', 'untitled', 'Untitled', ?, ?)`).run(now, now)
  }
  if (version >= 4) {
    db.prepare(
      `INSERT INTO tasks (id, workspace_id, project_id, title, description, status, priority, priority_rank, labels, created_by, updated_by, created_at, updated_at)
       VALUES ('tsk_legacy', 'wsp_legacy', 'prj_legacy_untitled', 'Legacy flamingo task', 'from an old schema', 'ready', 'high', 3, '[]', 'usr_legacy', 'usr_legacy', ?, ?)`,
    ).run(now, now)
  }
}

describe('upgrades from every supported prior schema', () => {
  for (let from = 1; from < LATEST_SCHEMA_VERSION; from++) {
    it(`migrates a populated v${from} database to v${LATEST_SCHEMA_VERSION}`, async () => {
      const dataDir = tempDataDir(`upgrade-v${from}`)
      const db = openDatabase(path.join(dataDir, 'alice.db'))
      migrate(db, MIGRATIONS.slice(0, from))
      seedAt(db, from)
      db.close()

      const app = await startApp({ dataDir })
      try {
        const ready = await (await fetch(`${app.url}/readyz`)).json()
        expect(ready).toMatchObject({ status: 'ready', schemaVersion: LATEST_SCHEMA_VERSION })
        if (from >= 2) {
          // ตั้งรหัสผ่านให้ owner เดิมผ่าน bootstrap ไม่ได้ (มี owner แล้ว) จึงตรวจผ่าน state
          expect((await (await fetch(`${app.url}/api/auth/state`)).json()).bootstrapped).toBe(true)
        } else {
          const owner = new HttpClient(app.url)
          expect((await owner.post('/api/auth/bootstrap', { bootstrapToken: app.env.ALICE_BOOTSTRAP_TOKEN, ...OWNER })).status).toBe(201)
          const projects = (await owner.get('/api/projects')).body.items
          expect(projects.filter((p: any) => p.isSystem)).toHaveLength(1)
        }
      } finally {
        await app.stop()
      }
      // v4 มี task แต่ยังไม่มี search: migration 5 ต้อง backfill ให้ค้นหาได้
      if (from === 4) {
        const after = openDatabase(path.join(dataDir, 'alice.db'))
        const hit = after
          .prepare(`SELECT d.resource_id FROM search_index s JOIN search_docs d ON d.rowid = s.rowid WHERE search_index MATCH '"flamingo"'`)
          .all()
        after.close()
        expect(hit).toEqual([{ resource_id: 'tsk_legacy' }])
      }
    })
  }
})
