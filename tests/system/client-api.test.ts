import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { HttpClient, agentClient, bootstrapOwner, createAgent, inviteHuman, type AgentHandle } from '../helpers/client'
import { activityFor } from '../helpers/db'
import { connectMcp } from '../helpers/mcp'
import { openClientEvents } from '../helpers/sse'

const V1 = '/client/v1'

describe('Client API v1', () => {
  let app: RunningApp
  let owner: HttpClient
  let member: HttpClient
  let agent: AgentHandle

  beforeAll(async () => {
    app = await startApp()
    owner = await bootstrapOwner(app)
    member = await inviteHuman(owner, 'mia', 'Mia Member')
    agent = await createAgent(owner, 'Builder Bot')
  })
  afterAll(async () => {
    await app?.stop()
  })

  it('describes the server and protocol range without workspace data or credentials', async () => {
    const anon = new HttpClient(app.url)
    const res = await anon.get(`${V1}/info`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      product: 'alice',
      serverVersion: expect.any(String),
      clientApi: { current: 1, minimum: 1, prefix: V1 },
      capabilities: expect.arrayContaining(['tasks', 'idempotency', 'events.resume']),
    })
    const text = JSON.stringify(res.body)
    expect(text).not.toMatch(/prj_|tsk_|usr_|wsp_|owner|Olivia/)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('rejects unsupported client protocol versions with structured errors before mutating', async () => {
    const before = (await owner.get(`${V1}/projects?archived=all`)).body.items.length
    const tooNew = await owner.request('POST', `${V1}/projects`, { name: 'Should not exist' }, { 'alice-client-api': '99' })
    expect(tooNew.status).toBe(426)
    expect(tooNew.body.error).toMatchObject({ code: 'CLIENT_INCOMPATIBLE', details: { upgrade: 'server', current: 1, minimum: 1, clientApiVersion: 99 } })
    const tooOld = await owner.request('GET', `${V1}/projects`, undefined, { 'alice-client-api': '0' })
    expect(tooOld.status).toBe(426)
    expect(tooOld.body.error.details.upgrade).toBe('client')
    const ok = await owner.request('GET', `${V1}/projects`, undefined, { 'alice-client-api': '1' })
    expect(ok.status).toBe(200)
    expect((await owner.get(`${V1}/projects?archived=all`)).body.items.length).toBe(before)
  })

  it('keeps cookie sessions, CSRF and same-origin protection, and refuses agent tokens', async () => {
    expect((await new HttpClient(app.url).get(`${V1}/tasks`)).status).toBe(401)

    const noCsrf = new HttpClient(app.url)
    noCsrf.cookie = member.cookie
    const missing = await noCsrf.post(`${V1}/tasks`, { title: 'CSRF bypass' })
    expect(missing.status).toBe(403)
    expect(missing.body.error.code).toBe('FORBIDDEN')

    const crossOrigin = await member.request('POST', `${V1}/tasks`, { title: 'Cross origin' }, { origin: 'https://evil.example' })
    expect(crossOrigin.status).toBe(403)

    const bot = agentClient(app, agent)
    const agentAttempt = await bot.get(`${V1}/tasks`)
    expect(agentAttempt.status).toBe(401)
    expect(agentAttempt.body.error.code).toBe('UNAUTHENTICATED')

    const titles = (await owner.get(`/api/tasks?limit=200`)).body.items.map((t: { title: string }) => t.title)
    expect(titles).not.toContain('CSRF bypass')
    expect(titles).not.toContain('Cross origin')
  })

  it('delegates to the same domain behavior as the internal API, with human attribution', async () => {
    const created = await member.post(`${V1}/tasks`, { title: 'Write the client contract', priority: 'high' })
    expect(created.status).toBe(201)
    const id = created.body.task.id
    expect(created.body.task.createdBy).toMatchObject({ kind: 'human', displayName: 'Mia Member' })

    // ทรัพยากรเดียวกันอ่านได้จากทั้งสองเส้นทาง
    const viaLegacy = await owner.get(`/api/tasks/${id}`)
    expect(viaLegacy.body.task.title).toBe('Write the client contract')

    const invalid = await member.post(`${V1}/tasks`, { title: '' })
    const invalidLegacy = await member.post('/api/tasks', { title: '' })
    expect(invalid.status).toBe(400)
    expect(invalid.body).toEqual(invalidLegacy.body)

    const activity = activityFor(app, id)
    expect(activity.map((a) => a.verb)).toEqual(['task.created'])
    const me = (await member.get(`${V1}/auth/me`)).body.actor
    expect(activity[0].actor_id).toBe(me.id)
  })

  it('replays an idempotent mutation once and rejects a key reused for a different payload', async () => {
    const key = 'retry-create-0001'
    const first = await member.request('POST', `${V1}/tasks`, { title: 'Retried creation' }, { 'idempotency-key': key })
    expect(first.status).toBe(201)
    const again = await member.request('POST', `${V1}/tasks`, { title: 'Retried creation' }, { 'idempotency-key': key })
    expect(again.status).toBe(201)
    expect(again.headers.get('idempotent-replayed')).toBe('true')
    expect(again.body).toEqual(first.body)
    expect(activityFor(app, first.body.task.id)).toHaveLength(1)
    const sameTitle = (await member.get(`${V1}/tasks?q=${encodeURIComponent('Retried creation')}`)).body.items
    expect(sameTitle).toHaveLength(1)

    const changed = await member.request('POST', `${V1}/tasks`, { title: 'Different payload' }, { 'idempotency-key': key })
    expect(changed.status).toBe(409)
    expect(changed.body.error.code).toBe('IDEMPOTENCY_CONFLICT')

    // key ผูกกับ session: คนอื่นใช้ key เดียวกันได้โดยไม่ชนกัน
    const otherSession = await owner.request('POST', `${V1}/tasks`, { title: 'Owner task with same key' }, { 'idempotency-key': key })
    expect(otherSession.status).toBe(201)

    // completion ซ้ำด้วย key เดิมไม่สร้าง event ซ้ำ
    const completeKey = 'retry-complete-0001'
    const done1 = await member.request('POST', `${V1}/tasks/${first.body.task.id}/complete`, { summary: 'Shipped' }, { 'idempotency-key': completeKey })
    const done2 = await member.request('POST', `${V1}/tasks/${first.body.task.id}/complete`, { summary: 'Shipped' }, { 'idempotency-key': completeKey })
    expect(done1.status).toBe(200)
    expect(done2.body).toEqual(done1.body)
    expect(activityFor(app, first.body.task.id).filter((a) => a.verb === 'task.completed')).toHaveLength(1)

    // คำขอที่ล้มเหลวไม่ถูกจำ จึง retry ด้วย key เดิมได้
    const failKey = 'retry-after-failure'
    expect((await member.request('POST', `${V1}/tasks`, { title: '' }, { 'idempotency-key': failKey })).status).toBe(400)
    expect((await member.request('POST', `${V1}/tasks`, { title: 'Fixed title' }, { 'idempotency-key': failKey })).status).toBe(201)

    expect((await member.request('POST', `${V1}/tasks`, { title: 'Bad key' }, { 'idempotency-key': 'no spaces allowed' })).status).toBe(400)
  })

  it('streams positioned invalidations from humans and agents without canonical data', async () => {
    const stream = await openClientEvents(member)
    const ready = stream.events.find((e) => e.event === 'ready')!
    const start = ready.data.position as number
    expect(Number(ready.id)).toBe(start)

    const created = await owner.post(`${V1}/tasks`, { title: 'Live via client events', description: 'secret plan details' })
    const id = created.body.task.id
    const ev = await stream.waitFor((e) => e.event === 'invalidate' && e.data.kind === 'task' && e.data.id === id)
    expect(ev.data).toEqual({ position: expect.any(Number), activityId: created.body.activityId, kind: 'task', id, mutation: 'task.created' })
    expect(ev.data.position).toBeGreaterThan(start)
    expect(Number(ev.id)).toBe(ev.data.position)
    expect(JSON.stringify(stream.events)).not.toContain('secret plan details')

    const mcp = await connectMcp(app.url, agent.token)
    await mcp.ok('add_comment', { taskId: id, body: 'Agent was here' })
    await stream.waitFor((e) => e.event === 'invalidate' && e.data.id === id && e.data.mutation === 'comment.added')
    await mcp.close()

    const positions = stream.events.filter((e) => e.event === 'invalidate').map((e) => e.data.position)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    stream.close()
  })

  it('resumes from a valid position and signals reset for unknown positions', async () => {
    const first = await openClientEvents(member)
    const marker = (await owner.post(`${V1}/projects`, { name: 'Resume marker' })).body.project.id
    const seen = await first.waitFor((e) => e.event === 'invalidate' && e.data.id === marker)
    first.close()

    // ระหว่างหลุด มีการเปลี่ยนแปลงสองครั้ง
    const missedA = (await owner.post(`${V1}/tasks`, { title: 'Missed A' })).body.task.id
    const missedB = (await owner.post(`${V1}/tasks`, { title: 'Missed B' })).body.task.id

    const resumed = await openClientEvents(member, { lastEventId: seen.data.position })
    const replayed = resumed.events.filter((e) => e.event === 'invalidate').map((e) => e.data.id)
    expect(replayed).toContain(missedA)
    expect(replayed).toContain(missedB)
    expect(replayed).not.toContain(marker)
    expect(resumed.events.some((e) => e.event === 'reset')).toBe(false)
    resumed.close()

    const ahead = await openClientEvents(member, { after: 10_000_000 })
    const reset = ahead.events.find((e) => e.event === 'reset')!
    expect(reset.data).toMatchObject({ reason: 'position_ahead_of_server', position: expect.any(Number) })
    // หลัง reset stream ยังใช้งานต่อได้
    const later = (await owner.post(`${V1}/tasks`, { title: 'After reset' })).body.task.id
    await ahead.waitFor((e) => e.event === 'invalidate' && e.data.id === later)
    ahead.close()
  })
})

describe('Client API event retention', () => {
  it('sends an explicit reset when the resume position has expired', async () => {
    const app = await startApp()
    try {
      const owner = await bootstrapOwner(app)
      const stream = await openClientEvents(owner)
      const id = (await owner.post(`${V1}/tasks`, { title: 'Old news' })).body.task.id
      const ev = await stream.waitFor((e) => e.event === 'invalidate' && e.data.id === id)
      stream.close()
      await owner.post(`${V1}/tasks`, { title: 'Newer news' })

      // จำลองเวลาผ่านไปเกิน retention: ทำให้ event เก่าลง แล้ว restart (pruning ทำตอนเริ่ม)
      await app.stop()
      const db = new Database(path.join(app.dataDir, 'alice.db'))
      db.prepare(`UPDATE client_events SET created_at = '2000-01-01T00:00:00.000Z'`).run()
      db.close()
      const restarted = await startApp({ dataDir: app.dataDir, env: { ALICE_BOOTSTRAP_TOKEN: app.env.ALICE_BOOTSTRAP_TOKEN } })
      try {
        const again = new HttpClient(restarted.url)
        again.cookie = owner.cookie
        const resumed = await openClientEvents(again, { lastEventId: ev.data.position - 1 })
        const reset = resumed.events.find((e) => e.event === 'reset')!
        expect(reset.data.reason).toBe('position_expired')
        resumed.close()
      } finally {
        await restarted.stop()
      }
    } finally {
      await app.stop().catch(() => {})
    }
  })
})
