import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { HttpClient, agentClient, bootstrapOwner, createAgent, deviceLogin, inviteHuman } from '../helpers/client'
import { activityFor, inspectDb } from '../helpers/db'
import { openClientEvents } from '../helpers/sse'

const V1 = '/client/v1'
const META = { clientKind: 'desktop', clientName: 'Alice Desktop', deviceName: 'Mia’s MacBook', clientVersion: '0.2.0' }

describe('device authorization and client sessions', () => {
  let app: RunningApp
  let owner: HttpClient
  let member: HttpClient
  const secrets: string[] = []

  beforeAll(async () => {
    app = await startApp({ env: { ALICE_LOG_REQUESTS: 'true' } })
    owner = await bootstrapOwner(app)
    member = await inviteHuman(owner, 'mia', 'Mia Member')
  })
  afterAll(async () => {
    await app?.stop()
  })

  it('starts a flow without revealing user or workspace data', async () => {
    const anon = new HttpClient(app.url)
    const res = await anon.post(`${V1}/device/authorize`, META)
    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      deviceCode: expect.stringMatching(/^alice_dc_/),
      userCode: expect.stringMatching(/^[A-Z]{4}-[A-Z]{4}$/),
      verificationUri: `${app.url}/device`,
      verificationUriComplete: `${app.url}/device?code=${res.body.userCode}`,
      expiresIn: 600,
      interval: 5,
    })
    secrets.push(res.body.deviceCode)
    expect((await anon.post(`${V1}/device/authorize`, { ...META, clientKind: 'browser' })).status).toBe(400)
  })

  it('reports pending, slows down fast pollers, then exchanges exactly once after approval', async () => {
    const anon = new HttpClient(app.url)
    const start = (await anon.post(`${V1}/device/authorize`, META)).body
    secrets.push(start.deviceCode)

    const pending = await anon.post(`${V1}/device/token`, { deviceCode: start.deviceCode })
    expect(pending.status).toBe(428)
    expect(pending.body.error.code).toBe('DEVICE_AUTHORIZATION_PENDING')
    const fast = await anon.post(`${V1}/device/token`, { deviceCode: start.deviceCode })
    expect(fast.status).toBe(429)
    expect(fast.body.error).toMatchObject({ code: 'DEVICE_SLOW_DOWN', details: { interval: 10 } })

    // หน้าอนุมัติต้อง sign in ในเว็บก่อน
    expect((await anon.post(`${V1}/device/lookup`, { userCode: start.userCode })).status).toBe(401)
    const lookup = await member.post(`${V1}/device/lookup`, { userCode: start.userCode.toLowerCase().replace('-', ' ') })
    expect(lookup.status).toBe(200)
    expect(lookup.body.request).toMatchObject({ clientKind: 'desktop', clientName: 'Alice Desktop', deviceName: 'Mia’s MacBook', clientVersion: '0.2.0', status: 'pending' })

    const approved = await member.post(`${V1}/device/approve`, { userCode: start.userCode })
    expect(approved.status).toBe(200)
    expect(approved.body.session).toMatchObject({ clientKind: 'desktop', actor: { displayName: 'Mia Member', kind: 'human' } })
    expect((await member.post(`${V1}/device/approve`, { userCode: start.userCode })).body.error.code).toBe('DEVICE_CODE_EXPIRED')

    const exchanged = await anon.post(`${V1}/device/token`, { deviceCode: start.deviceCode })
    expect(exchanged.status).toBe(200)
    expect(exchanged.body).toMatchObject({
      accessToken: expect.stringMatching(/^alice_ca_/),
      refreshToken: expect.stringMatching(/^alice_cr_/),
      actor: { displayName: 'Mia Member', kind: 'human' },
      session: { id: approved.body.session.id, current: true },
    })
    secrets.push(exchanged.body.accessToken, exchanged.body.refreshToken)
    const reused = await anon.post(`${V1}/device/token`, { deviceCode: start.deviceCode })
    expect(reused.status).toBe(410)
    expect(reused.body.error.code).toBe('DEVICE_CODE_EXPIRED')
  })

  it('handles denial and expiry with stable safe errors', async () => {
    const anon = new HttpClient(app.url)
    const denied = (await anon.post(`${V1}/device/authorize`, META)).body
    expect((await member.post(`${V1}/device/deny`, { userCode: denied.userCode })).status).toBe(200)
    const poll = await anon.post(`${V1}/device/token`, { deviceCode: denied.deviceCode })
    expect(poll.status).toBe(403)
    expect(poll.body.error.code).toBe('DEVICE_ACCESS_DENIED')

    const stale = (await anon.post(`${V1}/device/authorize`, META)).body
    const db = new Database(path.join(app.dataDir, 'alice.db'))
    db.prepare(`UPDATE device_authorizations SET expires_at = '2000-01-01T00:00:00.000Z' WHERE status = 'pending'`).run()
    db.close()
    expect((await member.post(`${V1}/device/lookup`, { userCode: stale.userCode })).body.error.code).toBe('DEVICE_CODE_EXPIRED')
    expect((await anon.post(`${V1}/device/token`, { deviceCode: stale.deviceCode })).status).toBe(410)
    expect((await anon.post(`${V1}/device/token`, { deviceCode: 'alice_dc_made-up' })).status).toBe(410)
  })

  it('attributes bearer mutations to the approving human and skips cookie CSRF', async () => {
    const login = await deviceLogin(app, member, { clientName: 'Alice CLI', deviceName: 'mia-workstation' })
    secrets.push(login.accessToken, login.refreshToken, login.deviceCode)
    const me = await login.client.get(`${V1}/auth/me`)
    expect(me.body).toMatchObject({ actor: { displayName: 'Mia Member', kind: 'human' }, via: 'client', csrfToken: null })

    const created = await login.client.request('POST', `${V1}/tasks`, { title: 'From the terminal' }, { 'alice-client': 'alice-cli/0.2.0' })
    expect(created.status).toBe(201)
    expect(created.body.task.createdBy).toMatchObject({ kind: 'human', displayName: 'Mia Member' })
    expect(activityFor(app, created.body.task.id)[0].actor_id).toBe(me.body.actor.id)

    // access credential ใช้ได้กับ Client API เท่านั้น ไม่ใช่ API เดิมหรือ MCP
    expect((await login.client.get('/api/tasks')).status).toBe(401)
    const mcp = await fetch(`${app.url}/mcp/v1`, { method: 'POST', headers: { authorization: `Bearer ${login.accessToken}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' })
    expect(mcp.status).toBe(401)

    // client session ใช้อนุมัติ device อื่นไม่ได้
    const another = (await new HttpClient(app.url).post(`${V1}/device/authorize`, META)).body
    const viaBearer = await login.client.post(`${V1}/device/approve`, { userCode: another.userCode })
    expect(viaBearer.status).toBe(403)
  })

  it('rotates refresh credentials and revokes the session on replay', async () => {
    const login = await deviceLogin(app, member)
    const anon = new HttpClient(app.url)
    const rotated = await anon.post(`${V1}/auth/refresh`, { refreshToken: login.refreshToken })
    expect(rotated.status).toBe(200)
    expect(rotated.body.refreshToken).not.toBe(login.refreshToken)
    expect(rotated.body.accessToken).not.toBe(login.accessToken)
    secrets.push(login.refreshToken, rotated.body.refreshToken, rotated.body.accessToken)

    expect((await login.client.get(`${V1}/tasks`)).status).toBe(401)
    const fresh = new HttpClient(app.url)
    fresh.bearer = rotated.body.accessToken
    expect((await fresh.get(`${V1}/tasks`)).status).toBe(200)

    const replay = await anon.post(`${V1}/auth/refresh`, { refreshToken: login.refreshToken })
    expect(replay.status).toBe(401)
    expect(replay.body.error.message).toContain('already used')
    // replay ทำให้ทั้ง session ถูก revoke รวมถึง credential ใหม่
    expect((await fresh.get(`${V1}/tasks`)).status).toBe(401)
    expect((await anon.post(`${V1}/auth/refresh`, { refreshToken: rotated.body.refreshToken })).status).toBe(401)
    const listed = (await member.get(`${V1}/client-sessions?include=all`)).body.items.find((s: { id: string }) => s.id === login.sessionId)
    expect(listed).toMatchObject({ revokeReason: 'refresh_reuse_detected', revokedAt: expect.any(String) })
  })

  it('lists sessions per human and revokes one without affecting others', async () => {
    const laptop = await deviceLogin(app, member, { deviceName: 'laptop' })
    const desktop = await deviceLogin(app, member, { clientKind: 'desktop', clientName: 'Alice Desktop', deviceName: 'desk' })
    const ownerCli = await deviceLogin(app, owner, { deviceName: 'owner-box' })

    const mine = (await member.get(`${V1}/client-sessions`)).body.items
    expect(mine.every((s: { actor: { displayName: string } }) => s.actor.displayName === 'Mia Member')).toBe(true)
    expect(mine.map((s: { id: string }) => s.id)).toEqual(expect.arrayContaining([laptop.sessionId, desktop.sessionId]))
    const all = (await owner.get(`${V1}/client-sessions`)).body.items.map((s: { id: string }) => s.id)
    expect(all).toEqual(expect.arrayContaining([laptop.sessionId, desktop.sessionId, ownerCli.sessionId]))
    expect((await laptop.client.get(`${V1}/client-sessions`)).body.items.find((s: { current: boolean }) => s.current).id).toBe(laptop.sessionId)

    expect((await member.post(`${V1}/client-sessions/${ownerCli.sessionId}/revoke`)).status).toBe(403)

    const stream = await openClientEvents(laptop.client)
    const revoked = await owner.post(`${V1}/client-sessions/${laptop.sessionId}/revoke`)
    expect(revoked.body.session).toMatchObject({ revokeReason: 'revoked_by_owner' })
    await stream.waitFor((e) => e.event === 'unauthorized')
    await expect.poll(() => stream.ended()).toBe(true)
    expect((await laptop.client.get(`${V1}/tasks`)).status).toBe(401)
    expect((await new HttpClient(app.url).post(`${V1}/auth/refresh`, { refreshToken: laptop.refreshToken })).status).toBe(401)
    await expect(openClientEvents(laptop.client)).rejects.toMatchObject({ status: 401 })

    expect((await desktop.client.get(`${V1}/tasks`)).status).toBe(200)
    expect((await ownerCli.client.get(`${V1}/tasks`)).status).toBe(200)

    // sign out ด้วย bearer จบเฉพาะ session นั้น
    expect((await desktop.client.post(`${V1}/auth/logout`)).status).toBe(200)
    expect((await desktop.client.get(`${V1}/tasks`)).status).toBe(401)
    expect((await member.get(`${V1}/auth/me`)).status).toBe(200)
    expect((await ownerCli.client.get(`${V1}/tasks`)).status).toBe(200)

    // revoke ด้วย refresh credential อย่างเดียว ไม่บอกว่า credential ถูกหรือผิด
    expect((await new HttpClient(app.url).post(`${V1}/auth/revoke`, { refreshToken: 'alice_cr_unknown' })).body).toEqual({ ok: true })
    expect((await new HttpClient(app.url).post(`${V1}/auth/revoke`, { refreshToken: ownerCli.refreshToken })).body).toEqual({ ok: true })
    expect((await ownerCli.client.get(`${V1}/tasks`)).status).toBe(401)
    secrets.push(laptop.accessToken, laptop.refreshToken, desktop.accessToken, ownerCli.refreshToken)
  })

  it('records approvals and revocations as attributed activity and never exposes secrets', async () => {
    const events = (await owner.get(`${V1}/activity?limit=200`)).body.items as Array<{ verb: string; actor: { displayName: string } | null; data: unknown }>
    const approvals = events.filter((e) => e.verb === 'client_session.approved')
    expect(approvals.length).toBeGreaterThan(0)
    expect(approvals.some((e) => e.actor?.displayName === 'Mia Member')).toBe(true)
    expect(events.some((e) => e.verb === 'client_session.revoked')).toBe(true)
    expect(events.some((e) => e.verb === 'device.denied')).toBe(true)

    const output = app.output()
    expect(output).toContain('client_session.issued')
    expect(output).toMatch(/"clientSession":"cls_/)
    expect(output).toContain('"client":"alice-cli/0.2.0"')
    const everything = output + JSON.stringify(events) + inspectDb(app, (db) => JSON.stringify(db.prepare('SELECT * FROM client_sessions').all()))
    for (const secret of secrets) expect(everything).not.toContain(secret)
  })
})

describe('device authorization rate limits', () => {
  it('limits device endpoints separately from ordinary Client API traffic', async () => {
    const app = await startApp({ env: { ALICE_DEVICE_RATE_LIMIT: '3' } })
    try {
      const owner = await bootstrapOwner(app)
      const agent = await createAgent(owner, 'Bot')
      const anon = new HttpClient(app.url)
      const statuses: number[] = []
      for (let i = 0; i < 4; i++) statuses.push((await anon.post(`${V1}/device/authorize`, META)).status)
      expect(statuses).toEqual([201, 201, 201, 429])
      expect((await anon.post(`${V1}/device/authorize`, META)).body.error.code).toBe('RATE_LIMITED')
      expect((await owner.get(`${V1}/tasks`)).status).toBe(200)
      expect((await agentClient(app, agent).get(`${V1}/tasks`)).status).toBe(401)
    } finally {
      await app.stop()
    }
  })
})
