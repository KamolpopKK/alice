import type { FastifyInstance } from 'fastify'
import * as z from 'zod'
import { decideApprovalInput, idSchema, listApprovalsInput, requestApprovalInput } from '../../shared/contracts'
import type { AppContext } from '../context'
import { decideApproval, getApproval, listApprovals, requestApproval } from '../domain/approvals'
import { requireAuth } from './auth'
import { parse } from './validate'

const idParam = z.object({ id: idSchema })

/** Approval requests on tasks (capability `approvals`). */
export function registerApprovalRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/approvals', async (req) => listApprovals(ctx, requireAuth(req), parse(listApprovalsInput, req.query)))
  app.get('/approvals/:id', async (req) => {
    requireAuth(req)
    return { approval: getApproval(ctx, parse(idParam, req.params).id) }
  })
  app.post('/tasks/:id/approvals', async (req, reply) => {
    const actor = requireAuth(req)
    return reply.status(201).send(requestApproval(ctx, actor, parse(idParam, req.params).id, parse(requestApprovalInput, req.body)))
  })
  for (const [path, decision] of [
    ['approve', 'approved'],
    ['reject', 'rejected'],
    ['cancel', 'canceled'],
  ] as const) {
    app.post(`/approvals/:id/${path}`, async (req) => decideApproval(ctx, requireAuth(req), parse(idParam, req.params).id, decision, parse(decideApprovalInput, req.body ?? {}).note))
  }
}
