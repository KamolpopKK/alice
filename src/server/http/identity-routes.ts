import type { FastifyInstance } from 'fastify'
import * as z from 'zod'
import {
  acceptInviteInput,
  bootstrapInput,
  createAgentInput,
  createInviteInput,
  issueTokenInput,
  loginInput,
} from '../../shared/contracts'
import type { AppContext } from '../context'
import { getPublicActor, listActors } from '../domain/actors'
import { revokeCurrentClientSession } from '../domain/client-sessions'
import {
  acceptInvite,
  bootstrapOwner,
  checkInvite,
  createAgent,
  createInvite,
  createSession,
  deactivateAgent,
  isBootstrapped,
  issueAgentToken,
  listAgents,
  listInvites,
  login,
  revokeAgentToken,
  revokeInvite,
  revokeSession,
  rotateAgentToken,
} from '../domain/identity'
import { authRateLimit, requireAuth, SESSION_COOKIE, setSessionCookie } from './auth'
import { parse } from './validate'

const idParam = z.object({ id: z.string().min(1).max(64) })

export function registerIdentityRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/auth/state', async () => ({ bootstrapped: isBootstrapped(ctx) }))

  app.post('/auth/bootstrap', { config: authRateLimit(ctx) }, async (req, reply) => {
    const input = parse(bootstrapInput, req.body)
    const actor = await bootstrapOwner(ctx, input)
    const session = createSession(ctx, actor.id)
    setSessionCookie(ctx, reply, session)
    return reply.status(201).send({ actor, csrfToken: session.csrfToken })
  })

  app.post('/auth/login', { config: authRateLimit(ctx) }, async (req, reply) => {
    const { actor, session } = await login(ctx, parse(loginInput, req.body))
    setSessionCookie(ctx, reply, session)
    return { actor, csrfToken: session.csrfToken }
  })

  app.post('/auth/logout', async (req, reply) => {
    if (req.auth?.sessionId) revokeSession(ctx, req.auth.sessionId)
    if (req.auth?.clientSessionId) revokeCurrentClientSession(ctx, req.auth.actor, req.auth.clientSessionId)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { ok: true }
  })

  app.get('/auth/me', async (req) => {
    const actor = requireAuth(req)
    return { actor: getPublicActor(ctx.db, actor.id), csrfToken: req.auth?.csrfToken ?? null, via: req.auth?.via }
  })

  // ---- invites ----
  app.get('/invites', async (req) => ({ items: listInvites(ctx, requireAuth(req)) }))
  app.post('/invites', async (req, reply) => {
    const result = createInvite(ctx, requireAuth(req), parse(createInviteInput, req.body))
    return reply.status(201).send(result)
  })
  app.post('/invites/:id/revoke', async (req) => {
    const { id } = parse(idParam, req.params)
    return { invite: revokeInvite(ctx, requireAuth(req), id) }
  })
  app.post('/invites/check', { config: authRateLimit(ctx) }, async (req) => {
    const { token } = parse(z.object({ token: z.string().min(1).max(512) }), req.body)
    return { valid: checkInvite(ctx, token) }
  })
  app.post('/invites/accept', { config: authRateLimit(ctx) }, async (req, reply) => {
    const { actor, session } = await acceptInvite(ctx, parse(acceptInviteInput, req.body))
    setSessionCookie(ctx, reply, session)
    return reply.status(201).send({ actor, csrfToken: session.csrfToken })
  })

  // ---- actors and agents ----
  app.get('/actors', async (req) => {
    requireAuth(req)
    return { items: listActors(ctx.db, ctx.workspaceId) }
  })
  app.get('/agents', async (req) => ({ items: listAgents(ctx, requireAuth(req)) }))
  app.post('/agents', async (req, reply) => {
    return reply.status(201).send(createAgent(ctx, requireAuth(req), parse(createAgentInput, req.body)))
  })
  app.post('/agents/:id/tokens', async (req, reply) => {
    const { id } = parse(idParam, req.params)
    const { name } = parse(issueTokenInput, req.body)
    return reply.status(201).send(issueAgentToken(ctx, requireAuth(req), id, name))
  })
  app.post('/agents/:id/deactivate', async (req) => {
    const { id } = parse(idParam, req.params)
    return { agent: deactivateAgent(ctx, requireAuth(req), id) }
  })
  app.post('/agent-tokens/:id/rotate', async (req) => {
    const { id } = parse(idParam, req.params)
    return rotateAgentToken(ctx, requireAuth(req), id)
  })
  app.post('/agent-tokens/:id/revoke', async (req) => {
    const { id } = parse(idParam, req.params)
    return { token: revokeAgentToken(ctx, requireAuth(req), id) }
  })
}
