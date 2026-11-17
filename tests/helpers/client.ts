import type { RunningApp } from './app'

export interface ApiResponse<T = any> {
  status: number
  body: T
  headers: Headers
}

/** Minimal cookie-jar HTTP client that behaves like the browser (session cookie + CSRF header). */
export class HttpClient {
  cookie: string | null = null
  csrfToken: string | null = null
  bearer: string | null = null

  constructor(readonly baseUrl: string) {}

  async request<T = any>(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { ...extraHeaders }
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (this.cookie) headers.cookie = this.cookie
    if (this.csrfToken && method !== 'GET') headers['x-csrf-token'] = this.csrfToken
    if (this.bearer) headers.authorization = `Bearer ${this.bearer}`
    const res = await fetch(this.baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const setCookie = res.headers.getSetCookie()
    for (const c of setCookie) {
      const [pair] = c.split(';')
      if (pair.startsWith('alice_session=')) this.cookie = pair.endsWith('=') ? null : pair
    }
    const text = await res.text()
    let parsed: any = text
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      /* not json */
    }
    if (parsed && typeof parsed === 'object' && typeof parsed.csrfToken === 'string') this.csrfToken = parsed.csrfToken
    return { status: res.status, body: parsed as T, headers: res.headers }
  }

  get<T = any>(path: string) {
    return this.request<T>('GET', path)
  }
  post<T = any>(path: string, body: unknown = {}) {
    return this.request<T>('POST', path, body)
  }
  put<T = any>(path: string, body: unknown = {}) {
    return this.request<T>('PUT', path, body)
  }
  patch<T = any>(path: string, body: unknown = {}) {
    return this.request<T>('PATCH', path, body)
  }
  delete<T = any>(path: string, body?: unknown) {
    return this.request<T>('DELETE', path, body)
  }
}

export const OWNER = { username: 'owner', displayName: 'Olivia Owner', password: 'owner-password-123' }

export async function bootstrapOwner(app: RunningApp): Promise<HttpClient> {
  const client = new HttpClient(app.url)
  const res = await client.post('/api/auth/bootstrap', { bootstrapToken: app.env.ALICE_BOOTSTRAP_TOKEN, ...OWNER })
  if (res.status !== 201) throw new Error(`bootstrap failed: ${JSON.stringify(res.body)}`)
  return client
}

export async function inviteHuman(owner: HttpClient, username: string, displayName = username): Promise<HttpClient> {
  const invite = await owner.post('/api/invites', { note: username })
  if (invite.status !== 201) throw new Error(`invite failed: ${JSON.stringify(invite.body)}`)
  const token = new URL(invite.body.url).pathname.split('/').pop()!
  const client = new HttpClient(owner.baseUrl)
  const res = await client.post('/api/invites/accept', { token, username, displayName, password: `${username}-password-123` })
  if (res.status !== 201) throw new Error(`accept failed: ${JSON.stringify(res.body)}`)
  return client
}

export interface AgentHandle {
  id: string
  token: string
  tokenId: string
}

export async function createAgent(owner: HttpClient, displayName: string): Promise<AgentHandle> {
  const res = await owner.post('/api/agents', { displayName })
  if (res.status !== 201) throw new Error(`agent failed: ${JSON.stringify(res.body)}`)
  return { id: res.body.agent.id, token: res.body.plaintextToken, tokenId: res.body.token.id }
}

export function agentClient(app: RunningApp, agent: AgentHandle): HttpClient {
  const client = new HttpClient(app.url)
  client.bearer = agent.token
  return client
}

export interface DeviceLogin {
  accessToken: string
  refreshToken: string
  sessionId: string
  deviceCode: string
  userCode: string
  client: HttpClient
}

/** Runs the device flow end to end: the client requests, `approver` approves in the browser session, the client exchanges. */
export async function deviceLogin(
  app: RunningApp,
  approver: HttpClient,
  meta: { clientKind?: 'cli' | 'desktop'; clientName?: string; deviceName?: string; clientVersion?: string } = {},
): Promise<DeviceLogin> {
  const anon = new HttpClient(app.url)
  const start = await anon.post('/client/v1/device/authorize', {
    clientKind: meta.clientKind ?? 'cli',
    clientName: meta.clientName ?? 'Alice CLI',
    deviceName: meta.deviceName ?? 'test-laptop',
    clientVersion: meta.clientVersion ?? '0.2.0',
  })
  if (start.status !== 201) throw new Error(`authorize failed: ${JSON.stringify(start.body)}`)
  const approved = await approver.post('/client/v1/device/approve', { userCode: start.body.userCode })
  if (approved.status !== 200) throw new Error(`approve failed: ${JSON.stringify(approved.body)}`)
  const token = await anon.post('/client/v1/device/token', { deviceCode: start.body.deviceCode })
  if (token.status !== 200) throw new Error(`exchange failed: ${JSON.stringify(token.body)}`)
  const client = new HttpClient(app.url)
  client.bearer = token.body.accessToken
  return {
    accessToken: token.body.accessToken,
    refreshToken: token.body.refreshToken,
    sessionId: token.body.session.id,
    deviceCode: start.body.deviceCode,
    userCode: start.body.userCode,
    client,
  }
}
