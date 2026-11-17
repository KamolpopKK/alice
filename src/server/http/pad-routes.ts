import type { FastifyInstance } from 'fastify'
import * as z from 'zod'
import { idSchema } from '../../shared/contracts'
import {
  bulkPadTasksInput,
  padBlockActionInput,
  padTaskSearchInput,
  turnIntoDescriptionInput,
  undoTaskCaptureInput,
  convertPadBlockInput,
  createPadBlockInput,
  createPadInput,
  deletePadBlockInput,
  deletePadInput,
  listPadBlocksInput,
  listPadsInput,
  movePadBlockInput,
  padSearchInput,
  updatePadBlockInput,
  updatePadInput,
} from '../../shared/pads'
import type { AppContext } from '../context'
import {
  convertBlock,
  createBlock,
  createPad,
  deleteBlock,
  deletePad,
  exportPads,
  getPad,
  listBlocks,
  listPads,
  moveBlock,
  searchPads,
  setPadArchived,
  updateBlock,
  updatePad,
} from '../domain/pads'
import { bulkCreateTasks, completeFromPad, removeCompleted, reopenFromPad, searchTasksForPad, turnIntoDescription, undoTaskCapture } from '../domain/pad-tasks'
import { requireAuth } from './auth'
import { parse } from './validate'

const padParam = z.object({ padId: idSchema })
const blockParam = z.object({ padId: idSchema, blockId: idSchema })

/**
 * Personal Task Pads. Mounted only under `/client/v1` (no `/api` compatibility surface), which
 * accepts human credentials only; the domain re-checks ownership on every call.
 */
export function registerPadRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/pads', async (req) => listPads(ctx, requireAuth(req), parse(listPadsInput, req.query)))
  app.post('/pads', async (req, reply) => reply.status(201).send(createPad(ctx, requireAuth(req), parse(createPadInput, req.body))))
  app.get('/pads/export', async (req, reply) => {
    const data = exportPads(ctx, requireAuth(req))
    reply.header('Content-Disposition', `attachment; filename="alice-pads-${data.exportedAt.slice(0, 10)}.json"`)
    return data
  })
  app.get('/pad-search', async (req) => searchPads(ctx, requireAuth(req), parse(padSearchInput, req.query)))
  app.get('/pads/:padId', async (req) => ({ pad: getPad(ctx, requireAuth(req), parse(padParam, req.params).padId) }))
  app.patch('/pads/:padId', async (req) => updatePad(ctx, requireAuth(req), parse(padParam, req.params).padId, parse(updatePadInput, req.body)))
  app.post('/pads/:padId/archive', async (req) => setPadArchived(ctx, requireAuth(req), parse(padParam, req.params).padId, true))
  app.post('/pads/:padId/restore', async (req) => setPadArchived(ctx, requireAuth(req), parse(padParam, req.params).padId, false))
  app.delete('/pads/:padId', async (req) => {
    const actor = requireAuth(req)
    parse(deletePadInput, req.body)
    return deletePad(ctx, actor, parse(padParam, req.params).padId)
  })

  app.get('/pads/:padId/blocks', async (req) => listBlocks(ctx, requireAuth(req), parse(padParam, req.params).padId, parse(listPadBlocksInput, req.query)))
  app.post('/pads/:padId/blocks', async (req, reply) =>
    reply.status(201).send(createBlock(ctx, requireAuth(req), parse(padParam, req.params).padId, parse(createPadBlockInput, req.body))),
  )
  app.patch('/pads/:padId/blocks/:blockId', async (req) => {
    const { padId, blockId } = parse(blockParam, req.params)
    return updateBlock(ctx, requireAuth(req), padId, blockId, parse(updatePadBlockInput, req.body))
  })
  app.post('/pads/:padId/blocks/:blockId/move', async (req) => {
    const { padId, blockId } = parse(blockParam, req.params)
    return moveBlock(ctx, requireAuth(req), padId, blockId, parse(movePadBlockInput, req.body))
  })
  app.post('/pads/:padId/blocks/:blockId/convert', async (req) => {
    const { padId, blockId } = parse(blockParam, req.params)
    return convertBlock(ctx, requireAuth(req), padId, blockId, parse(convertPadBlockInput, req.body))
  })
  app.delete('/pads/:padId/blocks/:blockId', async (req) => {
    const { padId, blockId } = parse(blockParam, req.params)
    return deleteBlock(ctx, requireAuth(req), padId, blockId, parse(deletePadBlockInput, req.body))
  })

  // ---- Task integration: every task change uses the normal task services and activity ----
  app.get('/pad-task-search', async (req) => {
    const q = parse(padTaskSearchInput, req.query)
    return searchTasksForPad(ctx, requireAuth(req), q.q, q.limit ?? 10)
  })
  app.post('/pads/:padId/blocks/bulk', async (req, reply) =>
    reply.status(201).send(bulkCreateTasks(ctx, requireAuth(req), parse(padParam, req.params).padId, parse(bulkPadTasksInput, req.body))),
  )
  app.post('/pads/:padId/undo-task-capture', async (req) => undoTaskCapture(ctx, requireAuth(req), parse(padParam, req.params).padId, parse(undoTaskCaptureInput, req.body)))
  app.post('/pads/:padId/remove-completed', async (req) => removeCompleted(ctx, requireAuth(req), parse(padParam, req.params).padId))
  app.post('/pads/:padId/blocks/:blockId/complete', async (req) => {
    const { padId, blockId } = parse(blockParam, req.params)
    return completeFromPad(ctx, requireAuth(req), padId, blockId, parse(padBlockActionInput, req.body).mutationId)
  })
  app.post('/pads/:padId/blocks/:blockId/reopen', async (req) => {
    const { padId, blockId } = parse(blockParam, req.params)
    return reopenFromPad(ctx, requireAuth(req), padId, blockId, parse(padBlockActionInput, req.body).mutationId)
  })
  app.post('/pads/:padId/blocks/:blockId/turn-into-description', async (req) => {
    const { padId, blockId } = parse(blockParam, req.params)
    const body = parse(turnIntoDescriptionInput, req.body)
    return turnIntoDescription(ctx, requireAuth(req), padId, blockId, body.targetTaskId, body.mutationId)
  })
}
