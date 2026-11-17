import { randomInt } from 'node:crypto'
import type * as z from 'zod'
import type {
  ClientCredentials,
  ClientKind,
  ClientSessionInfo,
  DeviceAuthorization,
  DeviceRequestInfo,
  deviceAuthorizeInput,
} from '../../shared/contracts'
import { AliceError } from '../../shared/errors'
import { generateSecret, sha256 } from '../auth/crypto'
import type { AppContext } from '../context'
import { newId, nowIso } from '../ids'
import { mutate } from './activity'
import { type Actor, findActorRow, getPublicActor, toActor } from './actors'

export const DEVICE_SECRET_PREFIX = 'alice_dc_'
export const ACCESS_PREFIX = 'alice_ca_'
export const REFRESH_PREFIX = 'alice_cr_'

export const DEVICE_TTL_MS = 10 * 60_000
const MAX_POLL_INTERVAL_S = 60
export const ACCESS_TTL_MS = 15 * 60_000
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000
const LAST_USED_RESOLUTION_MS = 60_000

// ตัวอักษรที่อ่านง่ายและไม่ประกอบเป็นคำ (ไม่มีสระ, ไม่มี 0/O/1/I)
const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ'

export function generateUserCode(): string {
  let out = ''
  for (let i = 0; i < 8; i++) out += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)]
  return `${out.slice(0, 4)}-${out.slice(4)}`
}

/** Accepts `bcdf-ghjk`, `BCDFGHJK` or `BCDF GHJK` and returns the canonical form. */
export function normalizeUserCode(raw: string): string {
  const letters = raw.toUpperCase().replace(/[^A-Z]/g, '')
  return letters.length === 8 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : letters
}

interface DeviceRow {
  id: string
  client_kind: ClientKind
  client_name: string
  device_name: string
  client_version: string
  status: DeviceRequestInfo['status']
  actor_id: string | null
  session_id: string | null
  poll_interval_s: number
  last_poll_at: string | null
  created_at: string
  expires_at: string
}

interface SessionRow {
  id: string
  actor_id: string
  actor_kind: 'human' | 'agent'
  actor_name: string
  client_kind: ClientKind
  client_name: string
  device_name: string
  client_version: string
  access_expires_at: string | null
  refresh_expires_at: string
  created_at: string
  last_used_at: string
  last_refreshed_at: string | null
  revoked_at: string | null
  revoke_reason: string | null
}

const SESSION_SELECT = `SELECT s.id, s.actor_id, a.kind AS actor_kind, a.display_name AS actor_name, s.client_kind, s.client_name, s.device_name,
  s.client_version, s.access_expires_at, s.refresh_expires_at, s.created_at, s.last_used_at, s.last_refreshed_at, s.revoked_at, s.revoke_reason
  FROM client_sessions s JOIN actors a ON a.id = s.actor_id`

function toSessionInfo(row: SessionRow, currentId: string | null = null): ClientSessionInfo {
  return {
    id: row.id,
    actor: { id: row.actor_id, kind: row.actor_kind, displayName: row.actor_name },
    clientKind: row.client_kind,
    clientName: row.client_name,
    deviceName: row.device_name,
    clientVersion: row.client_version,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    lastRefreshedAt: row.last_refreshed_at,
    revokedAt: row.revoked_at,
    revokeReason: row.revoke_reason,
    current: row.id === currentId,
  }
}

function getSessionRow(ctx: AppContext, id: string): SessionRow {
  const row = ctx.db.prepare(`${SESSION_SELECT} WHERE s.id = ? AND s.workspace_id = ?`).get(id, ctx.workspaceId) as SessionRow | undefined
  if (!row) throw new AliceError('NOT_FOUND', 'Client session not found')
  return row
}

function requireHuman(actor: Actor): void {
  if (actor.kind !== 'human') throw new AliceError('FORBIDDEN', 'Only a signed-in human can authorize a client')
}

// ---------- Device authorization ----------

