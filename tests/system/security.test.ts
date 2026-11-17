import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { HttpClient, OWNER, agentClient, bootstrapOwner, createAgent, inviteHuman, type AgentHandle } from '../helpers/client'
import { connectMcp } from '../helpers/mcp'

let app: RunningApp
let owner: HttpClient
let member: HttpClient
let agent: AgentHandle

beforeAll(async () => {
  app = await startApp({ env: { ALICE_MCP_RATE_LIMIT: '40', ALICE_LOG_REQUESTS: 'true' } })
  owner = await bootstrapOwner(app)
  member = await inviteHuman(owner, 'mallory', 'Mallory')
  agent = await createAgent(owner, 'Sec Agent')
})
afterAll(async () => app?.stop())

describe('security headers', () => {
  it('sends a strict CSP and hardening headers on pages and API responses', async () => {
    for (const p of ['/', '/api/auth/state']) {
      const res = await fetch(app.url + p)
      expect(res.headers.get('content-security-policy')).toContain("script-src 'self'")
      expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
      expect(res.headers.get('x-frame-options')).toBe('DENY')
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    }
    expect((await fetch(`${app.url}/api/auth/state`)).headers.get('cache-control')).toBe('no-store')
  })
})

describe('CSRF', () => {
  it('rejects cookie-authenticated mutations without the CSRF token or from another origin', async () => {
    const attempts: Array<{ headers: Record<string, string> }> = [
      { headers: { cookie: member.cookie!, 'content-type': 'application/json' } },
      { headers: { cookie: member.cookie!, 'content-type': 'application/json', 'x-csrf-token': 'guess' } },
      { headers: { cookie: member.cookie!, 'content-type': 'application/json', 'x-csrf-token': member.csrfToken!, origin: 'https://attacker.example' } },
      // simple form POST จากเว็บอื่น (ไม่มี custom header)
      { headers: { cookie: member.cookie!, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://attacker.example' } },
    ]
    for (const init of attempts) {
      const res = await fetch(`${app.url}/api/tasks`, { method: 'POST', ...init, body: init.headers['content-type'].includes('json') ? '{"title":"csrf"}' : 'title=csrf' })
      expect(res.status).toBe(403)
    }
    expect((await owner.get('/api/tasks?q=csrf')).body.items).toHaveLength(0)
  })
})

describe('input abuse', () => {
  it('rejects oversized bodies and fields with stable codes', async () => {
    const huge = await fetch(`${app.url}/api/tasks`, {
      method: 'POST',
      headers: { cookie: owner.cookie!, 'x-csrf-token': owner.csrfToken!, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x', description: 'y'.repeat(3 * 1024 * 1024) }),
    })
    expect(huge.status).toBe(413)
    expect((await huge.json()).error.code).toBe('PAYLOAD_TOO_LARGE')
    expect((await owner.post('/api/tasks', { title: 't'.repeat(301) })).body.error.code).toBe('VALIDATION_ERROR')
    expect((await owner.post('/api/tasks', { title: 'ok', description: 'd'.repeat(100_001) })).body.error.code).toBe('VALIDATION_ERROR')
    expect((await owner.post('/api/tasks', { title: 'ok', labels: Array.from({ length: 21 }, (_, i) => `l${i}`) })).body.error.code).toBe('VALIDATION_ERROR')
    expect((await owner.get(`/api/tasks?limit=100000`)).body.error.code).toBe('VALIDATION_ERROR')
    expect((await owner.get(`/api/search?q=${'a'.repeat(201)}`)).body.error.code).toBe('VALIDATION_ERROR')
    const malformed = await fetch(`${app.url}/api/tasks`, {
      method: 'POST',
      headers: { cookie: owner.cookie!, 'x-csrf-token': owner.csrfToken!, 'content-type': 'application/json' },
      body: '{"title": ',
    })
    expect(malformed.status).toBe(400)
    expect((await malformed.json()).error.code).toBe('VALIDATION_ERROR')
  })

  it('stores Markdown verbatim (rendering is escaped client-side) and never reflects it as HTML', async () => {
    const xss = '<script>alert(1)</script><img src=x onerror=alert(2)>[x](javascript:alert(3))'
    const res = await owner.post('/api/tasks', { title: 'XSS probe', description: xss })
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.body.task.description).toBe(xss)
  })
})

describe('rate limiting', () => {
  it('limits MCP requests per token', async () => {
    const mcp = await connectMcp(app.url, agent.token)
    let limited: unknown = null
    for (let i = 0; i < 60 && !limited; i++) {
      try {
        await mcp.client.listTools()
      } catch (err) {
        limited = err
      }
    }
    expect(String(limited)).toMatch(/429|RATE_LIMITED|Too many/i)
    await mcp.close().catch(() => {})
  })
})

describe('owner-only operations and protected invariants', () => {
  it('rejects every owner-only operation for members and agents', async () => {
    const someAgent = (await owner.get('/api/agents')).body.items[0]
    const tokenId = someAgent.tokens[0].id
    const invite = (await owner.post('/api/invites', {})).body.invite
    const ops: Array<[string, string, unknown?]> = [
      ['GET', '/api/invites'],
      ['POST', '/api/invites', {}],
      ['POST', `/api/invites/${invite.id}/revoke`, {}],
      ['GET', '/api/agents'],
      ['POST', '/api/agents', { displayName: 'x' }],
      ['POST', `/api/agents/${someAgent.id}/tokens`, { name: 'x' }],
      ['POST', `/api/agents/${someAgent.id}/deactivate`, {}],
      ['POST', `/api/agent-tokens/${tokenId}/rotate`, {}],
      ['POST', `/api/agent-tokens/${tokenId}/revoke`, {}],
    ]
    for (const client of [member, agentClient(app, agent)]) {
      for (const [method, url, body] of ops) {
        const res = await client.request(method, url, body)
        expect(res.status, `${method} ${url}`).toBe(403)
        expect(res.body.error.code).toBe('FORBIDDEN')
      }
    }
    // ไม่มีอะไรเปลี่ยน
    expect((await owner.get('/api/agents')).body.items.find((a: any) => a.id === someAgent.id).deactivatedAt).toBeNull()
  })

  it('keeps the system project protected and identity bootstrap single-use', async () => {
    const untitled = (await member.get('/api/projects')).body.items[0]
    expect(untitled.isSystem).toBe(true)
    expect((await member.patch(`/api/projects/${untitled.id}`, { name: 'Mine' })).body.error.code).toBe('PROTECTED_RESOURCE')
    expect((await member.post(`/api/projects/${untitled.id}/archive`)).body.error.code).toBe('PROTECTED_RESOURCE')
    const again = await new HttpClient(app.url).post('/api/auth/bootstrap', { bootstrapToken: app.env.ALICE_BOOTSTRAP_TOKEN, ...OWNER, username: 'evil' })
    expect(again.body.error.code).toBe('INVALID_STATE')
  })
})

describe('secret hygiene', () => {
  it('never writes passwords, tokens, cookies or invite links to logs', async () => {
    const invite = (await owner.post('/api/invites', {})).body.url as string
    await fetch(invite) // เปิดลิงก์เชิญ: log ต้องไม่มี token
    await agentClient(app, agent).get('/api/auth/me')
    await new HttpClient(app.url).post('/api/auth/login', { username: 'owner', password: OWNER.password })
    await new Promise((r) => setTimeout(r, 200))
    const logs = app.output()
    expect(logs).toContain('/invite/[redacted]')
    expect(logs).not.toContain(agent.token)
    expect(logs).not.toContain(OWNER.password)
    expect(logs).not.toContain(owner.cookie!.split('=')[1])
    expect(logs).not.toContain(new URL(invite).pathname.split('/').pop()!)
    expect(logs).not.toContain(app.env.ALICE_BOOTSTRAP_TOKEN)
  })

  it('never returns token hashes or password hashes from any listing', async () => {
    const bodies = await Promise.all(['/api/actors', '/api/agents', '/api/invites', '/api/auth/me', '/api/activity?limit=200'].map((u) => owner.get(u)))
    const text = JSON.stringify(bodies.map((b) => b.body))
    expect(text).not.toMatch(/scrypt\$|token_hash|password_hash|alice_at_[0-9a-z]{40}|alice_inv_/)
  })
})
