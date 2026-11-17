import fs from 'node:fs'
import path from 'node:path'
import type * as z from 'zod'
import type { AgentTokenInfo, InviteInfo, PublicActor } from '../../shared/contracts'
import type { acceptInviteInput, bootstrapInput, createAgentInput, createInviteInput, loginInput } from '../../shared/contracts'
import { AliceError } from '../../shared/errors'
import type { AppContext } from '../context'
import {
  AGENT_TOKEN_PREFIX,
  INVITE_PREFIX,
  SESSION_PREFIX,
  dummyPasswordHash,
  generateSecret,
  hashPassword,
  safeEqual,
  sha256,
  verifyPassword,
} from '../auth/crypto'
import { newId, nowIso, randomBase32 } from '../ids'
import { mutate, type Mutation } from './activity'
import { type Actor, findActorRow, getPublicActor, requireOwner, toActor } from './actors'

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const LAST_SEEN_RESOLUTION_MS = 5 * 60 * 1000
const BOOTSTRAP_FILE = 'bootstrap-token'

// ---------- Bootstrap ----------

export function isBootstrapped(ctx: AppContext): boolean {
  return !!ctx.db.prepare('SELECT 1 FROM actors WHERE workspace_id = ? AND is_owner = 1').get(ctx.workspaceId)
}

function bootstrapFile(ctx: AppContext): string {
  return path.join(ctx.config.dataDir, BOOTSTRAP_FILE)
}

/**
 * Startup hook. Without ALICE_BOOTSTRAP_TOKEN, a one-time token is written to a
 * private file in the data directory; only the file path is logged, never the value.
 */
export function prepareBootstrap(ctx: AppContext): void {
  if (isBootstrapped(ctx)) {
    fs.rmSync(bootstrapFile(ctx), { force: true })
    return
  }
  if (ctx.config.bootstrapToken) {
    ctx.log?.info({ setupUrl: new URL('/setup', ctx.config.publicUrl).href }, 'alice.bootstrap_pending: open the setup URL and enter ALICE_BOOTSTRAP_TOKEN')
    return
  }
  const file = bootstrapFile(ctx)
  if (!fs.existsSync(file)) fs.writeFileSync(file, generateSecret('alice_boot_', 32) + '\n', { mode: 0o600 })
  ctx.log?.info(
    { setupUrl: new URL('/setup', ctx.config.publicUrl).href, tokenFile: file },
    'alice.bootstrap_pending: open the setup URL and enter the token stored in tokenFile',
  )
  // คนรันใน docker มักไม่ได้ดู log แบบ JSON — พิมพ์คำแนะนำสั้น ๆ ไปที่ stderr ด้วย (ไม่มีค่า token)
  if (ctx.config.env !== 'test') {
    process.stderr.write(`\nAlice is not set up yet. Open ${new URL('/setup', ctx.config.publicUrl).href}\nand enter the bootstrap token from ${file}\n\n`)
  }
}

function expectedBootstrapToken(ctx: AppContext): string | null {
  if (ctx.config.bootstrapToken) return ctx.config.bootstrapToken
  try {
    return fs.readFileSync(bootstrapFile(ctx), 'utf8').trim()
  } catch {
    return null
  }
}