export function startDeviceAuthorization(ctx: AppContext, input: z.infer<typeof deviceAuthorizeInput>): DeviceAuthorization {
  const deviceCode = generateSecret(DEVICE_SECRET_PREFIX, 43)
  const now = Date.now()
  const expiresAt = new Date(now + DEVICE_TTL_MS).toISOString()
  // user code สั้น อาจชนได้ (น้อยมาก) — สุ่มใหม่จนกว่าจะไม่ซ้ำ
  for (let attempt = 0; ; attempt++) {
    const userCode = generateUserCode()
    try {
      ctx.db
        .prepare(
          `INSERT INTO device_authorizations (id, workspace_id, device_secret_hash, user_code_hash, client_kind, client_name, device_name, client_version,
            status, poll_interval_s, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
        )
        .run(newId('dva'), ctx.workspaceId, sha256(deviceCode), sha256(userCode), input.clientKind, input.clientName, input.deviceName, input.clientVersion, ctx.config.devicePollIntervalSeconds, new Date(now).toISOString(), expiresAt)
      const verificationUri = new URL('/device', ctx.config.publicUrl).href
      return {
        deviceCode,
        userCode,
        verificationUri,
        verificationUriComplete: `${verificationUri}?code=${encodeURIComponent(userCode)}`,
        expiresIn: Math.round(DEVICE_TTL_MS / 1000),
        interval: ctx.config.devicePollIntervalSeconds,
      }
    } catch (err) {
      if (attempt >= 5 || !String((err as Error).message).includes('UNIQUE')) throw err
    }
  }
}

const isExpired = (row: { expires_at: string }) => Date.parse(row.expires_at) <= Date.now()

function findByUserCode(ctx: AppContext, userCode: string): DeviceRow {
  const row = ctx.db
    .prepare('SELECT * FROM device_authorizations WHERE user_code_hash = ? AND workspace_id = ?')
    .get(sha256(normalizeUserCode(userCode)), ctx.workspaceId) as DeviceRow | undefined
  if (!row || row.status !== 'pending' || isExpired(row)) {
    throw new AliceError('DEVICE_CODE_EXPIRED', 'This code is unknown, expired or already used. Start sign-in again from the app.')
  }
  return row
}

export function lookupDeviceRequest(ctx: AppContext, actor: Actor, userCode: string): DeviceRequestInfo {
  requireHuman(actor)
  const row = findByUserCode(ctx, userCode)
  return {
    clientKind: row.client_kind,
    clientName: row.client_name,
    deviceName: row.device_name,
    clientVersion: row.client_version,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: row.status,
  }
}

/** The approving human creates a named session; credentials are issued only on the client's next poll. */
export function approveDeviceRequest(ctx: AppContext, actor: Actor, userCode: string): ClientSessionInfo {
  requireHuman(actor)
  const { value: sessionId } = mutate(ctx, actor, (m) => {
    const row = findByUserCode(ctx, userCode)
    const sessionId = newId('cls')
    m.db
      .prepare(
        `INSERT INTO client_sessions (id, workspace_id, actor_id, client_kind, client_name, device_name, client_version, refresh_hash, refresh_expires_at, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      // refresh_hash ชั่วคราว (สุ่ม ใช้งานไม่ได้) จนกว่า client จะแลกรับ credential
      .run(sessionId, ctx.workspaceId, actor.id, row.client_kind, row.client_name, row.device_name, row.client_version, sha256(generateSecret('pending_', 32)), m.now, m.now, m.now)
    m.db.prepare(`UPDATE device_authorizations SET status = 'approved', actor_id = ?, session_id = ?, decided_at = ? WHERE id = ?`).run(actor.id, sessionId, m.now, row.id)
    m.record({
      verb: 'client_session.approved',
      resource: { type: 'client_session', id: sessionId },
      data: { clientKind: row.client_kind, clientName: row.client_name, deviceName: row.device_name, clientVersion: row.client_version },
    })
    return sessionId
  })
  return toSessionInfo(getSessionRow(ctx, sessionId))
}

export function denyDeviceRequest(ctx: AppContext, actor: Actor, userCode: string): { denied: true } {
  requireHuman(actor)
  mutate(ctx, actor, (m) => {
    const row = findByUserCode(ctx, userCode)
    m.db.prepare(`UPDATE device_authorizations SET status = 'denied', actor_id = ?, decided_at = ? WHERE id = ?`).run(actor.id, m.now, row.id)
    m.record({
      verb: 'device.denied',
      resource: { type: 'device_authorization', id: row.id },
      data: { clientKind: row.client_kind, clientName: row.client_name, deviceName: row.device_name },
    })
  })
  return { denied: true }
}

function issueCredentials(ctx: AppContext, sessionId: string, now: number): { accessToken: string; refreshToken: string; accessExpiresAt: string; refreshExpiresAt: string } {
  const accessToken = generateSecret(ACCESS_PREFIX, 43)
  const refreshToken = generateSecret(REFRESH_PREFIX, 43)
  const accessExpiresAt = new Date(now + ACCESS_TTL_MS).toISOString()
  const refreshExpiresAt = new Date(now + REFRESH_TTL_MS).toISOString()
  ctx.db
    .prepare('UPDATE client_sessions SET access_hash = ?, access_expires_at = ?, refresh_hash = ?, refresh_expires_at = ? WHERE id = ?')
    .run(sha256(accessToken), accessExpiresAt, sha256(refreshToken), refreshExpiresAt, sessionId)
  return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt }
}

function credentialsFor(ctx: AppContext, sessionId: string, issued: ReturnType<typeof issueCredentials>): ClientCredentials {
  const row = getSessionRow(ctx, sessionId)
  return { ...issued, session: toSessionInfo(row, sessionId), actor: getPublicActor(ctx.db, row.actor_id) }
}

/** Device polling. Pending, slow-down, denial and expiry are stable error codes; approval exchanges exactly once. */
export function exchangeDeviceCode(ctx: AppContext, deviceCode: string): ClientCredentials {
  // ผลการ poll ต้อง commit ก่อน throw (ไม่งั้นเวลา poll ล่าสุดจะถูก rollback และ slow-down ไม่ทำงาน)
  const outcome = ctx.db
    .transaction((): AliceError | ClientCredentials => {
      const row = ctx.db.prepare('SELECT * FROM device_authorizations WHERE device_secret_hash = ? AND workspace_id = ?').get(sha256(deviceCode), ctx.workspaceId) as
        | DeviceRow
        | undefined
      if (!row || row.status === 'exchanged' || isExpired(row)) {
        return new AliceError('DEVICE_CODE_EXPIRED', 'The device code is unknown, expired or already used; start sign-in again')
      }
      if (row.status === 'denied') return new AliceError('DEVICE_ACCESS_DENIED', 'The sign-in request was denied')
      const now = Date.now()
      if (row.status === 'pending') {
        const tooSoon = row.last_poll_at !== null && now - Date.parse(row.last_poll_at) < row.poll_interval_s * 1000
        const interval = tooSoon ? Math.min(row.poll_interval_s + 5, MAX_POLL_INTERVAL_S) : row.poll_interval_s
        ctx.db.prepare('UPDATE device_authorizations SET last_poll_at = ?, poll_interval_s = ? WHERE id = ?').run(new Date(now).toISOString(), interval, row.id)
        if (tooSoon) return new AliceError('DEVICE_SLOW_DOWN', `Polling too fast; wait ${interval} seconds between attempts`, { interval })
        return new AliceError('DEVICE_AUTHORIZATION_PENDING', 'Waiting for approval in the browser', { interval })
      }
      // approved → ออก credential ครั้งเดียว
      ctx.db.prepare(`UPDATE device_authorizations SET status = 'exchanged' WHERE id = ?`).run(row.id)
      const issued = issueCredentials(ctx, row.session_id!, now)
      ctx.log?.info({ clientSession: row.session_id, clientKind: row.client_kind, clientVersion: row.client_version }, 'client_session.issued')
      return credentialsFor(ctx, row.session_id!, issued)
    })
    .immediate()
  if (outcome instanceof AliceError) throw outcome
  return outcome
}

// ---------- Sessions ----------

/** Resolves a bearer access credential to a human actor, or null if it is unknown, expired or revoked. */
export function resolveAccessToken(ctx: AppContext, token: string): { actor: Actor; sessionId: string } | null {
  if (!token.startsWith(ACCESS_PREFIX)) return null
  const row = ctx.db
    .prepare('SELECT id, actor_id, access_expires_at, last_used_at, revoked_at FROM client_sessions WHERE access_hash = ? AND workspace_id = ?')
    .get(sha256(token), ctx.workspaceId) as { id: string; actor_id: string; access_expires_at: string; last_used_at: string; revoked_at: string | null } | undefined
  if (!row || row.revoked_at || Date.parse(row.access_expires_at) <= Date.now()) return null
  const actorRow = findActorRow(ctx.db, row.actor_id)
  if (!actorRow || actorRow.deactivated_at || actorRow.kind !== 'human') return null
  if (Date.now() - Date.parse(row.last_used_at) > LAST_USED_RESOLUTION_MS) {
    ctx.db.prepare('UPDATE client_sessions SET last_used_at = ? WHERE id = ?').run(nowIso(), row.id)
  }
  return { actor: toActor(actorRow), sessionId: row.id }
}

/** True while the session is neither revoked nor owned by a deactivated actor (used by event streams). */
export function isClientSessionActive(ctx: AppContext, sessionId: string): boolean {
  const row = ctx.db
    .prepare('SELECT s.revoked_at, a.deactivated_at FROM client_sessions s JOIN actors a ON a.id = s.actor_id WHERE s.id = ?')
    .get(sessionId) as { revoked_at: string | null; deactivated_at: string | null } | undefined
  return !!row && !row.revoked_at && !row.deactivated_at
}

function revokeSessionRow(ctx: AppContext, actor: Actor | null, sessionId: string, reason: string): void {
  mutate(ctx, actor, (m) => {
    const res = m.db
      .prepare('UPDATE client_sessions SET revoked_at = ?, revoke_reason = ?, access_hash = NULL WHERE id = ? AND revoked_at IS NULL')
      .run(m.now, reason, sessionId)
    if (res.changes === 0) return
    m.record({ verb: 'client_session.revoked', resource: { type: 'client_session', id: sessionId }, data: { reason } })
  })
  ctx.log?.info({ clientSession: sessionId, reason }, 'client_session.revoked')
}

/** Rotates the refresh credential. Presenting an already-rotated credential revokes the whole session. */
export function refreshClientSession(ctx: AppContext, refreshToken: string): ClientCredentials {
  const invalid = () => new AliceError('UNAUTHENTICATED', 'The session is expired or revoked; sign in again')
  if (!refreshToken.startsWith(REFRESH_PREFIX)) throw invalid()
  const hash = sha256(refreshToken)
  const outcome = ctx.db
    .transaction((): { kind: 'ok'; sessionId: string; issued: ReturnType<typeof issueCredentials> } | { kind: 'replay'; sessionId: string } | { kind: 'invalid' } => {
      const row = ctx.db
        .prepare('SELECT s.id, s.refresh_expires_at, s.revoked_at, a.deactivated_at FROM client_sessions s JOIN actors a ON a.id = s.actor_id WHERE s.refresh_hash = ? AND s.workspace_id = ?')
        .get(hash, ctx.workspaceId) as { id: string; refresh_expires_at: string; revoked_at: string | null; deactivated_at: string | null } | undefined
      if (!row) {
        const replayed = ctx.db.prepare('SELECT session_id FROM client_refresh_history WHERE refresh_hash = ?').get(hash) as { session_id: string } | undefined
        return replayed ? { kind: 'replay', sessionId: replayed.session_id } : { kind: 'invalid' }
      }
      if (row.revoked_at || row.deactivated_at || Date.parse(row.refresh_expires_at) <= Date.now()) return { kind: 'invalid' }
      const now = Date.now()
      ctx.db.prepare('INSERT INTO client_refresh_history (refresh_hash, session_id, rotated_at) VALUES (?, ?, ?)').run(hash, row.id, new Date(now).toISOString())
      const issued = issueCredentials(ctx, row.id, now)
      ctx.db.prepare('UPDATE client_sessions SET last_refreshed_at = ?, last_used_at = ? WHERE id = ?').run(new Date(now).toISOString(), new Date(now).toISOString(), row.id)
      return { kind: 'ok', sessionId: row.id, issued }
    })
    .immediate()
  if (outcome.kind === 'replay') {
    // credential ที่หมุนไปแล้วถูกใช้ซ้ำ → อาจรั่ว: revoke ทั้ง session ทันที
    revokeSessionRow(ctx, null, outcome.sessionId, 'refresh_reuse_detected')
    throw new AliceError('UNAUTHENTICATED', 'This refresh credential was already used; the session has been revoked. Sign in again.')
  }
  if (outcome.kind === 'invalid') throw invalid()
  ctx.log?.info({ clientSession: outcome.sessionId }, 'client_session.refreshed')
  return credentialsFor(ctx, outcome.sessionId, outcome.issued)
}

/** Sign-out with only the refresh credential (e.g. when the access credential already expired). Never reveals validity. */
export function revokeByRefreshToken(ctx: AppContext, refreshToken: string): void {
  const row = ctx.db.prepare('SELECT id, actor_id FROM client_sessions WHERE refresh_hash = ? AND workspace_id = ? AND revoked_at IS NULL').get(sha256(refreshToken), ctx.workspaceId) as
    | { id: string; actor_id: string }
    | undefined
  if (!row) return
  const actorRow = findActorRow(ctx.db, row.actor_id)
  revokeSessionRow(ctx, actorRow ? toActor(actorRow) : null, row.id, 'signed_out')
}

export function revokeCurrentClientSession(ctx: AppContext, actor: Actor, sessionId: string): void {
  revokeSessionRow(ctx, actor, sessionId, 'signed_out')
}

/** Humans see their own sessions; the owner sees everyone's. */
export function listClientSessions(ctx: AppContext, actor: Actor, currentId: string | null, includeRevoked = false): ClientSessionInfo[] {
  requireHuman(actor)
  const where = ['s.workspace_id = ?']
  const params: unknown[] = [ctx.workspaceId]
  if (!actor.isOwner) {
    where.push('s.actor_id = ?')
    params.push(actor.id)
  }
  if (!includeRevoked) where.push('s.revoked_at IS NULL')
  // session ที่อนุมัติแล้วแต่ client ยังไม่มารับ credential ก็แสดงด้วย เพื่อให้ revoke ได้
  const rows = ctx.db.prepare(`${SESSION_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.created_at DESC, s.id`).all(...params) as SessionRow[]
  return rows.map((r) => toSessionInfo(r, currentId))
}

export function revokeClientSession(ctx: AppContext, actor: Actor, sessionId: string): ClientSessionInfo {
  requireHuman(actor)
  const row = getSessionRow(ctx, sessionId)
  if (row.actor_id !== actor.id && !actor.isOwner) throw new AliceError('FORBIDDEN', 'You can only revoke your own sessions')
  revokeSessionRow(ctx, actor, sessionId, actor.id === row.actor_id ? 'revoked_by_user' : 'revoked_by_owner')
  return toSessionInfo(getSessionRow(ctx, sessionId))
}

export function pruneDeviceAuthorizations(ctx: AppContext): void {
  ctx.db.prepare('DELETE FROM device_authorizations WHERE expires_at < ?').run(new Date(Date.now() - 24 * 3_600_000).toISOString())
}
