import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp, tempDataDir, type RunningApp } from '../helpers/app'
import { HttpClient, OWNER, agentClient, bootstrapOwner, createAgent, inviteHuman } from '../helpers/client'

let app: RunningApp
let owner: HttpClient

beforeAll(async () => {
  app = await startApp()
})
afterAll(async () => {
  await app?.stop()
})

describe('owner bootstrap', () => {
  it('rejects a wrong bootstrap token, then bootstraps exactly once', async () => {
    const anon = new HttpClient(app.url)
    expect((await anon.get('/api/auth/state')).body).toEqual({ bootstrapped: false })

    const wrong = await anon.post('/api/auth/bootstrap', { bootstrapToken: 'nope', ...OWNER })
    expect(wrong.status).toBe(401)
    expect(wrong.body.error.code).toBe('UNAUTHENTICATED')

    owner = await bootstrapOwner(app)
    const me = await owner.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.actor).toMatchObject({ kind: 'human', isOwner: true, displayName: OWNER.displayName, username: 'owner' })

    const again = await new HttpClient(app.url).post('/api/auth/bootstrap', { bootstrapToken: app.env.ALICE_BOOTSTRAP_TOKEN, ...OWNER, username: 'second' })
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('INVALID_STATE')
    expect((await anon.get('/api/auth/state')).body).toEqual({ bootstrapped: true })
  })
})

describe('invitations', () => {
  it('creates a human from a single-use invite', async () => {
    const invite = await owner.post('/api/invites', { note: 'for bob' })
    expect(invite.status).toBe(201)
    expect(invite.body.url).toMatch(/\/invite\/alice_inv_/)
    const token = new URL(invite.body.url).pathname.split('/').pop()!

    const bob = new HttpClient(app.url)
    expect((await bob.post('/api/invites/check', { token })).body.valid).toBe(true)
    const accepted = await bob.post('/api/invites/accept', { token, username: 'bob', displayName: 'Bob Builder', password: 'bob-password-123' })
    expect(accepted.status).toBe(201)
    expect(accepted.body.actor).toMatchObject({ kind: 'human', isOwner: false, displayName: 'Bob Builder' })
    expect((await bob.get('/api/auth/me')).body.actor.username).toBe('bob')

    const reuse = await new HttpClient(app.url).post('/api/invites/accept', { token, username: 'mallory', displayName: 'M', password: 'mallory-password-1' })
    expect(reuse.status).toBe(401)
    expect(reuse.body.error.code).toBe('UNAUTHENTICATED')
    expect(JSON.stringify(reuse.body)).not.toContain('bob')

    const list = await owner.get('/api/invites')
    expect(list.body.items.find((i: any) => i.id === invite.body.invite.id).status).toBe('used')
  })

  it('denies revoked and expired invites without revealing details', async () => {
    const revoked = await owner.post('/api/invites', {})
    await owner.post(`/api/invites/${revoked.body.invite.id}/revoke`)
    const revokedToken = new URL(revoked.body.url).pathname.split('/').pop()!
    const r1 = await new HttpClient(app.url).post('/api/invites/accept', { token: revokedToken, username: 'carol', displayName: 'Carol', password: 'carol-password-1' })
    expect(r1.status).toBe(401)

    // บังคับให้หมดอายุโดยแก้ DB ตรง ๆ (ไม่มี API ย้อนเวลา)
    const expired = await owner.post('/api/invites', {})
    const db = new Database(path.join(app.dataDir, 'alice.db'))
    db.prepare('UPDATE invites SET expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', expired.body.invite.id)
    db.close()
    const expiredToken = new URL(expired.body.url).pathname.split('/').pop()!
    const r2 = await new HttpClient(app.url).post('/api/invites/accept', { token: expiredToken, username: 'dave', displayName: 'Dave', password: 'dave-password-12' })
    expect(r2.status).toBe(401)
    expect(r2.body.error.message).toBe(r1.body.error.message)
  })
})

