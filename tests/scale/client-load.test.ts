import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { HttpClient, bootstrapOwner } from '../helpers/client'
import { openClientEvents } from '../helpers/sse'

/** Budgets for the additional Desktop and CLI client load (documented in docs/release.md). */
export const CLIENT_BUDGETS = {
  sessions: 100,
  streams: 100,
  'bearer list p95 (100 concurrent clients)': 500,
  'refresh p95': 150,
  'invalidation fan-out to all streams': 1500,
  'server RSS MB': 512,
}

let app: RunningApp
let owner: HttpClient
const sessions: Array<{ client: HttpClient; refresh: string }> = []
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)]

describe('Client API under Desktop/CLI session load', () => {
  beforeAll(async () => {
    app = await startApp({ env: { ALICE_DEVICE_RATE_LIMIT: '100000', ALICE_AUTH_RATE_LIMIT: '1000' } })
    owner = await bootstrapOwner(app)
    for (let i = 0; i < 300; i++) await owner.post('/client/v1/tasks', { title: `Load task ${i}`, status: i % 3 === 0 ? 'ready' : 'backlog' })
    for (let i = 0; i < CLIENT_BUDGETS.sessions; i++) {
      const anon = new HttpClient(app.url)
      const start = (await anon.post('/client/v1/device/authorize', { clientKind: i % 2 ? 'cli' : 'desktop', clientName: 'Load', deviceName: `device-${i}`, clientVersion: '0.2.0' })).body
      await owner.post('/client/v1/device/approve', { userCode: start.userCode })
      const creds = (await anon.post('/client/v1/device/token', { deviceCode: start.deviceCode })).body
      const client = new HttpClient(app.url)
      client.bearer = creds.accessToken
      sessions.push({ client, refresh: creds.refreshToken })
    }
  })
  afterAll(async () => {
    await app?.stop()
  })

  it('serves 100 concurrent bearer clients within budget', async () => {
    const times: number[] = []
    for (let round = 0; round < 5; round++) {
      await Promise.all(
        sessions.map(async ({ client }) => {
          const t = performance.now()
          const res = await client.get('/client/v1/tasks?limit=50&status=ready')
          times.push(performance.now() - t)
          expect(res.status).toBe(200)
        }),
      )
    }
    const value = p95(times)
    console.log(`bearer list p95 ${value.toFixed(1)} ms over ${times.length} requests`)
    expect(value).toBeLessThan(CLIENT_BUDGETS['bearer list p95 (100 concurrent clients)'])
  })

  it('rotates refresh credentials quickly', async () => {
    const times: number[] = []
    const anon = new HttpClient(app.url)
    for (const s of sessions.slice(0, 50)) {
      const t = performance.now()
      const res = await anon.post('/client/v1/auth/refresh', { refreshToken: s.refresh })
      times.push(performance.now() - t)
      expect(res.status).toBe(200)
      s.refresh = res.body.refreshToken
      s.client.bearer = res.body.accessToken
    }
    console.log(`refresh p95 ${p95(times).toFixed(1)} ms`)
    expect(p95(times)).toBeLessThan(CLIENT_BUDGETS['refresh p95'])
  })

  it('fans one change out to 100 live streams and stays within memory', async () => {
    const streams = await Promise.all(sessions.map((s) => openClientEvents(s.client)))
    const t = performance.now()
    const id = (await owner.post('/client/v1/tasks', { title: 'Fan-out probe' })).body.task.id
    await Promise.all(streams.map((s) => s.waitFor((e) => e.event === 'invalidate' && e.data.id === id, 10_000)))
    const fanout = performance.now() - t
    console.log(`fan-out to ${streams.length} streams ${fanout.toFixed(1)} ms`)
    expect(fanout).toBeLessThan(CLIENT_BUDGETS['invalidation fan-out to all streams'])
    const rssMb = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(app.pid)]).toString().trim()) / 1024
    console.log(`server RSS ${rssMb.toFixed(0)} MB with ${streams.length} streams`)
    expect(rssMb).toBeLessThan(CLIENT_BUDGETS['server RSS MB'])
    streams.forEach((s) => s.close())
  })
})
