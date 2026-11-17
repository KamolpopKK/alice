import path from 'node:path'
import Database from 'better-sqlite3'
import type { RunningApp } from './app'

/** Read-only inspection of the app database (for invariants not observable through the API). */
export function inspectDb<T>(app: RunningApp, fn: (db: Database.Database) => T): T {
  const db = new Database(path.join(app.dataDir, 'alice.db'), { readonly: true })
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

export function activityFor(app: RunningApp, resourceId: string): Array<{ verb: string; actor_id: string | null; data: any }> {
  return inspectDb(app, (db) =>
    (db.prepare('SELECT verb, actor_id, data FROM activity_events WHERE resource_id = ? ORDER BY seq').all(resourceId) as any[]).map((r) => ({
      ...r,
      data: JSON.parse(r.data),
    })),
  )
}
