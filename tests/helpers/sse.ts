import type { HttpClient } from './client'

export interface SseEvent {
  event: string
  data: any
  id?: string | null
}

/** Opens the legacy SSE stream with the client's credentials and collects parsed events. */
export function openEvents(client: HttpClient) {
  return openStream(client, '/api/events')
}

/** Opens `/client/v1/events`, optionally resuming via `?after=` or a `Last-Event-ID` header. */
export function openClientEvents(client: HttpClient, opts: { after?: number; lastEventId?: number; waitReady?: boolean } = {}) {
  const query = opts.after === undefined ? '' : `?after=${opts.after}`
  const headers: Record<string, string> = {}
  if (opts.lastEventId !== undefined) headers['last-event-id'] = String(opts.lastEventId)
  return openStream(client, `/client/v1/events${query}`, headers, opts.waitReady ?? true)
}

export async function openStream(client: HttpClient, path: string, extraHeaders: Record<string, string> = {}, waitReady = true) {
  const controller = new AbortController()
  const headers: Record<string, string> = { ...extraHeaders }
  if (client.cookie) headers.cookie = client.cookie
  if (client.bearer) headers.authorization = `Bearer ${client.bearer}`
  const res = await fetch(`${client.baseUrl}${path}`, { headers, signal: controller.signal })
  if (res.status !== 200) throw Object.assign(new Error(`SSE failed: ${res.status}`), { status: res.status, body: await res.text() })
  const events: SseEvent[] = []
  const waiters: Array<{ pred: (e: SseEvent) => boolean; resolve: (e: SseEvent) => void }> = []
  let ended = false
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          let event = 'message'
          let data = ''
          let id: string | null = null
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7)
            else if (line.startsWith('data: ')) data += line.slice(6)
            else if (line.startsWith('id: ')) id = line.slice(4)
          }
          if (!data) continue
          const parsed: SseEvent = { event, data: JSON.parse(data), id }
          events.push(parsed)
          for (const w of [...waiters]) {
            if (w.pred(parsed)) {
              waiters.splice(waiters.indexOf(w), 1)
              w.resolve(parsed)
            }
          }
        }
      }
    } catch {
      /* aborted */
    }
    ended = true
  })()
  if (waitReady) await waitFor((e) => e.event === 'ready' || e.event === 'reset')

  function waitFor(pred: (e: SseEvent) => boolean, timeoutMs = 5000): Promise<SseEvent> {
    const existing = events.find(pred)
    if (existing) return Promise.resolve(existing)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no matching SSE event; got ${JSON.stringify(events)}`)), timeoutMs)
      waiters.push({ pred, resolve: (e) => (clearTimeout(timer), resolve(e)) })
    })
  }

  return {
    events,
    waitFor,
    waitForResource(type: string, id: string, timeoutMs?: number) {
      return waitFor((e) => e.event === 'invalidate' && e.data.resources.some((r: any) => r.type === type && r.id === id), timeoutMs)
    },
    ended: () => ended,
    close: () => controller.abort(),
  }
}
