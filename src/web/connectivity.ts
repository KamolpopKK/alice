import { useSyncExternalStore } from 'react'

export type Connectivity = 'connecting' | 'live' | 'offline'

let state: Connectivity = 'connecting'
const listeners = new Set<() => void>()

/** One shared view of whether the server is reachable (live stream + request failures). */
export function setConnectivity(next: Connectivity) {
  if (next === state) return
  state = next
  listeners.forEach((l) => l())
}

export function getConnectivity(): Connectivity {
  return state
}

export function useConnectivity(): Connectivity {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}