function insertHuman(m: Mutation, input: { username: string; displayName: string; passwordHash: string; isOwner: boolean }): string {
  const id = newId('usr')
  const taken = m.db.prepare('SELECT 1 FROM human_credentials WHERE username = ?').get(input.username)
  if (taken) throw new AliceError('CONFLICT', 'That username is already taken')
  m.db
    .prepare('INSERT INTO actors (id, workspace_id, kind, display_name, is_owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, m.workspaceId, 'human', input.displayName, input.isOwner ? 1 : 0, m.now, m.now)
  m.db.prepare('INSERT INTO human_credentials (actor_id, username, password_hash, updated_at) VALUES (?, ?, ?, ?)').run(id, input.username, input.passwordHash, m.now)
  return id
}

export async function bootstrapOwner(ctx: AppContext, input: z.infer<typeof bootstrapInput>): Promise<PublicActor> {
  if (isBootstrapped(ctx)) throw new AliceError('INVALID_STATE', 'This installation already has an owner')
  const expected = expectedBootstrapToken(ctx)
  if (!expected || !safeEqual(sha256(input.bootstrapToken), sha256(expected))) {
    throw new AliceError('UNAUTHENTICATED', 'The bootstrap token is not valid')
  }
  const passwordHash = await hashPassword(input.password)
  const { value: id } = mutate(ctx, null, (m) => {
    // ตรวจซ้ำใน transaction กัน bootstrap พร้อมกันสองครั้ง
    if (m.db.prepare('SELECT 1 FROM actors WHERE workspace_id = ? AND is_owner = 1').get(m.workspaceId)) {
      throw new AliceError('INVALID_STATE', 'This installation already has an owner')
    }
    const ownerId = insertHuman(m, { username: input.username, displayName: input.displayName, passwordHash, isOwner: true })
    m.record({ verb: 'workspace.bootstrapped', resource: { type: 'actor', id: ownerId }, data: { displayName: input.displayName } })
    return ownerId
  })
  fs.rmSync(bootstrapFile(ctx), { force: true })
  return getPublicActor(ctx.db, id)
}

// ---------- Sessions ----------

export interface IssuedSession {
  token: string
  csrfToken: string
  expiresAt: string
}

export function createSession(ctx: AppContext, actorId: string): IssuedSession {
  const token = generateSecret(SESSION_PREFIX, 48)
  const csrfToken = randomBase32(32)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString()
  ctx.db
    .prepare('INSERT INTO sessions (id, token_hash, actor_id, csrf_token, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(newId('ses'), sha256(token), actorId, csrfToken, now.toISOString(), now.toISOString(), expiresAt)
  return { token, csrfToken, expiresAt }
}

export interface ResolvedSession {
  sessionId: string
  actor: Actor
  csrfToken: string
}

export function resolveSession(ctx: AppContext, token: string): ResolvedSession | null {
  if (!token.startsWith(SESSION_PREFIX)) return null
  const row = ctx.db
    .prepare('SELECT id, actor_id, csrf_token, last_seen_at, expires_at, revoked_at FROM sessions WHERE token_hash = ?')
    .get(sha256(token)) as { id: string; actor_id: string; csrf_token: string; last_seen_at: string; expires_at: string; revoked_at: string | null } | undefined
  if (!row || row.revoked_at || Date.parse(row.expires_at) <= Date.now()) return null
  const actorRow = findActorRow(ctx.db, row.actor_id)
  if (!actorRow || actorRow.deactivated_at || actorRow.workspace_id !== ctx.workspaceId) return null
  if (Date.now() - Date.parse(row.last_seen_at) > LAST_SEEN_RESOLUTION_MS) {
    ctx.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(nowIso(), row.id)
  }
  return { sessionId: row.id, actor: toActor(actorRow), csrfToken: row.csrf_token }
}

export function revokeSession(ctx: AppContext, sessionId: string): void {
  ctx.db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(nowIso(), sessionId)
}

export async function login(ctx: AppContext, input: z.infer<typeof loginInput>): Promise<{ actor: PublicActor; session: IssuedSession }> {
  const row = ctx.db
    .prepare(
      `SELECT c.actor_id, c.password_hash, a.deactivated_at FROM human_credentials c JOIN actors a ON a.id = c.actor_id
       WHERE c.username = ? AND a.workspace_id = ?`,
    )
    .get(input.username.trim().toLowerCase(), ctx.workspaceId) as { actor_id: string; password_hash: string; deactivated_at: string | null } | undefined
  const ok = await verifyPassword(input.password, row?.password_hash ?? (await dummyPasswordHash()))
  if (!row || !ok || row.deactivated_at) throw new AliceError('UNAUTHENTICATED', 'Username or password is incorrect')
  return { actor: getPublicActor(ctx.db, row.actor_id), session: createSession(ctx, row.actor_id) }
}

// ---------- Invites ----------

interface InviteRow {
  id: string
  note: string
  created_at: string
  expires_at: string
  used_at: string | null
  revoked_at: string | null
}

function toInviteInfo(row: InviteRow): InviteInfo {
  const status = row.revoked_at ? 'revoked' : row.used_at ? 'used' : Date.parse(row.expires_at) <= Date.now() ? 'expired' : 'pending'
  return { id: row.id, note: row.note, createdAt: row.created_at, expiresAt: row.expires_at, usedAt: row.used_at, revokedAt: row.revoked_at, status }
}

export function createInvite(ctx: AppContext, actor: Actor, input: z.infer<typeof createInviteInput>): { invite: InviteInfo; url: string; activityId: string | null } {
  requireOwner(actor)
  const token = generateSecret(INVITE_PREFIX, 40)
  const { value, activityId } = mutate(ctx, actor, (m) => {
    const id = newId('inv')
    const expiresAt = new Date(Date.now() + input.expiresInHours * 3600 * 1000).toISOString()
    m.db
      .prepare('INSERT INTO invites (id, workspace_id, token_hash, note, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, m.workspaceId, sha256(token), input.note, actor.id, m.now, expiresAt)
    m.record({ verb: 'invite.created', resource: { type: 'invite', id }, data: { expiresAt, note: input.note } })
    return id
  })
  const row = ctx.db.prepare('SELECT * FROM invites WHERE id = ?').get(value) as InviteRow
  return { invite: toInviteInfo(row), url: new URL(`/invite/${token}`, ctx.config.publicUrl).href, activityId }
}

export function listInvites(ctx: AppContext, actor: Actor): InviteInfo[] {
  requireOwner(actor)
  const rows = ctx.db.prepare('SELECT * FROM invites WHERE workspace_id = ? ORDER BY created_at DESC, id').all(ctx.workspaceId) as InviteRow[]
  return rows.map(toInviteInfo)
}

export function revokeInvite(ctx: AppContext, actor: Actor, inviteId: string): InviteInfo {
  requireOwner(actor)
  mutate(ctx, actor, (m) => {
    const row = m.db.prepare('SELECT * FROM invites WHERE id = ? AND workspace_id = ?').get(inviteId, m.workspaceId) as InviteRow | undefined
    if (!row) throw new AliceError('NOT_FOUND', 'Invite not found')
    if (row.used_at) throw new AliceError('INVALID_STATE', 'Invite has already been used')
    if (!row.revoked_at) {
      m.db.prepare('UPDATE invites SET revoked_at = ? WHERE id = ?').run(m.now, inviteId)
      m.record({ verb: 'invite.revoked', resource: { type: 'invite', id: inviteId } })
    }
  })
  return toInviteInfo(ctx.db.prepare('SELECT * FROM invites WHERE id = ?').get(inviteId) as InviteRow)
}

const INVALID_INVITE = 'This invite link is invalid, expired, or has already been used'

export function checkInvite(ctx: AppContext, token: string): boolean {
  const row = ctx.db.prepare('SELECT * FROM invites WHERE token_hash = ?').get(sha256(token)) as InviteRow | undefined
  return !!row && toInviteInfo(row).status === 'pending'
}

export async function acceptInvite(ctx: AppContext, input: z.infer<typeof acceptInviteInput>): Promise<{ actor: PublicActor; session: IssuedSession }> {
  if (!checkInvite(ctx, input.token)) throw new AliceError('UNAUTHENTICATED', INVALID_INVITE)
  const passwordHash = await hashPassword(input.password)
  const { value: actorId } = mutate(ctx, null, (m) => {
    const row = m.db.prepare('SELECT * FROM invites WHERE token_hash = ?').get(sha256(input.token)) as InviteRow | undefined
    if (!row || toInviteInfo(row).status !== 'pending') throw new AliceError('UNAUTHENTICATED', INVALID_INVITE)
    const id = insertHuman(m, { username: input.username, displayName: input.displayName, passwordHash, isOwner: false })
    // single-use: UPDATE แบบมีเงื่อนไข — ถ้ามีคนใช้ไปก่อนจะได้ changes = 0 และ rollback ทั้งหมด
    const used = m.db.prepare('UPDATE invites SET used_at = ?, used_by = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL').run(m.now, id, row.id)
    if (used.changes !== 1) throw new AliceError('UNAUTHENTICATED', INVALID_INVITE)
    // actor ใหม่เป็นผู้ทำ activity ของตัวเอง
    m.db
      .prepare(
        `INSERT INTO activity_events (id, workspace_id, actor_id, verb, resource_type, resource_id, data, created_at) VALUES (?, ?, ?, 'invite.accepted', 'actor', ?, ?, ?)`,
      )
      .run(newId('act'), m.workspaceId, id, id, JSON.stringify({ inviteId: row.id, displayName: input.displayName }), m.now)
    m.invalidate({ type: 'actor', id })
    return id
  })
  return { actor: getPublicActor(ctx.db, actorId), session: createSession(ctx, actorId) }
}

// ---------- Agents and tokens ----------

interface TokenRow {
  id: string
  actor_id: string
  name: string
  token_hint: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

function toTokenInfo(row: TokenRow): AgentTokenInfo {
  return { id: row.id, name: row.name, hint: row.token_hint, createdAt: row.created_at, lastUsedAt: row.last_used_at, revokedAt: row.revoked_at }
}

function insertToken(m: Mutation, agentId: string, name: string, createdBy: string): { row: TokenRow; plaintext: string } {
  const plaintext = generateSecret(AGENT_TOKEN_PREFIX, 40)
  const id = newId('tok')
  const hint = `${plaintext.slice(0, AGENT_TOKEN_PREFIX.length + 4)}…${plaintext.slice(-4)}`
  m.db
    .prepare('INSERT INTO agent_tokens (id, actor_id, name, token_hash, token_hint, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, agentId, name, sha256(plaintext), hint, createdBy, m.now)
  return { row: m.db.prepare('SELECT * FROM agent_tokens WHERE id = ?').get(id) as TokenRow, plaintext }
}

export interface AgentWithTokens extends PublicActor {
  tokens: AgentTokenInfo[]
}

export function listAgents(ctx: AppContext, actor: Actor): AgentWithTokens[] {
  requireOwner(actor)
  const agents = ctx.db
    .prepare(`SELECT id FROM actors WHERE workspace_id = ? AND kind = 'agent' ORDER BY display_name COLLATE NOCASE, id`)
    .all(ctx.workspaceId) as { id: string }[]
  const tokens = ctx.db.prepare('SELECT * FROM agent_tokens WHERE actor_id = ? ORDER BY created_at DESC, id')
  return agents.map(({ id }) => ({ ...getPublicActor(ctx.db, id), tokens: (tokens.all(id) as TokenRow[]).map(toTokenInfo) }))
}

export interface IssuedToken {
  agent: PublicActor
  token: AgentTokenInfo
  /** Returned exactly once; never persisted or retrievable again. */
  plaintextToken: string
  activityId: string | null
}

export function createAgent(ctx: AppContext, actor: Actor, input: z.infer<typeof createAgentInput>): IssuedToken {
  requireOwner(actor)
  const { value, activityId } = mutate(ctx, actor, (m) => {
    const id = newId('agt')
    m.db
      .prepare(`INSERT INTO actors (id, workspace_id, kind, display_name, is_owner, created_at, updated_at) VALUES (?, ?, 'agent', ?, 0, ?, ?)`)
      .run(id, m.workspaceId, input.displayName, m.now, m.now)
    m.record({ verb: 'agent.created', resource: { type: 'actor', id }, data: { displayName: input.displayName } })
    const issued = insertToken(m, id, input.tokenName, actor.id)
    m.record({ verb: 'agent_token.issued', resource: { type: 'actor', id }, data: { tokenId: issued.row.id, name: input.tokenName } })
    return { id, issued }
  })
  return { agent: getPublicActor(ctx.db, value.id), token: toTokenInfo(value.issued.row), plaintextToken: value.issued.plaintext, activityId }
}

function requireAgent(m: Mutation, agentId: string) {
  const row = findActorRow(m.db, agentId)
  if (!row || row.workspace_id !== m.workspaceId || row.kind !== 'agent') throw new AliceError('NOT_FOUND', 'Agent not found')
  if (row.deactivated_at) throw new AliceError('INVALID_STATE', 'Agent is deactivated')
  return row
}

export function issueAgentToken(ctx: AppContext, actor: Actor, agentId: string, name: string): IssuedToken {
  requireOwner(actor)
  const { value, activityId } = mutate(ctx, actor, (m) => {
    requireAgent(m, agentId)
    const issued = insertToken(m, agentId, name, actor.id)
    m.record({ verb: 'agent_token.issued', resource: { type: 'actor', id: agentId }, data: { tokenId: issued.row.id, name } })
    return issued
  })
  return { agent: getPublicActor(ctx.db, agentId), token: toTokenInfo(value.row), plaintextToken: value.plaintext, activityId }
}

function loadToken(m: Mutation, tokenId: string): TokenRow {
  const row = m.db
    .prepare('SELECT t.* FROM agent_tokens t JOIN actors a ON a.id = t.actor_id WHERE t.id = ? AND a.workspace_id = ?')
    .get(tokenId, m.workspaceId) as TokenRow | undefined
  if (!row) throw new AliceError('NOT_FOUND', 'Token not found')
  return row
}

export function rotateAgentToken(ctx: AppContext, actor: Actor, tokenId: string): IssuedToken {
  requireOwner(actor)
  const { value, activityId } = mutate(ctx, actor, (m) => {
    const old = loadToken(m, tokenId)
    if (old.revoked_at) throw new AliceError('INVALID_STATE', 'Token is already revoked')
    requireAgent(m, old.actor_id)
    const issued = insertToken(m, old.actor_id, old.name, actor.id)
    m.db.prepare('UPDATE agent_tokens SET revoked_at = ?, replaced_by = ? WHERE id = ?').run(m.now, issued.row.id, old.id)
    m.record({ verb: 'agent_token.rotated', resource: { type: 'actor', id: old.actor_id }, data: { fromTokenId: old.id, tokenId: issued.row.id, name: old.name } })
    return issued
  })
  return { agent: getPublicActor(ctx.db, value.row.actor_id), token: toTokenInfo(value.row), plaintextToken: value.plaintext, activityId }
}

export function revokeAgentToken(ctx: AppContext, actor: Actor, tokenId: string): AgentTokenInfo {
  requireOwner(actor)
  const { value } = mutate(ctx, actor, (m) => {
    const row = loadToken(m, tokenId)
    if (!row.revoked_at) {
      m.db.prepare('UPDATE agent_tokens SET revoked_at = ? WHERE id = ?').run(m.now, tokenId)
      m.record({ verb: 'agent_token.revoked', resource: { type: 'actor', id: row.actor_id }, data: { tokenId, name: row.name } })
    }
    return tokenId
  })
  return toTokenInfo(ctx.db.prepare('SELECT * FROM agent_tokens WHERE id = ?').get(value) as TokenRow)
}

export function deactivateAgent(ctx: AppContext, actor: Actor, agentId: string): PublicActor {
  requireOwner(actor)
  mutate(ctx, actor, (m) => {
    requireAgent(m, agentId)
    m.db.prepare('UPDATE actors SET deactivated_at = ?, updated_at = ? WHERE id = ?').run(m.now, m.now, agentId)
    m.db.prepare('UPDATE agent_tokens SET revoked_at = ? WHERE actor_id = ? AND revoked_at IS NULL').run(m.now, agentId)
    m.record({ verb: 'agent.deactivated', resource: { type: 'actor', id: agentId } })
  })
  return getPublicActor(ctx.db, agentId)
}

/** Resolves a bearer token to its agent and stamps last-used time. */
export function authenticateAgentToken(ctx: AppContext, token: string): Actor | null {
  if (!token.startsWith(AGENT_TOKEN_PREFIX)) return null
  const row = ctx.db.prepare('SELECT id, actor_id, revoked_at FROM agent_tokens WHERE token_hash = ?').get(sha256(token)) as
    | { id: string; actor_id: string; revoked_at: string | null }
    | undefined
  if (!row || row.revoked_at) return null
  const actorRow = findActorRow(ctx.db, row.actor_id)
  if (!actorRow || actorRow.deactivated_at || actorRow.workspace_id !== ctx.workspaceId || actorRow.kind !== 'agent') return null
  ctx.db.prepare('UPDATE agent_tokens SET last_used_at = ? WHERE id = ?').run(nowIso(), row.id)
  return toActor(actorRow)
}

/** Records a rejected owner-only attempt without any request payload. */
export function recordForbidden(ctx: AppContext, actor: Actor, operation: string): void {
  try {
    mutate(ctx, actor, (m) => {
      m.record({ verb: 'auth.forbidden', resource: { type: 'actor', id: actor.id }, data: { operation } })
    })
  } catch (err) {
    ctx.log?.warn({ err }, 'failed to record forbidden attempt')
  }
}
