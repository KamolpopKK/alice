import type { FastifyInstance } from 'fastify'
import * as z from 'zod'
import { idSchema } from '../../shared/contracts'
import { createSavedViewInput } from '../../shared/saved-views'
import type { AppContext } from '../context'
import { deleteSavedView, listSavedViews, saveSavedView } from '../domain/saved-views'
import { requireAuth } from './auth'
import { parse } from './validate'

/** Saved Tasks views (capability `saved-views`): private to the signed-in human, Client API only. */
export function registerSavedViewRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/saved-views', async (req) => ({ items: listSavedViews(ctx, requireAuth(req)) }))
  app.post('/saved-views', async (req, reply) => reply.status(201).send(saveSavedView(ctx, requireAuth(req), parse(createSavedViewInput, req.body))))
  app.delete('/saved-views/:id', async (req) => deleteSavedView(ctx, requireAuth(req), parse(z.object({ id: idSchema }), req.params).id))
}
