import type { FastifyInstance } from 'fastify'
import * as z from 'zod'
import { TASK_STATUSES, cursorSchema, idSchema, limitSchema, listTasksInput, searchInput } from '../../shared/contracts'
import type { AppContext } from '../context'
import { listActivity } from '../domain/activity'
import { search } from '../domain/search'
import { listTasks } from '../domain/tasks'
import { requireAuth } from './auth'
import { parse } from './validate'

export function registerWorkspaceRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Board: one page per fixed status column, sharing the same filters.
  app.get('/board', async (req) => {
    const actor = requireAuth(req)
    const base = parse(listTasksInput.omit({ status: true, cursor: true }), req.query)
    const columns = Object.fromEntries(
      TASK_STATUSES.map((status) => [status, listTasks(ctx, { ...base, status: [status], cursor: null, limit: base.limit ?? 50 }, actor)]),
    )
    return { columns }
  })

  app.get('/search', async (req) => {
    requireAuth(req)
    return search(ctx, parse(searchInput, req.query))
  })

  app.get('/activity', async (req) => {
    requireAuth(req)
    const q = parse(
      z.object({ cursor: cursorSchema, limit: limitSchema, actorId: idSchema.optional(), resourceType: z.string().max(40).optional() }),
      req.query,
    )
    return listActivity(ctx.db, ctx.workspaceId, q)
  })
}
