import { createHash } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import * as z from 'zod'
import { AliceError } from '../../shared/errors'
import {
  APP_VERSION,
  CLIENT_API_MIN_VERSION,
  CLIENT_API_PREFIX,
  CLIENT_API_VERSION,
  CLIENT_API_VERSION_HEADER,
  CLIENT_CAPABILITIES,
  CLIENT_NAME_HEADER,
  IDEMPOTENCY_HEADER,
} from '../../shared/version'
import type { ClientEventsInfo } from '../../shared/contracts'
import type { AppContext } from '../context'
import { publicEvent, type ClientEventRecord, type InvalidationEvent } from '../events'
import { pruneDeviceAuthorizations } from '../domain/client-sessions'
import { prunePadMutations } from '../domain/pads'
import { requireAuth } from './auth'
import { parse } from './validate'

const HEARTBEAT_MS = 25_000
/** A resume that would replay more than this many events receives a reset instead. */
export const MAX_EVENT_REPLAY = 1000
const PRUNE_INTERVAL_MS = 10 * 60_000
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{8,128}$/
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export const isClientApi = (url: string) => url === CLIENT_API_PREFIX || url.startsWith(`${CLIENT_API_PREFIX}/`)

declare module 'fastify' {
  interface FastifyRequest {
    idempotency: { scope: string; key: string } | null
  }
}

/** Fails fast (before any handler runs) when a client declares an unsupported protocol version. */
export function checkCompatibility(raw: string | string[] | undefined): void {
  if (raw === undefined) return
  const declared = Number(Array.isArray(raw) ? raw[0] : raw)
  const details = { clientApiVersion: Number.isFinite(declared) ? declared : null, minimum: CLIENT_API_MIN_VERSION, current: CLIENT_API_VERSION }
  if (!Number.isInteger(declared) || declared < 1) {
    throw new AliceError('CLIENT_INCOMPATIBLE', `Header ${CLIENT_API_VERSION_HEADER} must be a positive integer`, { ...details, upgrade: 'client' })
  }
  if (declared < CLIENT_API_MIN_VERSION) {
    throw new AliceError('CLIENT_INCOMPATIBLE', `Client API v${declared} is no longer supported by this server; upgrade the client`, { ...details, upgrade: 'client' })
  }
  if (declared > CLIENT_API_VERSION) {
    throw new AliceError('CLIENT_INCOMPATIBLE', `This server supports Client API up to v${CLIENT_API_VERSION}; upgrade the server or use an older client`, {
      ...details,
      upgrade: 'server',
    })
  }
}

/** Fixed-window per-session limiter, separate from password and MCP limits. */
class WindowLimiter {
  private counts = new Map<string, number>()
  private windowStart = Date.now()
  constructor(private readonly max: number) {}
  hit(key: string): boolean {
    const now = Date.now()
    if (now - this.windowStart >= 60_000) {
      this.counts.clear()
      this.windowStart = now
    }
    const n = (this.counts.get(key) ?? 0) + 1
    this.counts.set(key, n)
    return n <= this.max
  }
}

