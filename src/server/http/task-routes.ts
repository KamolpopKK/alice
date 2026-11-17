import type { FastifyInstance } from 'fastify'
import * as z from 'zod'
import { createTaskInput, cursorSchema, idSchema, limitSchema, listTasksInput, updateTaskInput } from '../../shared/contracts'
import type { AppContext } from '../context'
import { listActivity } from '../domain/activity'
import { claimTask, createTask, getTask, listTasks, setTaskArchived, updateTask } from '../domain/tasks'
import { requireAuth } from './auth'
import { parse } from './validate'

const idParam = z.object({ id: idSchema })

export function registerTaskRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/tasks', async (req) => {
    const actor = requireAuth(req)
    return listTasks(ctx, parse(listTasksInput, req.query), actor)
  })
  app.post('/tasks', async (req, reply) => {
    const actor = requireAuth(req)
    return reply.status(201).send(createTask(ctx, actor, parse(createTaskInput, req.body)))
  })
  app.get('/tasks/:id', async (req) => {
    requireAuth(req)
    return { task: getTask(ctx, parse(idParam, req.params).id) }
  })
  app.patch('/tasks/:id', async (req) => {
    const actor = requireAuth(req)
    return updateTask(ctx, actor, parse(idParam, req.params).id, parse(updateTaskInput, req.body))
  })
  app.post('/tasks/:id/archive', async (req) => {
    const actor = requireAuth(req)
    return setTaskArchived(ctx, actor, parse(idParam, req.params).id, true)
  })
  app.post('/tasks/:id/restore', async (req) => {
    const actor = requireAuth(req)
    return setTaskArchived(ctx, actor, parse(idParam, req.params).id, false)
  })
  // claim แบบ compare-and-set เดียวกับ MCP: ได้เฉพาะ task ที่ ready และยังไม่มีคนรับ
  app.post('/tasks/:id/claim', async (req) => claimTask(ctx, requireAuth(req), parse(idParam, req.params).id))
  app.get('/tasks/:id/activity', async (req) => {
    requireAuth(req)
    const { id } = parse(idParam, req.params)
    getTask(ctx, id)
    const q = parse(z.object({ cursor: cursorSchema, limit: limitSchema }), req.query)
    return listActivity(ctx.db, ctx.workspaceId, { resourceType: 'task', resourceId: id, cursor: q.cursor, limit: q.limit })
  })
}
