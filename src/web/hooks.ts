import { useQuery } from '@tanstack/react-query'
import type { ActivityEvent, Page, PublicActor, Task } from '../shared/contracts'
import { client } from './api'

export function useActors() {
  return useQuery({ queryKey: ['actors'], queryFn: () => client.actors.list(), staleTime: 60_000 })
}

export function useTask(id: string) {
  return useQuery({ queryKey: ['task', id], queryFn: () => client.tasks.get(id), enabled: id !== '' })
}

export function useTaskActivity(id: string) {
  return useQuery({ queryKey: ['task', id, 'activity'], queryFn: () => client.tasks.activity(id, { limit: 50 }) })
}

/** Public server description (protocol range and capabilities); cached for the session. */
export function useServerInfo() {
  return useQuery({ queryKey: ['server-info'], queryFn: () => client.info(), staleTime: 5 * 60_000 })
}

/**
 * Whether the connected server offers a capability. Unknown (still loading) counts as available so
 * the UI does not flicker; an older server without it hides the surface instead of failing.
 */
export function useCapability(name: string): boolean {
  const info = useServerInfo()
  return !info.data || info.data.capabilities.includes(name)
}