export function currentEventPosition(ctx: AppContext): number {
  const row = ctx.db.prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'client_events'`).get() as { seq: number } | undefined
  return row?.seq ?? 0
}

export function pruneClientState(ctx: AppContext): void {
  const now = Date.now()
  const eventsBefore = new Date(now - ctx.config.clientEventRetentionHours * 3_600_000).toISOString()
  const idemBefore = new Date(now - ctx.config.idempotencyRetentionHours * 3_600_000).toISOString()
  ctx.db.prepare('DELETE FROM client_events WHERE created_at < ?').run(eventsBefore)
  ctx.db.prepare('DELETE FROM idempotency_records WHERE created_at < ?').run(idemBefore)
  pruneDeviceAuthorizations(ctx)
  // mutationId ของ Pad ต้องอยู่นานพอให้ outbox ที่ค้างข้ามคืน replay ได้โดยไม่ซ้ำ
  prunePadMutations(ctx, new Date(now - Math.max(ctx.config.idempotencyRetentionHours, 24 * 7) * 3_600_000).toISOString())
}

/** Decides how a subscriber resuming after `after` must catch up. */
export function planResume(ctx: AppContext, after: number): { reset: string | null; current: number } {
  const current = currentEventPosition(ctx)
  if (after === current) return { reset: null, current }
  if (after > current) return { reset: 'position_ahead_of_server', current }
  const oldest = (ctx.db.prepare('SELECT min(position) AS p FROM client_events').get() as { p: number | null }).p
  if (oldest === null || after < oldest - 1) return { reset: 'position_expired', current }
  const pending = (ctx.db.prepare('SELECT count(*) AS n FROM client_events WHERE position > ?').get(after) as { n: number }).n
  if (pending > MAX_EVENT_REPLAY) return { reset: 'too_many_events', current }
  return { reset: null, current }
}

function requestHash(req: FastifyRequest): string {
  return createHash('sha256')
    .update(JSON.stringify([req.method, req.routeOptions.url ?? req.url, req.params ?? {}, req.body ?? null]))
    .digest('hex')
}

function idempotencyScope(req: FastifyRequest): string | null {
  const auth = req.auth
  if (!auth) return null
  if (auth.clientSessionId) return `client:${auth.clientSessionId}`
  if (auth.sessionId) return `web:${auth.sessionId}`
  return null
}

export function registerClientApi(app: FastifyInstance, ctx: AppContext): void {
  const limiter = new WindowLimiter(ctx.config.clientRateLimitPerMinute)
  app.decorateRequest('idempotency', null)

  app.addHook('onRequest', async (req, reply) => {
    if (!isClientApi(req.url.split('?')[0])) return
    // ระบุ session และเวอร์ชัน client ใน request log (ไม่มี credential)
    const bindings: Record<string, string> = {}
    const clientName = req.headers[CLIENT_NAME_HEADER]
    if (typeof clientName === 'string') bindings.client = clientName.replace(/[^\w./@+-]/g, '').slice(0, 80)
    if (req.auth?.clientSessionId) bindings.clientSession = req.auth.clientSessionId
    if (Object.keys(bindings).length > 0) {
      req.log = req.log.child(bindings)
      ;(reply as { log: FastifyRequest['log'] }).log = req.log
    }
    checkCompatibility(req.headers[CLIENT_API_VERSION_HEADER])
    const key = req.auth?.clientSessionId ?? req.auth?.sessionId ?? `ip:${req.ip}`
    if (!limiter.hit(key)) throw new AliceError('RATE_LIMITED', 'Too many Client API requests; retry later')
  })

  // Idempotency: เก็บผลลัพธ์แรกไว้ ส่งซ้ำด้วย key+payload เดิมได้ผลเดิมโดยไม่สร้าง activity ซ้ำ
  app.addHook('preHandler', async (req, reply) => {
    if (!isClientApi(req.url.split('?')[0]) || !MUTATING.has(req.method)) return
    const raw = req.headers[IDEMPOTENCY_HEADER]
    if (raw === undefined) return
    const key = Array.isArray(raw) ? raw[0] : raw
    if (!IDEMPOTENCY_KEY.test(key)) throw new AliceError('VALIDATION_ERROR', 'Idempotency-Key must be 8-128 characters of letters, digits, "_", ".", ":" or "-"')
    const scope = idempotencyScope(req)
    if (!scope) return // ยังไม่ได้ login (เช่น login/bootstrap) — ไม่มี session ให้ผูก key
    const hash = requestHash(req)
    const existing = ctx.db.prepare('SELECT request_hash, status, response FROM idempotency_records WHERE scope = ? AND key = ?').get(scope, key) as
      | { request_hash: string; status: number | null; response: string | null }
      | undefined
    if (existing) {
      if (existing.request_hash !== hash) {
        throw new AliceError('IDEMPOTENCY_CONFLICT', 'This Idempotency-Key was already used for a different request')
      }
      if (existing.status === null) throw new AliceError('IDEMPOTENCY_CONFLICT', 'A request with this Idempotency-Key is still in progress')
      reply.header('Idempotent-Replayed', 'true')
      return reply.status(existing.status).type('application/json; charset=utf-8').send(existing.response ?? '')
    }
    ctx.db.prepare('INSERT INTO idempotency_records (scope, key, request_hash, created_at) VALUES (?, ?, ?, ?)').run(scope, key, hash, new Date().toISOString())
    req.idempotency = { scope, key }
  })

  app.addHook('onSend', async (req, reply, payload) => {
    const idem = req.idempotency
    if (!idem) return payload
    req.idempotency = null
    if (reply.statusCode >= 200 && reply.statusCode < 300 && typeof payload === 'string') {
      ctx.db.prepare('UPDATE idempotency_records SET status = ?, response = ? WHERE scope = ? AND key = ?').run(reply.statusCode, payload, idem.scope, idem.key)
    } else {
      // ล้มเหลว: ลบ record เพื่อให้ client retry ด้วย key เดิมได้
      ctx.db.prepare('DELETE FROM idempotency_records WHERE scope = ? AND key = ?').run(idem.scope, idem.key)
    }
    return payload
  })

  pruneClientState(ctx)
  const pruner = setInterval(() => {
    try {
      pruneClientState(ctx)
    } catch (err) {
      ctx.log?.warn({ err }, 'client state pruning failed')
    }
  }, PRUNE_INTERVAL_MS)
  pruner.unref()
  app.addHook('onClose', async () => clearInterval(pruner))

  // ข้อมูล server สำหรับตรวจ compatibility ก่อน login — ไม่มีข้อมูล workspace
  app.get(`${CLIENT_API_PREFIX}/info`, async () => ({
    product: 'alice',
    name: 'Alice',
    serverVersion: APP_VERSION,
    publicUrl: ctx.config.publicUrl.origin,
    clientApi: { current: CLIENT_API_VERSION, minimum: CLIENT_API_MIN_VERSION, prefix: CLIENT_API_PREFIX },
    capabilities: [...CLIENT_CAPABILITIES],
    events: { retentionHours: ctx.config.clientEventRetentionHours, maxReplay: MAX_EVENT_REPLAY } satisfies ClientEventsInfo,
  }))

  app.get(`${CLIENT_API_PREFIX}/events`, async (req, reply) => {
    requireAuth(req)
    const { after: afterQuery } = parse(z.object({ after: z.coerce.number().int().min(0).optional() }), req.query)
    const lastEventId = req.headers['last-event-id']
    const fromHeader = typeof lastEventId === 'string' && /^\d+$/.test(lastEventId) ? Number(lastEventId) : undefined
    const after = fromHeader ?? afterQuery
    streamClientEvents(ctx, req, reply, after)
  })
}

/** Writes the resumable invalidation stream. Positions are SSE ids so EventSource resumes natively. */
function streamClientEvents(ctx: AppContext, req: FastifyRequest, reply: FastifyReply, after: number | undefined): void {
  const stillAuthorized = req.auth?.revalidate ?? (() => true)
  const viewer = req.auth?.actor.id ?? null
  // event ส่วนตัว (Task Pads) ส่งเฉพาะ session ของเจ้าของ ทั้งแบบ live และตอน replay
  const visible = (e: ClientEventRecord) => !e.audience || e.audience === viewer
  reply.hijack()
  const res = reply.raw
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
  })
  res.write('retry: 3000\n\n')

  let lastSent = 0
  let closed = false
  const buffered: ClientEventRecord[] = []
  let live = false
  const write = (e: ClientEventRecord) => {
    if (e.position <= lastSent || !visible(e)) return
    lastSent = e.position
    res.write(`id: ${e.position}\nevent: invalidate\ndata: ${JSON.stringify(publicEvent(e))}\n\n`)
  }
  const deny = () => {
    res.write(`event: unauthorized\ndata: ${JSON.stringify({ code: 'UNAUTHENTICATED', message: 'Session is no longer valid' })}\n\n`)
    close()
    res.end()
  }
  const onEvent = (event: InvalidationEvent) => {
    if (closed) return
    if (!stillAuthorized()) return deny()
    if (!live) buffered.push(...event.events)
    else for (const e of event.events) write(e)
  }
  // subscribe ก่อนอ่าน backlog เพื่อไม่ให้ event ที่ commit ระหว่างนั้นหายไป
  const unsubscribe = ctx.bus.subscribe(onEvent)

  if (after === undefined) {
    lastSent = currentEventPosition(ctx)
    res.write(`id: ${lastSent}\nevent: ready\ndata: ${JSON.stringify({ position: lastSent })}\n\n`)
  } else {
    const plan = planResume(ctx, after)
    if (plan.reset) {
      lastSent = plan.current
      res.write(`id: ${plan.current}\nevent: reset\ndata: ${JSON.stringify({ position: plan.current, reason: plan.reset })}\n\n`)
    } else {
      lastSent = after
      const rows = ctx.db
        .prepare(
          'SELECT position, activity_id, kind, resource_id, mutation, origin FROM client_events WHERE position > ? AND (audience_id IS NULL OR audience_id = ?) ORDER BY position',
        )
        .all(after, viewer) as Array<{ position: number; activity_id: string | null; kind: string; resource_id: string; mutation: string; origin: string | null }>
      for (const r of rows) write({ position: r.position, activityId: r.activity_id, kind: r.kind, id: r.resource_id, mutation: r.mutation, origin: r.origin })
    }
    res.write(`event: ready\ndata: ${JSON.stringify({ position: lastSent })}\n\n`)
  }
  live = true
  for (const e of buffered.sort((a, b) => a.position - b.position)) write(e)
  buffered.length = 0

  const heartbeat = setInterval(() => {
    if (!stillAuthorized()) return deny()
    res.write(': keep-alive\n\n')
  }, HEARTBEAT_MS)
  function close() {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    unsubscribe()
  }
  req.raw.on('close', close)
  res.on('error', close)
}

/** Legacy `/api/events` stream (legacy shape) kept for the compatibility window. */
export function registerLegacyEvents(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/events', async (req, reply) => {
    requireAuth(req)
    reply.hijack()
    const res = reply.raw
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    })
    res.write('retry: 3000\n\n')
    res.write('event: ready\ndata: {}\n\n')
    const send = (event: InvalidationEvent) => {
      // event ส่วนตัวไม่อยู่ใน resources จึงไม่มีอะไรให้ส่งใน stream เดิม
      if (event.resources.length === 0) return
      res.write(`event: invalidate\ndata: ${JSON.stringify({ activityId: event.activityId, resources: event.resources })}\n\n`)
    }
    const unsubscribe = ctx.bus.subscribe(send)
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), HEARTBEAT_MS)
    const close = () => {
      clearInterval(heartbeat)
      unsubscribe()
    }
    req.raw.on('close', close)
    res.on('error', close)
  })
}