describe('sessions', () => {
  it('logs in with a secure revocable session and logs out', async () => {
    const client = new HttpClient(app.url)
    const bad = await client.post('/api/auth/login', { username: 'owner', password: 'wrong-password' })
    expect(bad.status).toBe(401)
    const unknown = await client.post('/api/auth/login', { username: 'ghost', password: 'wrong-password' })
    expect(unknown.body.error.message).toBe(bad.body.error.message)

    const res = await fetch(`${app.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: OWNER.username, password: OWNER.password }),
    })
    expect(res.status).toBe(200)
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('alice_session='))!
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    expect(cookie).toMatch(/Path=\//)

    await client.post('/api/auth/login', { username: OWNER.username, password: OWNER.password })
    const savedCookie = client.cookie
    expect((await client.get('/api/auth/me')).status).toBe(200)

    // mutation ที่ไม่มี CSRF token ต้องถูกปฏิเสธ
    const noCsrf = await fetch(`${app.url}/api/invites`, { method: 'POST', headers: { cookie: savedCookie!, 'content-type': 'application/json' }, body: '{}' })
    expect(noCsrf.status).toBe(403)
    const crossOrigin = await fetch(`${app.url}/api/invites`, {
      method: 'POST',
      headers: { cookie: savedCookie!, 'content-type': 'application/json', 'x-csrf-token': client.csrfToken!, origin: 'https://evil.example' },
      body: '{}',
    })
    expect(crossOrigin.status).toBe(403)

    expect((await client.post('/api/auth/logout')).status).toBe(200)
    // cookie เก่าต้องใช้ไม่ได้แล้วฝั่ง server
    const replay = await fetch(`${app.url}/api/auth/me`, { headers: { cookie: savedCookie! } })
    expect(replay.status).toBe(401)
  })
})

describe('agent identities and tokens', () => {
  it('shows the plaintext token once and stores only a hash', async () => {
    const created = await owner.post('/api/agents', { displayName: 'Codex Builder' })
    expect(created.status).toBe(201)
    const token: string = created.body.plaintextToken
    expect(token).toMatch(/^alice_at_/)
    expect(created.body.agent).toMatchObject({ kind: 'agent', displayName: 'Codex Builder' })

    const listed = await owner.get('/api/agents')
    expect(JSON.stringify(listed.body)).not.toContain(token)
    expect(listed.body.items[0].tokens[0].hint).toBeTruthy()

    const db = new Database(path.join(app.dataDir, 'alice.db'), { readonly: true })
    const dump = JSON.stringify(db.prepare('SELECT * FROM agent_tokens').all())
    db.close()
    expect(dump).not.toContain(token)
    expect(app.output()).not.toContain(token)
  })

  it('denies rotated and revoked tokens, accepts the current one and stamps last-used', async () => {
    const agent = await createAgent(owner, 'Claude Reviewer')
    const before = agentClient(app, agent)
    const me = await before.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.actor).toMatchObject({ id: agent.id, kind: 'agent' })

    const rotated = await owner.post(`/api/agent-tokens/${agent.tokenId}/rotate`)
    expect(rotated.status).toBe(200)
    expect((await before.get('/api/auth/me')).status).toBe(401)

    const current = agentClient(app, { ...agent, token: rotated.body.plaintextToken, tokenId: rotated.body.token.id })
    expect((await current.get('/api/auth/me')).status).toBe(200)
    const tokens = (await owner.get('/api/agents')).body.items.find((a: any) => a.id === agent.id).tokens
    expect(tokens.find((t: any) => t.id === rotated.body.token.id).lastUsedAt).toBeTruthy()
    expect(tokens.find((t: any) => t.id === agent.tokenId).revokedAt).toBeTruthy()

    await owner.post(`/api/agent-tokens/${rotated.body.token.id}/revoke`)
    const denied = await current.get('/api/auth/me')
    expect(denied.status).toBe(401)
    expect(JSON.stringify(denied.body)).not.toContain('alice_at_')
  })
})

describe('owner-only operations', () => {
  it('rejects non-owner humans and agents and records the attempt', async () => {
    const carol = await inviteHuman(owner, 'carol2', 'Carol')
    const attempt = await carol.post('/api/agents', { displayName: 'Rogue' })
    expect(attempt.status).toBe(403)
    expect(attempt.body.error.code).toBe('FORBIDDEN')
    expect((await carol.post('/api/invites', {})).status).toBe(403)
    expect((await carol.get('/api/agents')).status).toBe(403)

    const agent = await createAgent(owner, 'Curious Agent')
    expect((await agentClient(app, agent).post('/api/invites', {})).status).toBe(403)

    const db = new Database(path.join(app.dataDir, 'alice.db'), { readonly: true })
    const events = db.prepare(`SELECT verb, actor_id, data FROM activity_events WHERE verb = 'auth.forbidden'`).all() as any[]
    db.close()
    expect(events.length).toBeGreaterThanOrEqual(3)
    expect(events.some((e) => e.data.includes('POST /api/agents'))).toBe(true)
  })

  it('lists all members for any authenticated actor', async () => {
    const res = await owner.get('/api/actors')
    const kinds = new Set(res.body.items.map((a: any) => a.kind))
    expect(kinds).toEqual(new Set(['human', 'agent']))
    expect((await new HttpClient(app.url).get('/api/actors')).status).toBe(401)
  })
})

describe('bootstrap token file', () => {
  it('writes a private bootstrap token file when no env token is set, and removes it after setup', async () => {
    const dataDir = tempDataDir('boot')
    const fresh = await startApp({ dataDir, env: { ALICE_BOOTSTRAP_TOKEN: undefined } })
    try {
      const file = path.join(dataDir, 'bootstrap-token')
      expect(fs.existsSync(file)).toBe(true)
      expect(fs.statSync(file).mode & 0o077).toBe(0)
      const token = fs.readFileSync(file, 'utf8').trim()
      expect(fresh.output()).not.toContain(token)
      const client = new HttpClient(fresh.url)
      expect((await client.post('/api/auth/bootstrap', { bootstrapToken: token, ...OWNER })).status).toBe(201)
      expect(fs.existsSync(file)).toBe(false)
    } finally {
      await fresh.stop()
    }
  })
})

describe('authentication rate limiting', () => {
  it('limits repeated login attempts with a stable error code', async () => {
    const limited = await startApp({ env: { ALICE_AUTH_RATE_LIMIT: '3' } })
    try {
      const client = new HttpClient(limited.url)
      const statuses: number[] = []
      for (let i = 0; i < 5; i++) statuses.push((await client.post('/api/auth/login', { username: 'x', password: 'wrong-password' })).status)
      expect(statuses.slice(0, 3)).toEqual([401, 401, 401])
      const last = await client.post('/api/auth/login', { username: 'x', password: 'wrong-password' })
      expect(last.status).toBe(429)
      expect(last.body.error.code).toBe('RATE_LIMITED')
    } finally {
      await limited.stop()
    }
  })
})
