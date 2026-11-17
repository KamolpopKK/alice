import type { FastifyInstance } from 'fastify'
import * as z from 'zod'
import { blockerInput, idSchema, setParentInput } from '../../shared/contracts'
import type { AppContext } from '../context'
import { addBlocker, getRelations, removeBlocker, setParent } from '../domain/relationships'
import { requireAuth } from './auth'
import { parse } from './validate'

const idParam = z.object({ id: idSchema })

export function registerRelationshipRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/tasks/:id/relations', async (req) => {
    requireAuth(req)
    return getRelations(ctx, parse(idParam, req.params).id)
  })
  app.put('/tasks/:id/parent', async (req) => setParent(ctx, requireAuth(req), parse(idParam, req.params).id, parse(setParentInput, req.body).parentId))
  app.post('/tasks/:id/blockers', async (req) => addBlocker(ctx, requireAuth(req), parse(idParam, req.params).id, parse(blockerInput, req.body).blockerId))
  app.delete('/tasks/:id/blockers/:blockerId', async (req) => {
    const { id, blockerId } = parse(z.object({ id: idSchema, blockerId: idSchema }), req.params)
    return removeBlocker(ctx, requireAuth(req), id, blockerId)
  })
}
