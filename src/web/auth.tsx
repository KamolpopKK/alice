import { createContext, useContext, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { PublicActor } from '../shared/contracts'
import { client, ApiError, setCsrfToken } from './api'
import { isDesktop } from './platform'

interface AuthState {
  actor: PublicActor | null
  bootstrapped: boolean
  loading: boolean
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const state = useQuery({ queryKey: ['auth', 'state'], queryFn: () => client.auth.state(), staleTime: 60_000 })
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      try {
        const res = await client.auth.me()
        setCsrfToken(res.csrfToken)
        return res.actor
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  })

  const value: AuthState = {
    actor: me.data ?? null,
    bootstrapped: state.data?.bootstrapped ?? true,
    loading: me.isLoading || state.isLoading,
    signOut: async () => {
      if (isDesktop) {
        // Desktop: Rust revoke session ของ profile นี้และลบ credential ออกจาก OS store
        const { native } = await import('./desktop/native')
        const { active } = await native.profiles()
        if (active) await native.logout(active)
      } else {
        await client.auth.logout()
      }
      setCsrfToken(null)
      qc.setQueryData(['auth', 'me'], null)
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' })
    },
    refresh: async () => {
      await qc.invalidateQueries({ queryKey: ['auth'] })
    },
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}

export function useMe(): PublicActor {
  const { actor } = useAuth()
  if (!actor) throw new Error('useMe requires a signed-in actor')
  return actor
}
