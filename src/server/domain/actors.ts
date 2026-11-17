import type { DB } from '../db/database'
import type { ActorKind, PublicActor } from '../../shared/contracts'
import { AliceError } from '../../shared/errors'

/** The authenticated principal performing an operation. */
export interface Actor {
  id: string
  workspaceId: string
  kind: ActorKind
  displayName: string
  isOwner: boolean
}

interface ActorRow {
  id: string
  workspace_id: string
  kind: ActorKind
  display_name: string
  is_owner: number
  created_at: string
  deactivated_at: string | null
  username: string | null
}

const ACTOR_SELECT = `SELECT a.id, a.workspace_id, a.kind, a.display_name, a.is_owner, a.created_at, a.deactivated_at, c.username
  FROM actors a LEFT JOIN human_credentials c ON c.actor_id = a.id`

export function toPublicActor(row: ActorRow): PublicActor {
  return {
    id: row.id,
    kind: row.kind,
    displayName: row.display_name,
    isOwner: row.is_owner === 1,
    username: row.username,
    createdAt: row.created_at,
    deactivatedAt: row.deactivated_at,
  }
}

export function toActor(row: ActorRow): Actor {
  return { id: row.id, workspaceId: row.workspace_id, kind: row.kind, displayName: row.display_name, isOwner: row.is_owner === 1 }
}

export function findActorRow(db: DB, id: string): ActorRow | undefined {
  return db.prepare(`${ACTOR_SELECT} WHERE a.id = ?`).get(id) as ActorRow | undefined
}

export function getPublicActor(db: DB, id: string): PublicActor {
  const row = findActorRow(db, id)
  if (!row) throw new AliceError('NOT_FOUND', 'Actor not found')
  return toPublicActor(row)
}

export function listActors(db: DB, workspaceId: string, filter: { kind?: ActorKind; includeDeactivated?: boolean } = {}): PublicActor[] {
  const where = ['a.workspace_id = ?']
  const params: unknown[] = [workspaceId]
  if (filter.kind) {
    where.push('a.kind = ?')
    params.push(filter.kind)
  }
  if (!filter.includeDeactivated) where.push('a.deactivated_at IS NULL')
  const rows = db.prepare(`${ACTOR_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.kind, a.display_name COLLATE NOCASE, a.id`).all(...params) as ActorRow[]
  return rows.map(toPublicActor)
}

/** Validates an actor id for assignment: must exist, be active and in the workspace. */
export function requireActiveActor(db: DB, workspaceId: string, id: string): ActorRow {
  const row = findActorRow(db, id)
  if (!row || row.workspace_id !== workspaceId) throw new AliceError('NOT_FOUND', `Actor ${id} not found`)
  if (row.deactivated_at) throw new AliceError('INVALID_STATE', `Actor ${id} is deactivated`)
  return row
}

export function requireOwner(actor: Actor): void {
  if (!actor.isOwner) throw new AliceError('FORBIDDEN', 'Only the workspace owner can perform this operation')
}
