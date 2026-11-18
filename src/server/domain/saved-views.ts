import type * as z from 'zod'
import type { SavedView, TaskViewName, createSavedViewInput } from '../../shared/saved-views'
import { AliceError } from '../../shared/errors'
import type { AppContext } from '../context'
import { newId } from '../ids'
import { mutate } from './activity'
import type { Actor } from './actors'

interface SavedViewRow {
  id: string
  name: string
  view: TaskViewName
  query: string
  created_at: string
  updated_at: string
}

const toView = (r: SavedViewRow): SavedView => ({ id: r.id, name: r.name, view: r.view, query: r.query, createdAt: r.created_at, updatedAt: r.updated_at })

/** Saved views are personal preferences of a human: never shared, never in activity or search. */
function requireHuman(actor: Actor): void {
  if (actor.kind !== 'human') throw new AliceError('FORBIDDEN', 'Saved views are available to human accounts only')
}

export function listSavedViews(ctx: AppContext, actor: Actor): SavedView[] {
  requireHuman(actor)
  const rows = ctx.db
    .prepare('SELECT id, name, view, query, created_at, updated_at FROM saved_views WHERE workspace_id = ? AND owner_id = ? ORDER BY name COLLATE NOCASE, id')
    .all(ctx.workspaceId, actor.id) as SavedViewRow[]
  return rows.map(toView)
}

/** Saves a view; a view with the same name is replaced (one name, one view per person). */
export function saveSavedView(ctx: AppContext, actor: Actor, input: z.infer<typeof createSavedViewInput>): { view: SavedView } {
  requireHuman(actor)
  const { value } = mutate(ctx, actor, (m) => {
    const existing = m.db.prepare('SELECT id FROM saved_views WHERE workspace_id = ? AND owner_id = ? AND name = ?').get(m.workspaceId, actor.id, input.name) as { id: string } | undefined
    const id = existing?.id ?? newId('svw')
    if (existing) m.db.prepare('UPDATE saved_views SET view = ?, query = ?, updated_at = ? WHERE id = ?').run(input.view, input.query, m.now, id)
    else
      m.db
        .prepare('INSERT INTO saved_views (id, workspace_id, owner_id, name, view, query, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, m.workspaceId, actor.id, input.name, input.view, input.query, m.now, m.now)
    m.invalidatePrivate({ type: 'saved_view', id }, actor.id, 'saved_view.saved')
    return id
  })
  const row = ctx.db.prepare('SELECT id, name, view, query, created_at, updated_at FROM saved_views WHERE id = ?').get(value) as SavedViewRow
  return { view: toView(row) }
}

export function deleteSavedView(ctx: AppContext, actor: Actor, id: string): { deleted: true; id: string } {
  requireHuman(actor)
  mutate(ctx, actor, (m) => {
    // ของคนอื่นกับ id ที่ไม่มีอยู่ ตอบเหมือนกันทุกประการ
    const res = m.db.prepare('DELETE FROM saved_views WHERE id = ? AND workspace_id = ? AND owner_id = ?').run(id, m.workspaceId, actor.id)
    if (res.changes === 0) throw new AliceError('NOT_FOUND', `Saved view ${id} not found`)
    m.invalidatePrivate({ type: 'saved_view', id }, actor.id, 'saved_view.deleted')
  })
  return { deleted: true, id }
}
