import type { FastifyInstance, FastifyRequest } from 'fastify'
import * as z from 'zod'
import { deviceAuthorizeInput, deviceTokenInput, idSchema, refreshInput, userCodeInput } from '../../shared/contracts'
import { AliceError } from '../../shared/errors'
import type { AppContext } from '../context'
import {
  approveDeviceRequest,
  denyDeviceRequest,
  exchangeDeviceCode,
  isClientSessionActive,
  listClientSessions,
  lookupDeviceRequest,
  refreshClientSession,
  resolveAccessToken,
  revokeByRefreshToken,
  revokeClientSession,
  startDeviceAuthorization,
} from '../domain/client-sessions'
import { requireAuth, setClientBearerResolver } from './auth'
import { parse } from './validate'

/** Approving a device must happen in the browser with the normal web session, never from another client. */
function requireWebSession(req: FastifyRequest) {
  const actor = requireAuth(req)
  if (req.auth?.via !== 'session') throw new AliceError('FORBIDDEN', 'Approve sign-in requests from the Alice web dashboard')
  return actor
}

/** Device authorization and client-session routes; mounted only under the Client API prefix. */
export function registerDeviceRoutes(app: FastifyInstance, ctx: AppContext): void {
  setClientBearerResolver((c, token) => {
    const resolved = resolveAccessToken(c, token)
    if (!resolved) return null
    return {
      actor: resolved.actor,
      via: 'client',
      clientSessionId: resolved.sessionId,
      revalidate: () => isClientSessionActive(c, resolved.sessionId),
    }
  })
  const deviceLimit = { config: { rateLimit: { max: ctx.config.deviceRateLimitPerMinute, timeWindow: '1 minute' } } }

  app.post('/device/authorize', deviceLimit, async (req, reply) => reply.status(201).send(startDeviceAuthorization(ctx, parse(deviceAuthorizeInput, req.body))))
  app.post('/device/token', deviceLimit, async (req) => exchangeDeviceCode(ctx, parse(deviceTokenInput, req.body).deviceCode))
  app.post('/device/lookup', deviceLimit, async (req) => ({ request: lookupDeviceRequest(ctx, requireWebSession(req), parse(userCodeInput, req.body).userCode) }))
  app.post('/device/approve', deviceLimit, async (req) => ({ session: approveDeviceRequest(ctx, requireWebSession(req), parse(userCodeInput, req.body).userCode) }))
  app.post('/device/deny', deviceLimit, async (req) => denyDeviceRequest(ctx, requireWebSession(req), parse(userCodeInput, req.body).userCode))

  app.post('/auth/refresh', deviceLimit, async (req) => refreshClientSession(ctx, parse(refreshInput, req.body).refreshToken))
  app.post('/auth/revoke', deviceLimit, async (req) => {
    revokeByRefreshToken(ctx, parse(refreshInput, req.body).refreshToken)
    return { ok: true }
  })

  app.get('/client-sessions', async (req) => {
    const actor = requireAuth(req)
    const { include } = parse(z.object({ include: z.enum(['active', 'all']).default('active') }), req.query)
    return { items: listClientSessions(ctx, actor, req.auth?.clientSessionId ?? null, include === 'all') }
  })
  app.post('/client-sessions/:id/revoke', async (req) => {
    const { id } = parse(z.object({ id: idSchema }), req.params)
    return { session: revokeClientSession(ctx, requireAuth(req), id) }
  })
}
