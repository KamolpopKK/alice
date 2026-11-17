import type { FastifyInstance } from 'fastify'
import * as z from 'zod'
import { addCommentInput, completeTaskInput, idSchema, listCommentsInput, taskContextInput } from '../../shared/contracts'
import type { AppContext } from '../context'
import { addComment, completeTask, listComments } from '../domain/comments'
import { getTaskContext } from '../domain/task-context'
import { requireAuth } from './auth'
import { parse } from './validate'

const idParam = z.object({ id: idSchema })

export function registerCommentRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/tasks/:id/comments', async (req) => {
    requireAuth(req)
    return listComments(ctx, parse(idParam, req.params).id, parse(listCommentsInput, req.query))
  })
  app.post('/tasks/:id/comments', async (req, reply) => {
    const actor = requireAuth(req)
    return reply.status(201).send(addComment(ctx, actor, parse(idParam, req.params).id, parse(addCommentInput, req.body).body))
  })
  app.post('/tasks/:id/complete', async (req) => {
    const actor = requireAuth(req)
    return completeTask(ctx, actor, parse(idParam, req.params).id, parse(completeTaskInput, req.body).summary)
  })
  app.get('/tasks/:id/context', async (req) => {
    requireAuth(req)
    const raw = req.query as Record<string, string>
    const opts = parse(
      taskContextInput,
      Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Number.isNaN(Number(v)) ? v : Number(v)])),
    )
    return getTaskContext(ctx, parse(idParam, req.params).id, opts)
  })
}
