import type { FastifyInstance } from 'fastify'
import * as z from 'zod'
import { archiveFilterSchema, createProjectInput, idSchema, updateProjectInput } from '../../shared/contracts'
import type { AppContext } from '../context'
import { createProject, getProject, listProjects, setProjectArchived, updateProject } from '../domain/projects'
import { requireAuth } from './auth'
import { parse } from './validate'

const idParam = z.object({ id: idSchema })

export function registerProjectRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/projects', async (req) => {
    requireAuth(req)
    const { archived } = parse(z.object({ archived: archiveFilterSchema }), req.query)
    return { items: listProjects(ctx, { archived }) }
  })
  app.post('/projects', async (req, reply) => {
    const actor = requireAuth(req)
    return reply.status(201).send(createProject(ctx, actor, parse(createProjectInput, req.body)))
  })
  app.get('/projects/:id', async (req) => {
    requireAuth(req)
    return { project: getProject(ctx, parse(idParam, req.params).id) }
  })
  app.patch('/projects/:id', async (req) => {
    const actor = requireAuth(req)
    return updateProject(ctx, actor, parse(idParam, req.params).id, parse(updateProjectInput, req.body))
  })
  app.post('/projects/:id/archive', async (req) => {
    const actor = requireAuth(req)
    return setProjectArchived(ctx, actor, parse(idParam, req.params).id, true)
  })
  app.post('/projects/:id/restore', async (req) => {
    const actor = requireAuth(req)
    return setProjectArchived(ctx, actor, parse(idParam, req.params).id, false)
  })
}
