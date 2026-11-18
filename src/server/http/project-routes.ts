import type { FastifyInstance } from 'fastify'
import * as z from 'zod'
import { archiveFilterSchema, createMilestoneInput, createProjectInput, idSchema, updateMilestoneInput, updateProjectInput } from '../../shared/contracts'
import type { AppContext } from '../context'
import { createProject, getProject, listProjects, setProjectArchived, updateProject } from '../domain/projects'
import { createMilestone, deleteMilestone, listMilestones, listProjectMembers, projectProgress, setProjectMember, updateMilestone } from '../domain/project-planning'
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

  // ---- planning (capability `project-planning`) ----
  const memberParam = z.object({ id: idSchema, actorId: idSchema })
  app.get('/projects/:id/members', async (req) => {
    requireAuth(req)
    return { items: listProjectMembers(ctx, parse(idParam, req.params).id) }
  })
  app.put('/projects/:id/members/:actorId', async (req) => {
    const { id, actorId } = parse(memberParam, req.params)
    return setProjectMember(ctx, requireAuth(req), id, actorId, true)
  })
  app.delete('/projects/:id/members/:actorId', async (req) => {
    const { id, actorId } = parse(memberParam, req.params)
    return setProjectMember(ctx, requireAuth(req), id, actorId, false)
  })
  app.get('/projects/:id/milestones', async (req) => {
    requireAuth(req)
    return { items: listMilestones(ctx, parse(idParam, req.params).id) }
  })
  app.post('/projects/:id/milestones', async (req, reply) => {
    const actor = requireAuth(req)
    return reply.status(201).send(createMilestone(ctx, actor, parse(idParam, req.params).id, parse(createMilestoneInput, req.body)))
  })
  app.patch('/milestones/:id', async (req) => updateMilestone(ctx, requireAuth(req), parse(idParam, req.params).id, parse(updateMilestoneInput, req.body)))
  app.delete('/milestones/:id', async (req) => deleteMilestone(ctx, requireAuth(req), parse(idParam, req.params).id))
  app.get('/projects/:id/progress', async (req) => {
    requireAuth(req)
    return { progress: projectProgress(ctx, parse(idParam, req.params).id) }
  })
}
