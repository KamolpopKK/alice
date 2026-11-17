import type { ClientEvent, ClientEventReset } from '../shared/contracts'

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
export type QueryValue = string | number | boolean | null | undefined | string[]

export interface TransportRequest {
  method: HttpMethod
  /** Path below the Client API prefix, e.g. `/tasks/tsk_1`. */
  path: string
  query?: Record<string, QueryValue>
  body?: unknown
  headers?: Record<string, string>
}

export interface TransportResponse {
  status: number
  /** Parsed JSON body (null when empty). */
  data: unknown
}

export interface EventHandlers {
  /** Stream is live; `position` is the resume point to persist in memory. */
  onReady(position: number): void
  onInvalidate(event: ClientEvent): void
  /** The resume position is gone; refetch everything that is displayed. */
  onReset(reset: ClientEventReset): void
  /** The credential stopped working (revoked or expired). */
  onUnauthorized(): void
  /** Connection lost; the transport retries on its own. */
  onDisconnect(): void
}

/**
 * Moves requests to Alice Server. Web uses cookies + CSRF; Desktop delegates to Rust which owns
 * bearer credentials; CLI uses Node fetch with a bearer access credential.
 * Transports throw AliceClientError('NETWORK_ERROR') when the server cannot be reached.
 */
export interface Transport {
  request(req: TransportRequest): Promise<TransportResponse>
  /** Opens the live invalidation stream; returns a function that closes it. */
  subscribe(after: number | null, handlers: EventHandlers): () => void
}

export function buildQuery(params: Record<string, QueryValue> | undefined): string {
  if (!params) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) v.forEach((item) => sp.append(k, item))
    else sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/** Minimal SSE frame parser shared by fetch-based transports (Node CLI). */
export function createSseParser(onFrame: (frame: { event: string; data: string; id: string | null }) => void): (chunk: string) => void {
  let buffer = ''
  return (chunk: string) => {
    buffer += chunk.replace(/\r\n/g, '\n')
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      let event = 'message'
      let id: string | null = null
      const data: string[] = []
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = colon < 0 ? line : line.slice(0, colon)
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
        if (field === 'event') event = value
        else if (field === 'data') data.push(value)
        else if (field === 'id') id = value
      }
      if (data.length || event !== 'message') onFrame({ event, data: data.join('\n'), id })
    }
  }
}

/** Dispatches one parsed SSE frame from `/client/v1/events` to typed handlers. */
export function dispatchEventFrame(frame: { event: string; data: string }, handlers: EventHandlers): number | null {
  const data = frame.data ? (JSON.parse(frame.data) as Record<string, unknown>) : {}
  switch (frame.event) {
    case 'ready':
      handlers.onReady(Number(data.position ?? 0))
      return Number(data.position ?? 0)
    case 'invalidate':
      handlers.onInvalidate(data as unknown as ClientEvent)
      return Number(data.position)
    case 'reset':
      handlers.onReset(data as unknown as ClientEventReset)
      return Number(data.position)
    case 'unauthorized':
      handlers.onUnauthorized()
      return null
    default:
      return null
  }
}
