import { AliceClientError, buildQuery, createSseParser, dispatchEventFrame, type EventHandlers, type Transport, type TransportRequest, type TransportResponse } from '../client'
import { CLIENT_API_PREFIX } from '../shared/version'

const TLS_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_NOT_YET_VALID',
])

/** Turns fetch failures into safe, actionable network errors (never echoing headers or bodies). */
export function networkError(err: unknown, origin: string): AliceClientError {
  const cause = (err as { cause?: { code?: string; errors?: Array<{ code?: string }> } }).cause
  const code = cause?.code ?? cause?.errors?.find((e) => e.code)?.code ?? (err as { code?: string }).code
  if (code && TLS_CODES.has(code)) {
    return new AliceClientError(0, 'NETWORK_ERROR', `The TLS certificate of ${origin} could not be verified (${code}). Use a trusted certificate or set NODE_EXTRA_CA_CERTS.`)
  }
  if (code === 'ECONNREFUSED') return new AliceClientError(0, 'NETWORK_ERROR', `Could not connect to ${origin} (connection refused)`)
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new AliceClientError(0, 'NETWORK_ERROR', `Could not resolve ${new URL(origin).hostname}`)
  if ((err as Error).name === 'TimeoutError') return new AliceClientError(0, 'NETWORK_ERROR', `${origin} did not respond in time`)
  return new AliceClientError(0, 'NETWORK_ERROR', `Could not reach ${origin}${code ? ` (${code})` : ''}`)
}

export interface BearerSource {
  /** Current access credential, or null for anonymous requests. */
  current(): Promise<string | null>
  /** Obtains a new access credential after a 401; returns null when that is impossible. */
  renew(): Promise<string | null>
}

/** Node transport for the CLI: bearer credential from memory, one transparent renewal on 401. */
export class NodeTransport implements Transport {
  constructor(
    readonly origin: string,
    private readonly bearer: BearerSource | null = null,
    private readonly timeoutMs = 30_000,
  ) {}

  private async send(req: TransportRequest, token: string | null): Promise<TransportResponse> {
    const headers: Record<string, string> = { ...req.headers, accept: 'application/json' }
    if (req.body !== undefined) headers['content-type'] = 'application/json'
    if (token) headers.authorization = `Bearer ${token}`
    let res: Response
    try {
      res = await fetch(`${this.origin}${CLIENT_API_PREFIX}${req.path}${buildQuery(req.query)}`, {
        method: req.method,
        headers,
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      })
    } catch (err) {
      throw networkError(err, this.origin)
    }
    const text = await res.text()
    try {
      return { status: res.status, data: text ? JSON.parse(text) : null }
    } catch {
      throw new AliceClientError(res.status, 'PROTOCOL_ERROR', `${this.origin} did not answer like an Alice server (HTTP ${res.status})`)
    }
  }

  async request(req: TransportRequest): Promise<TransportResponse> {
    const token = this.bearer ? await this.bearer.current() : null
    const res = await this.send(req, token)
    if (res.status === 401 && this.bearer && token) {
      const renewed = await this.bearer.renew()
      if (renewed) return this.send(req, renewed)
    }
    return res
  }

  subscribe(after: number | null, handlers: EventHandlers): () => void {
    const controller = new AbortController()
    void (async () => {
      const token = this.bearer ? await this.bearer.current() : null
      try {
        const res = await fetch(`${this.origin}${CLIENT_API_PREFIX}/events${after === null ? '' : `?after=${after}`}`, {
          headers: token ? { authorization: `Bearer ${token}`, accept: 'text/event-stream' } : { accept: 'text/event-stream' },
          signal: controller.signal,
        })
        if (res.status === 401) return handlers.onUnauthorized()
        if (!res.ok || !res.body) return handlers.onDisconnect()
        const decoder = new TextDecoder()
        const feed = createSseParser((frame) => dispatchEventFrame(frame, handlers))
        const reader = res.body.getReader()
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          feed(decoder.decode(value, { stream: true }))
        }
        handlers.onDisconnect()
      } catch {
        if (!controller.signal.aborted) handlers.onDisconnect()
      }
    })()
    return () => controller.abort()
  }
}
