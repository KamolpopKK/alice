import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { invalidationKeys, type AliceClient } from '../client'
import type { ClientEvent } from '../shared/contracts'
import { client } from './api'
import { setConnectivity, useConnectivity } from './connectivity'

export type LiveState = 'connecting' | 'live' | 'offline'

const liveListeners = new Set<(event: ClientEvent) => void>()

/** Raw invalidations for views that need more than a refetch (e.g. the Pad editor's origin checks). */
export function onLiveEvent(listener: (event: ClientEvent) => void): () => void {
  liveListeners.add(listener)
  return () => liveListeners.delete(listener)
}

export function applyInvalidation(qc: QueryClient, event: Pick<ClientEvent, 'kind' | 'id'>): void {
  for (const queryKey of invalidationKeys(event)) void qc.invalidateQueries({ queryKey })
}

/**
 * Subscribes to Client API invalidations and refetches affected views. The resume position lives
 * only in memory: a reconnect resumes from it, and a reset (position expired) refetches everything.
 */
export function subscribeLive(api: AliceClient, qc: QueryClient, setState: (s: LiveState) => void, onUnauthorized: () => void): () => void {
  let position: number | null = null
  let everReady = false
  return api.subscribe(position, {
    onReady(p) {
      // ต่อใหม่หลังหลุด: ถ้า transport resume ไม่ได้ ต้อง refetch ทุกอย่างที่เปิดอยู่
      if (everReady && position === null) void qc.invalidateQueries()
      everReady = true
      position = p
      setState('live')
    },
    onInvalidate(event) {
      position = event.position
      for (const l of liveListeners) l(event)
      applyInvalidation(qc, event)
    },
    onReset(reset) {
      position = reset.position
      void qc.invalidateQueries()
    },
    onUnauthorized() {
      setState('offline')
      onUnauthorized()
    },
    onDisconnect() {
      setState('offline')
    },
  })
}

/** Subscribes to server invalidations; refetches affected views. Returns the connection state. */
export function useLiveUpdates(enabled: boolean): LiveState {
  const qc = useQueryClient()
  const state = useConnectivity()
  useEffect(() => {
    if (!enabled) return
    return subscribeLive(client, qc, setConnectivity, () => void qc.invalidateQueries({ queryKey: ['auth'] }))
  }, [enabled, qc])
  return state
}
