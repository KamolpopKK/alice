import { AliceClientError, buildQuery, dispatchEventFrame, type EventHandlers, type Transport, type TransportRequest, type TransportResponse } from '../client'
import { CLIENT_API_PREFIX } from '../shared/version'

/**
 * Browser transport: same-origin cookie session plus CSRF header. The CSRF token is learned from
 * sign-in and `auth/me` responses and is never persisted.
 */
export class CookieTransport implements Transport {
  csrfToken: string | null = null

  async request(req: TransportRequest): Promise<TransportResponse> {
    const headers: Record<string, string> = { ...req.headers }
    if (req.body !== undefined) headers['content-type'] = 'application/json'
    if (req.method !== 'GET' && this.csrfToken) headers['x-csrf-token'] = this.csrfToken
    let res: Response
    try {
      res = await fetch(`${CLIENT_API_PREFIX}${req.path}${buildQuery(req.query)}`, {
        method: req.method,
        headers,
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        credentials: 'same-origin',
      })
    } catch {
      throw new AliceClientError(0, 'NETWORK_ERROR', 'Could not reach the server')
    }
    const text = await res.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      throw new AliceClientError(res.status, 'PROTOCOL_ERROR', `Unexpected response from the server (${res.status})`)
    }
    if (res.ok && data && typeof data === 'object' && 'csrfToken' in data) {
      const token = (data as { csrfToken: unknown }).csrfToken
      if (typeof token === 'string' || token === null) this.csrfToken = token
    }
    return { status: res.status, data }
  }

  subscribe(after: number | null, handlers: EventHandlers): () => void {
    if (typeof EventSource === 'undefined') return () => {}
    // EventSource ส่ง Last-Event-ID เองตอน reconnect จึง resume ต่อจากตำแหน่งล่าสุดได้
    const source = new EventSource(`${CLIENT_API_PREFIX}/events${after === null ? '' : `?after=${after}`}`)
    for (const name of ['ready', 'invalidate', 'reset', 'unauthorized']) {
      source.addEventListener(name, (e) => {
        dispatchEventFrame({ event: name, data: (e as MessageEvent).data as string }, handlers)
        if (name === 'unauthorized') source.close()
      })
    }
    source.onerror = () => handlers.onDisconnect()
    return () => source.close()
  }
}
