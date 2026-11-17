import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { ClientEvent, ClientEventReset } from '../../shared/contracts'
import { getConnectivity, setConnectivity } from '../connectivity'
import { AliceClientError, type ClientErrorCode, type EventHandlers, type Transport, type TransportRequest, type TransportResponse } from '../../client'
import { IDEMPOTENCY_HEADER } from '../../shared/version'
import { isNativeError } from './native'

const NATIVE_TO_CLIENT: Record<string, { code: ClientErrorCode; status: number }> = {
  NOT_SIGNED_IN: { code: 'UNAUTHENTICATED', status: 401 },
  NO_PROFILE: { code: 'UNAUTHENTICATED', status: 401 },
  PROFILE_CHANGED: { code: 'CONFLICT', status: 409 },
  NETWORK_ERROR: { code: 'NETWORK_ERROR', status: 0 },
  PROTOCOL_ERROR: { code: 'PROTOCOL_ERROR', status: 0 },
  INVALID_REQUEST: { code: 'VALIDATION_ERROR', status: 400 },
  STORAGE_ERROR: { code: 'INTERNAL_ERROR', status: 500 },
}

export function toClientError(err: unknown): AliceClientError {
  if (!isNativeError(err)) return new AliceClientError(0, 'INTERNAL_ERROR', 'The desktop runtime failed')
  const mapped = NATIVE_TO_CLIENT[err.code]
  if (mapped) return new AliceClientError(mapped.status, mapped.code, err.message, err.details)
  return new AliceClientError(400, err.code as ClientErrorCode, err.message, err.details)
}

/**
 * Desktop transport: every request goes through the Rust core, which adds the bearer credential and
 * talks to the active profile's server. JavaScript never sees a credential or chooses an origin.
 */
export class TauriTransport implements Transport {
  constructor(readonly profile: string) {}

  async request(req: TransportRequest): Promise<TransportResponse> {
    // ขาดการเชื่อมต่อ: ปฏิเสธการเขียนทันที ไม่มีการ queue ไว้ส่งทีหลัง (ข้อความใน form ยังอยู่)
    if (req.method !== 'GET' && getConnectivity() === 'offline') {
      throw new AliceClientError(0, 'NETWORK_ERROR', 'Not connected to the server — nothing was saved. Your text is kept; try again when the connection returns.')
    }
    const query: Array<[string, string]> = []
    for (const [k, v] of Object.entries(req.query ?? {})) {
      if (v === undefined || v === null || v === '') continue
      if (Array.isArray(v)) v.forEach((item) => query.push([k, item]))
      else query.push([k, String(v)])
    }
    const headers: Record<string, string> = {}
    const key = req.headers?.[IDEMPOTENCY_HEADER]
    if (key) headers[IDEMPOTENCY_HEADER] = key
    try {
      return await invoke<TransportResponse>('api_request', { input: { profile: this.profile, method: req.method, path: req.path, query, body: req.body, headers } })
    } catch (err) {
      const mapped = toClientError(err)
      if (mapped.code === 'NETWORK_ERROR') setConnectivity('offline')
      throw mapped
    }
  }

  /** The Rust core holds the authenticated stream; this only relays its typed events. */
  subscribe(after: number | null, handlers: EventHandlers): () => void {
    let closed = false
    const unlisten = listen<{ profile: string; type: string; data: unknown }>('alice://events', ({ payload }) => {
      if (closed || payload.profile !== this.profile) return
      switch (payload.type) {
        case 'ready':
          return handlers.onReady((payload.data as { position: number }).position)
        case 'invalidate':
          return handlers.onInvalidate(payload.data as ClientEvent)
        case 'reset':
          return handlers.onReset(payload.data as ClientEventReset)
        case 'unauthorized':
          return handlers.onUnauthorized()
        case 'disconnected':
          return handlers.onDisconnect()
      }
    })
    void unlisten.then(() => (closed ? undefined : invoke('events_subscribe', { profile: this.profile, after }))).catch(() => handlers.onDisconnect())
    return () => {
      closed = true
      void unlisten.then((fn) => fn())
      void invoke('events_unsubscribe').catch(() => {})
    }
  }
}
