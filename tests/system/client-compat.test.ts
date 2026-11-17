import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AliceClient, compatibilityOf, type Transport } from '../../src/client'
import { ERROR_CODES } from '../../src/shared/errors'
import { CLIENT_API_MIN_VERSION, CLIENT_API_VERSION } from '../../src/shared/version'
import { startApp, type RunningApp } from '../helpers/app'
import { HttpClient, bootstrapOwner, deviceLogin } from '../helpers/client'
import { openClientEvents } from '../helpers/sse'

const contract = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../fixtures/client-v1-contract.json'), 'utf8')) as Record<string, string[]>

function expectShape(value: unknown, shape: keyof typeof contract) {
  for (const key of contract[shape]) {
    let cur: any = value
    for (const part of key.split('.')) {
      expect(cur, `${shape}.${key}`).toBeTypeOf('object')
      expect(cur, `${shape}.${key}`).toHaveProperty(part)
      cur = cur[part]
    }
  }
}

describe('Client API v1 compatibility', () => {
  let app: RunningApp
  let owner: HttpClient
  beforeAll(async () => {
    app = await startApp()
    owner = await bootstrapOwner(app)
  })
  afterAll(async () => {
    await app?.stop()
  })

  it('still serves every field and code released v1 clients depend on', async () => {
    const V1 = '/client/v1'
    expectShape((await new HttpClient(app.url).get(`${V1}/info`)).body, 'info')
    expectShape((await owner.post(`${V1}/tasks`, { title: '' })).body, 'error')
    const project = (await owner.post(`${V1}/projects`, { name: 'Contract' })).body.project
    expectShape(project, 'project')
    const task = (await owner.post(`${V1}/tasks`, { title: 'Contract task', projectId: project.id })).body.task
    expectShape(task, 'task')
    const list = (await owner.get(`${V1}/tasks?limit=1`)).body
    expectShape(list, 'page')
    expectShape(list.items[0], 'task')
    expectShape((await owner.post(`${V1}/tasks/${task.id}/comments`, { body: 'hi' })).body.comment, 'comment')
    const doc = (await owner.post(`${V1}/documents`, { title: 'Contract doc', body: 'v1' })).body.document
    expectShape(doc, 'document')
    await owner.patch(`${V1}/documents/${doc.id}`, { body: 'v2' })
    expectShape((await owner.get(`${V1}/documents/${doc.id}/revisions`)).body.items[0], 'revision')
    expectShape((await owner.get(`${V1}/activity?limit=1`)).body.items[0], 'activity')
    expectShape((await owner.get(`${V1}/tasks/${task.id}/relations`)).body, 'relations')

    const anon = new HttpClient(app.url)
    const start = (await anon.post(`${V1}/device/authorize`, { clientKind: 'cli', clientName: 'Old CLI', deviceName: 'old', clientVersion: '0.2.0' })).body
    expectShape(start, 'deviceAuthorization')
    await owner.post(`${V1}/device/approve`, { userCode: start.userCode })
    const creds = (await anon.post(`${V1}/device/token`, { deviceCode: start.deviceCode })).body
    expectShape(creds, 'credentials')
    const bearer = new HttpClient(app.url)
    bearer.bearer = creds.accessToken
    expectShape((await bearer.get(`${V1}/client-sessions`)).body.items[0], 'session')

    const stream = await openClientEvents(bearer)
    await owner.patch(`${V1}/tasks/${task.id}`, { title: 'Contract task 2' })
    const ev = await stream.waitFor((e) => e.event === 'invalidate' && e.data.id === task.id)
    expectShape(ev.data, 'event')
    stream.close()

    for (const code of contract.errorCodes) expect(ERROR_CODES).toContain(code)
  })

  it('accepts the oldest supported protocol and explains anything outside the range', async () => {
    expect(CLIENT_API_MIN_VERSION).toBe(1)
    const oldest = await owner.request('GET', '/client/v1/tasks', undefined, { 'alice-client-api': String(CLIENT_API_MIN_VERSION) })
    expect(oldest.status).toBe(200)
    const newer = await owner.request('GET', '/client/v1/tasks', undefined, { 'alice-client-api': String(CLIENT_API_VERSION + 1) })
    expect(newer.body.error).toMatchObject({ code: 'CLIENT_INCOMPATIBLE', details: { upgrade: 'server' } })

    // client รุ่นปัจจุบันกับ server ที่รองรับแค่ v1 (สัญญาเก่าที่สุดที่ยังรองรับ)
    const oldestServer = { product: 'alice' as const, name: 'Alice', serverVersion: '0.2.0', publicUrl: '', clientApi: { current: 1, minimum: 1, prefix: '/client/v1' }, capabilities: [], events: { retentionHours: 24, maxReplay: 1000 } }
    expect(compatibilityOf(oldestServer).compatible).toBe(true)
    const transport: Transport = { request: async () => ({ status: 200, data: oldestServer }), subscribe: () => () => {} }
    expect((await new AliceClient(transport).info()).clientApi.minimum).toBe(1)
  })

  it('keeps the legacy internal routes working during the compatibility window', async () => {
    const legacy = await owner.post('/api/tasks', { title: 'Still via /api' })
    expect(legacy.status).toBe(201)
    // คำเตือน deprecation บอกเส้นทางแทนและ release ที่จะถอดออก
    expect(legacy.headers.get('deprecation')).toBe('true')
    expect(legacy.headers.get('link')).toBe('</client/v1/tasks>; rel="successor-version"')
    expect(legacy.headers.get('alice-removal')).toBe('0.4.0')
    expect((await owner.get('/client/v1/tasks')).headers.get('deprecation')).toBeNull()
    expect((await owner.get(`/client/v1/tasks/${legacy.body.task.id}`)).body.task.title).toBe('Still via /api')
    const login = await deviceLogin(app, owner)
    expect((await login.client.get('/api/tasks')).status).toBe(401) // native credentials are Client-API-only
  })
})
