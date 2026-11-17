import type { ActivityEvent, ActorKind } from '../../shared/contracts'
import type { AppContext } from '../context'
import type { DB } from '../db/database'
import type { ClientEventRecord, ResourceRef } from '../events'
import { newId, nowIso } from '../ids'
import type { Actor } from './actors'

export interface RecordInput {
  verb: string
  resource: ResourceRef
  data?: Record<string, unknown>
  /** Additional resources whose views should be invalidated (e.g. a task's project). */
  alsoInvalidate?: ResourceRef[]
}

/** Collects activity and invalidations produced inside one transaction. */
export class Mutation {
  readonly activityIds: string[] = []
  readonly resources: ResourceRef[] = []
  readonly verbs: string[] = []
  /** Owner-only invalidations (Task Pads): never written to activity or the legacy stream. */
  readonly privateRefs: Array<{ ref: ResourceRef; audience: string; mutation: string; origin: string | null }> = []
  /** Which activity (and verb) first touched each resource, for per-resource client events. */
  readonly origins = new Map<string, { activityId: string; verb: string }>()
  readonly now = nowIso()

  constructor(
    readonly db: DB,
    readonly workspaceId: string,
    readonly actor: Actor | null,
  ) {}

  record(input: RecordInput): string {
    // fault injection สำหรับพิสูจน์ atomicity ใน system test เท่านั้น
    if (process.env.NODE_ENV === 'test' && process.env.ALICE_TEST_FAIL_ACTIVITY_VERB === input.verb) {
      throw new Error(`injected activity failure for ${input.verb}`)
    }
    const id = newId('act')
    this.db
      .prepare(
        `INSERT INTO activity_events (id, workspace_id, actor_id, verb, resource_type, resource_id, data, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, this.workspaceId, this.actor?.id ?? null, input.verb, input.resource.type, input.resource.id, JSON.stringify(input.data ?? {}), this.now)
    this.activityIds.push(id)
    this.verbs.push(input.verb)
    for (const ref of [input.resource, ...(input.alsoInvalidate ?? [])]) {
      const key = `${ref.type}:${ref.id}`
      if (!this.origins.has(key)) this.origins.set(key, { activityId: id, verb: input.verb })
    }
    this.invalidate(input.resource, ...(input.alsoInvalidate ?? []))
    return id
  }

  /** Notifies only `audience`'s sessions that `ref` changed; deduplicated per resource. */
  invalidatePrivate(ref: ResourceRef, audience: string, mutation: string, origin: string | null = null): void {
    const existing = this.privateRefs.find((p) => p.ref.type === ref.type && p.ref.id === ref.id && p.audience === audience)
    if (existing) {
      existing.mutation = mutation
      existing.origin = origin ?? existing.origin
      return
    }
    this.privateRefs.push({ ref, audience, mutation, origin })
  }

  invalidate(...refs: ResourceRef[]): void {
    for (const ref of refs) {
      if (!this.resources.some((r) => r.type === ref.type && r.id === ref.id)) this.resources.push(ref)
    }
  }
}

/** Writes positioned invalidations inside the mutation transaction so they commit atomically. */
function writeClientEvents(m: Mutation): ClientEventRecord[] {
  if (m.resources.length === 0 && m.privateRefs.length === 0) return []
  const insert = m.db.prepare('INSERT INTO client_events (activity_id, kind, resource_id, mutation, created_at, audience_id, origin) VALUES (?, ?, ?, ?, ?, ?, ?)')
  const shared = m.resources.map((r): ClientEventRecord => {
    const origin = m.origins.get(`${r.type}:${r.id}`)
    const activityId = origin?.activityId ?? m.activityIds.at(-1) ?? null
    const mutation = origin?.verb ?? m.verbs.at(-1) ?? 'changed'
    const position = Number(insert.run(activityId, r.type, r.id, mutation, m.now, null, null).lastInsertRowid)
    return { position, activityId, kind: r.type, id: r.id, mutation }
  })
  const personal = m.privateRefs.map((p): ClientEventRecord => {
    const position = Number(insert.run(null, p.ref.type, p.ref.id, p.mutation, m.now, p.audience, p.origin).lastInsertRowid)
    return { position, activityId: null, kind: p.ref.type, id: p.ref.id, mutation: p.mutation, audience: p.audience, origin: p.origin }
  })
  return [...shared, ...personal]
}

export interface MutationResult<T> {
  value: T
  activityId: string | null
}

/**
 * Runs `fn` in an IMMEDIATE transaction: the resource change and its activity events
 * commit or roll back together. Browsers are notified only after commit.
 */
export function mutate<T>(ctx: AppContext, actor: Actor | null, fn: (m: Mutation) => T): MutationResult<T> {
  let mutation!: Mutation
  let events: ClientEventRecord[] = []
  const value = ctx.db
    .transaction(() => {
      mutation = new Mutation(ctx.db, ctx.workspaceId, actor)
      const result = fn(mutation)
      events = writeClientEvents(mutation)
      return result
    })
    .immediate()
  if (events.length > 0) {
    ctx.bus.publish({ activityId: mutation.activityIds.at(-1) ?? null, resources: mutation.resources, events })
  }
  return { value, activityId: mutation.activityIds.at(-1) ?? null }
}

interface ActivityRow {
  seq: number
  id: string
  actor_id: string | null
  actor_kind: ActorKind | null
  actor_name: string | null
  verb: string
  resource_type: string
  resource_id: string
  data: string
  created_at: string
}

export function toActivityEvent(row: ActivityRow): ActivityEvent {
  return {
    id: row.id,
    actor: row.actor_id ? { id: row.actor_id, kind: row.actor_kind!, displayName: row.actor_name! } : null,
    verb: row.verb,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    data: JSON.parse(row.data) as Record<string, unknown>,
    createdAt: row.created_at,
  }
}

export const ACTIVITY_SELECT = `SELECT e.seq, e.id, e.actor_id, a.kind AS actor_kind, a.display_name AS actor_name, e.verb, e.resource_type, e.resource_id, e.data, e.created_at
  FROM activity_events e LEFT JOIN actors a ON a.id = e.actor_id`

export interface ActivityPage {
  items: ActivityEvent[]
  nextCursor: string | null
}

/** Newest-first activity, keyset-paginated on the append-only sequence. */
export function listActivity(
  db: DB,
  workspaceId: string,
  filter: { resourceType?: string; resourceId?: string; actorId?: string; resourceIds?: string[]; cursor?: string | null; limit?: number } = {},
): ActivityPage {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200)
  const where = ['e.workspace_id = ?']
  const params: unknown[] = [workspaceId]
  if (filter.resourceType) {
    where.push('e.resource_type = ?')
    params.push(filter.resourceType)
  }
  if (filter.resourceId) {
    where.push('e.resource_id = ?')
    params.push(filter.resourceId)
  }
  if (filter.resourceIds && filter.resourceIds.length > 0) {
    where.push(`e.resource_id IN (${filter.resourceIds.map(() => '?').join(',')})`)
    params.push(...filter.resourceIds)
  }
  if (filter.actorId) {
    where.push('e.actor_id = ?')
    params.push(filter.actorId)
  }
  if (filter.cursor) {
    const seq = Number(Buffer.from(filter.cursor, 'base64url').toString())
    if (Number.isInteger(seq)) {
      where.push('e.seq < ?')
      params.push(seq)
    }
  }
  const rows = db.prepare(`${ACTIVITY_SELECT} WHERE ${where.join(' AND ')} ORDER BY e.seq DESC LIMIT ?`).all(...params, limit + 1) as ActivityRow[]
  const page = rows.slice(0, limit)
  const nextCursor = rows.length > limit ? Buffer.from(String(page[page.length - 1].seq)).toString('base64url') : null
  return { items: page.map(toActivityEvent), nextCursor }
}
