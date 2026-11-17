import type { ActorKind, ActorRef } from '../../shared/contracts'

/** SQL fragment selecting an actor reference as three aliased columns. */
export function actorCols(alias: string, column: string): string {
  return `${alias}.id AS ${column}_id, ${alias}.kind AS ${column}_kind, ${alias}.display_name AS ${column}_name`
}

export function actorRefFrom(row: Record<string, unknown>, column: string): ActorRef | null {
  const id = row[`${column}_id`] as string | null
  if (!id) return null
  return { id, kind: row[`${column}_kind`] as ActorKind, displayName: row[`${column}_name`] as string }
}

export function encodeCursor(values: unknown[]): string {
  return Buffer.from(JSON.stringify(values)).toString('base64url')
}

export function decodeCursor(cursor: string | null | undefined): unknown[] | null {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString())
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Returns only fields whose values changed, as {field: {from, to}} for activity data. */
export function diff<T extends Record<string, unknown>>(before: T, patch: Partial<T>): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const [key, to] of Object.entries(patch)) {
    if (to === undefined) continue
    const from = before[key]
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to }
  }
  return changes
}
