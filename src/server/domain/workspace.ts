import type { DB } from '../db/database'
import { newId, nowIso } from '../ids'
import { ensureSystemProject } from './projects'

export function getInstallationValue(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM installation WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setInstallationValue(db: DB, key: string, value: string): void {
  db.prepare('INSERT INTO installation (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

/**
 * The first release is single-workspace; records still carry workspace_id for a future hosted edition.
 * A Local workspace passes its registry id so the database and registry share one identity.
 */
export function ensureWorkspace(db: DB, preset?: { id: string; name: string }): string {
  return db.transaction(() => {
    let id = getInstallationValue(db, 'workspace_id')
    if (preset && id && id !== preset.id) throw new Error(`This database belongs to workspace ${id}, not ${preset.id}`)
    if (!id) {
      id = preset?.id ?? newId('wsp')
      db.prepare('INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)').run(id, preset?.name ?? 'Alice', nowIso())
      setInstallationValue(db, 'workspace_id', id)
    }
    ensureSystemProject(db, id)
    return id
  }).immediate()
}
