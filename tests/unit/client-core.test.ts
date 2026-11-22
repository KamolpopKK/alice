import { describe, expect, it } from 'vitest'
import { AliceClient, AliceClientError, classifyError, compatibilityOf, createSseParser, dispatchEventFrame, type Transport } from '../../src/client'
import type { ServerInfo } from '../../src/shared/contracts'

const info = (current: number, minimum: number): ServerInfo => ({
  product: 'alice',
  name: 'Alice',
  serverVersion: '9.9.9',
  publicUrl: 'https://alice.example',
  clientApi: { current, minimum, prefix: `/client/v${current}` },
  capabilities: [],
  events: { retentionHours: 24, maxReplay: 1000 },
})

describe('client compatibility', () => {
  it('accepts servers whose range includes this client', () => {
    expect(compatibilityOf(info(1, 1)).compatible).toBe(true)
    expect(compatibilityOf(info(3, 1)).compatible).toBe(true)
  })
  it('names which side must upgrade', () => {
    expect(compatibilityOf(info(3, 2))).toMatchObject({ compatible: false, upgrade: 'client' })
  })
})

describe('error classes', () => {
  it('maps stable codes onto recovery classes', () => {
    expect(classifyError(new AliceClientError(400, 'VALIDATION_ERROR', 'x'))).toBe('usage')
    expect(classifyError(new AliceClientError(401, 'UNAUTHENTICATED', 'x'))).toBe('auth')
    expect(classifyError(new AliceClientError(404, 'NOT_FOUND', 'x'))).toBe('not_found')
    expect(classifyError(new AliceClientError(426, 'CLIENT_INCOMPATIBLE', 'x'))).toBe('compatibility')
    expect(classifyError(new AliceClientError(0, 'NETWORK_ERROR', 'x'))).toBe('network')
    expect(classifyError(new Error('boom'))).toBe('internal')
  })
})

describe('retry policy', () => {
  function flaky(failures: number) {
    const seen: Array<Record<string, string> | undefined> = []
    const transport: Transport = {
      async request(req) {
        seen.push(req.headers)
        if (seen.length <= failures) throw new AliceClientError(0, 'NETWORK_ERROR', 'down')
        return { status: 201, data: { ok: true } }
      },
      subscribe: () => () => {},
    }
    return { transport, seen }
  }

  it('retries idempotent mutations with the same key', async () => {
    const { transport, seen } = flaky(2)
    await new AliceClient(transport).tasks.create({ title: 'x' })
    expect(seen).toHaveLength(3)
    const keys = new Set(seen.map((h) => h?.['idempotency-key']))
    expect(keys.size).toBe(1)
    expect([...keys][0]).toMatch(/^[A-Za-z0-9-]{8,}$/)
    expect(seen[0]?.['alice-client-api']).toBe('1')
  })

  it('lets one save attempt reuse its own key across calls, and retries it', async () => {
    const { transport, seen } = flaky(1)
    const client = new AliceClient(transport)
    await client.documents.create({ title: 'Doc', body: 'x' }, { idempotencyKey: 'attempt-1234' })
    await client.documents.create({ title: 'Doc', body: 'x' }, { idempotencyKey: 'attempt-1234' })
    await client.documents.link('doc_1', { taskId: 'tsk_1' }, { idempotencyKey: 'link-attempt-1' })
    expect(seen.map((h) => h?.['idempotency-key'])).toEqual(['attempt-1234', 'attempt-1234', 'attempt-1234', 'link-attempt-1'])
    // ไม่ส่ง key เอง: ยังได้ key ใหม่ทุกครั้งเหมือนเดิม
    await client.documents.create({ title: 'Doc', body: 'x' })
    await client.documents.create({ title: 'Doc', body: 'x' })
    expect(new Set(seen.slice(4).map((h) => h?.['idempotency-key'])).size).toBe(2)
  })

  it('never retries a mutation without an idempotency key', async () => {
    const { transport, seen } = flaky(1)
    await expect(new AliceClient(transport).tasks.update('tsk_1', { title: 'y' })).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    expect(seen).toHaveLength(1)
  })
})

describe('SSE parsing', () => {
  it('splits frames across chunks and dispatches typed events', () => {
    const got: string[] = []
    const handlers = {
      onReady: (p: number) => got.push(`ready:${p}`),
      onInvalidate: (e: { kind: string; position: number }) => got.push(`inv:${e.kind}:${e.position}`),
      onReset: (r: { reason: string }) => got.push(`reset:${r.reason}`),
      onUnauthorized: () => got.push('unauth'),
      onDisconnect: () => got.push('disc'),
    }
    const feed = createSseParser((frame) => dispatchEventFrame(frame, handlers as never))
    feed('retry: 3000\n\nid: 4\nevent: ready\ndata: {"position":4}\n\n: keep-alive\n\nid: 5\nevent: inval')
    feed('idate\ndata: {"position":5,"kind":"task","id":"tsk_1","activityId":null,"mutation":"task.updated"}\n\n')
    feed('event: reset\r\ndata: {"position":9,"reason":"position_expired"}\r\n\r\nevent: unauthorized\ndata: {}\n\n')
    expect(got).toEqual(['ready:4', 'inv:task:5', 'reset:position_expired', 'unauth'])
  })
})
