import type { FastifyInstance, FastifyRequest } from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fastifyRateLimit from '@fastify/rate-limit'
import { AliceError } from '../../shared/errors'
import type { AppContext } from '../context'
import type { Actor } from '../domain/actors'
import { isClientApi } from './client-api'
import { authenticateAgentToken, resolveSession, type IssuedSession } from '../domain/identity'

export const SESSION_COOKIE = 'alice_session'
export const CSRF_HEADER = 'x-csrf-token'

export interface AuthInfo {
  actor: Actor
  via: 'session' | 'token' | 'client'
  sessionId?: string
  csrfToken?: string
  /** Device-authorized Desktop/CLI session (bearer access credential). */
  clientSessionId?: string
  /** Re-checks that the credential is still valid (used by long-lived event streams). */
  revalidate?: () => boolean
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthInfo | null
  }
}

/** Resolves a Client API bearer access credential; installed by the device-auth module. */
let clientBearer: ((ctx: AppContext, token: string) => AuthInfo | null) | null = null
export function setClientBearerResolver(resolver: (ctx: AppContext, token: string) => AuthInfo | null): void {
  clientBearer = resolver
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function bearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization
  if (!header) return null
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  return match ? match[1] : null
}

export async function registerAuth(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await app.register(fastifyCookie)
  await app.register(fastifyRateLimit, { global: false })
  app.decorateRequest('auth', null)

  app.addHook('onRequest', async (req) => {
    const client = isClientApi(req.url.split('?')[0])
    if (!req.url.startsWith('/api/') && !client) return
    const bearer = bearerToken(req)
    if (bearer && client) {
      // Client API รับเฉพาะ credential ของคน — agent token ใช้ได้แค่ MCP และ API เดิม
      const resolved = clientBearer ? clientBearer(ctx, bearer) : null
      if (!resolved) throw new AliceError('UNAUTHENTICATED', 'Invalid, expired or revoked access token')
      req.auth = resolved
      return
    }
    if (bearer) {
      const actor = authenticateAgentToken(ctx, bearer)
      if (!actor) throw new AliceError('UNAUTHENTICATED', 'Invalid or revoked token')
      req.auth = { actor, via: 'token' }
      return
    }
    const cookie = req.cookies[SESSION_COOKIE]
    if (cookie) {
      const session = resolveSession(ctx, cookie)
      if (session) {
        req.auth = {
          actor: session.actor,
          via: 'session',
          sessionId: session.sessionId,
          csrfToken: session.csrfToken,
          revalidate: () => resolveSession(ctx, cookie) !== null,
        }
      }
    }
    if (SAFE_METHODS.has(req.method)) return

    // Cookie-authenticated (or anonymous) mutation: enforce same-origin and CSRF token.
    const origin = req.headers.origin
    if (origin) {
      const allowed = new Set([ctx.config.publicUrl.origin, `${req.protocol}://${req.host}`])
      if (!allowed.has(origin)) throw new AliceError('FORBIDDEN', 'Cross-origin request rejected')
    }
    if (req.auth?.via === 'session') {
      const header = req.headers[CSRF_HEADER]
      if (typeof header !== 'string' || header !== req.auth.csrfToken) {
        throw new AliceError('FORBIDDEN', 'Missing or invalid CSRF token')
      }
    }
  })
}

export function requireAuth(req: FastifyRequest): Actor {
  if (!req.auth) throw new AliceError('UNAUTHENTICATED', 'Sign in required')
  return req.auth.actor
}

export function setSessionCookie(ctx: AppContext, reply: { setCookie: (name: string, value: string, opts: object) => unknown }, session: IssuedSession): void {
  reply.setCookie(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.cookieSecure,
    path: '/',
    expires: new Date(session.expiresAt),
  })
}

export function authRateLimit(ctx: AppContext) {
  return { rateLimit: { max: ctx.config.authRateLimitPerMinute, timeWindow: '1 minute' } }
}
