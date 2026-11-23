import { createHash } from 'node:crypto'
import type * as z from 'zod'
import type { KnowledgeTopic, TopicMutationInput, createKnowledgeTopicInput, listKnowledgeTopicsInput, updateKnowledgeTopicInput } from '../../shared/contracts'
import { AliceError } from '../../shared/errors'
import type { AppContext } from '../context'
import { newId } from '../ids'
import type { Actor } from './actors'
import { mutate, type Mutation } from './activity'
import { getProject } from './projects'
import { actorCols, actorRefFrom, decodeCursor, encodeCursor } from './sql'

interface TopicRow extends Record<string, unknown> {
  id: string
  project_id: string
  name: string
  name_key: string
  description: string
  revision: number
  archived_at: string | null
  created_at: string
  updated_at: string
}
const SELECT = `SELECT k.*, ${actorCols('c', 'creator')}, ${actorCols('u', 'updater')}
  FROM knowledge_topics k LEFT JOIN actors c ON c.id = k.created_by LEFT JOIN actors u ON u.id = k.updated_by`
const toTopic = (r: TopicRow): KnowledgeTopic => ({
  id: r.id, projectId: r.project_id, name: r.name, description: r.description,
  revision: r.revision, archivedAt: r.archived_at, createdAt: r.created_at, updatedAt: r.updated_at,
  createdBy: actorRefFrom(r, 'creator'), updatedBy: actorRefFrom(r, 'updater')
})
const nameKey = (name: string) => name.normalize('NFKC').toLowerCase()

export function getKnowledgeTopic(ctx: AppContext, id: string): KnowledgeTopic {
  const row = ctx.db.prepare(`${SELECT} WHERE k.id = ? AND k.workspace_id = ?`).get(id, ctx.workspaceId) as TopicRow | undefined
  if (!row) throw new AliceError('NOT_FOUND', 'Knowledge topic not found')
  return toTopic(row)
}

export function listKnowledgeTopics(ctx: AppContext, projectId: string, input: z.infer<typeof listKnowledgeTopicsInput>) {
  getProject(ctx, projectId)
  const where = ['k.workspace_id = ?', 'k.project_id = ?']
  const params: unknown[] = [ctx.workspaceId, projectId]
  const limit = input.limit ?? 50
  if (input.archived !== 'all') where.push(`k.archived_at IS ${input.archived === 'active' ? '' : 'NOT '}NULL`)
  if (input.cursor) {
    const c = decodeCursor(input.cursor)
    if (!c || c.length !== 3 || c[0] !== projectId || typeof c[1] !== 'string' || typeof c[2] !== 'string') throw new AliceError('VALIDATION_ERROR', 'Invalid topic cursor')
    where.push('(k.name_key, k.id) > (?, ?)')
    params.push(c[1], c[2])
  }
  const rows = ctx.db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY k.name_key, k.id LIMIT ?`).all(...params, limit + 1) as TopicRow[]
  const page = rows.slice(0, limit)
  const last = page.at(-1)
  return { items: page.map(toTopic), nextCursor: rows.length > limit && last ? encodeCursor([projectId, last.name_key, last.id]) : null }
}

/** Actor-scoped domain replay also protects direct MCP calls; it commits with the mutation. */
export function knowledgeMutation<T>(ctx: AppContext, actor: Actor, mutationId: string, request: unknown, run: (m: Mutation) => T): T {
  const scope = `knowledge:${ctx.workspaceId}:${actor.id}`
  const hash = createHash('sha256').update(JSON.stringify(request)).digest('hex')
  return mutate(ctx, actor, (m) => {
    const prior = m.db.prepare('SELECT request_hash, response FROM idempotency_records WHERE scope = ? AND key = ?').get(scope, mutationId) as {
      request_hash: string
      response: string
    } | undefined
    if (prior) {
      if (prior.request_hash !== hash) throw new AliceError('IDEMPOTENCY_CONFLICT', 'This mutationId was used for a different change')
      return JSON.parse(prior.response) as T
    }
    const result = run(m)
    m.db.prepare('INSERT INTO idempotency_records (scope, key, request_hash, status, response, created_at) VALUES (?, ?, ?, 200, ?, ?)')
      .run(scope, mutationId, hash, JSON.stringify(result), m.now)
    return result
  }).value
}

function activeProject(ctx: AppContext, projectId: string) {
  if (getProject(ctx, projectId).archivedAt) throw new AliceError('INVALID_STATE', 'Restore the project before changing its knowledge')
}
function checkName(ctx: AppContext, projectId: string, name: string, except = '') {
  if (ctx.db.prepare('SELECT 1 FROM knowledge_topics WHERE project_id = ? AND name_key = ? AND archived_at IS NULL AND id <> ?').get(projectId, nameKey(name), except)) {
    throw new AliceError('CONFLICT', 'An active topic with this name already exists')
  }
}
export function requireTopicRevision(topic: KnowledgeTopic, expectedRevision: number) {
  if (topic.revision !== expectedRevision) throw new AliceError('CONFLICT', 'Knowledge topic changed; reload before retrying', { currentRevision: topic.revision })
}

export function createKnowledgeTopic(ctx: AppContext, actor: Actor, projectId: string, input: z.infer<typeof createKnowledgeTopicInput>) {
  return knowledgeMutation(ctx, actor, input.mutationId, ['topic.create', projectId, input], (m) => {
    activeProject(ctx, projectId)
    checkName(ctx, projectId, input.name)
    const id = newId('knt')
    m.db.prepare(`INSERT INTO knowledge_topics (id, workspace_id, project_id, name, name_key, description, revision, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`).run(id, ctx.workspaceId, projectId, input.name, nameKey(input.name), input.description, actor.id, actor.id, m.now, m.now)
    const activityId = m.record({ verb: 'knowledge.topic.created', resource: { type: 'project', id: projectId }, data: { topicId: id, name: input.name } })
    return { topic: getKnowledgeTopic(ctx, id), changed: true, activityId }
  })
}

export function updateKnowledgeTopic(ctx: AppContext, actor: Actor, id: string, input: z.infer<typeof updateKnowledgeTopicInput>) {
  return knowledgeMutation(ctx, actor, input.mutationId, ['topic.update', id, input], (m) => {
    const topic = getKnowledgeTopic(ctx, id)
    activeProject(ctx, topic.projectId)
    requireTopicRevision(topic, input.expectedRevision)
    if (topic.archivedAt) throw new AliceError('INVALID_STATE', 'Restore the topic before editing')
    const name = input.name ?? topic.name
    const description = input.description ?? topic.description
    checkName(ctx, topic.projectId, name, id)
    if (name === topic.name && description === topic.description) return { topic, changed: false, activityId: null }
    m.db.prepare('UPDATE knowledge_topics SET name = ?, name_key = ?, description = ?, revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(name, nameKey(name), description, actor.id, m.now, id)
    const activityId = m.record({ verb: 'knowledge.topic.updated', resource: { type: 'project', id: topic.projectId }, data: { topicId: id } })
    return { topic: getKnowledgeTopic(ctx, id), changed: true, activityId }
  })
}

export function archiveKnowledgeTopic(ctx: AppContext, actor: Actor, id: string, archived: boolean, input: TopicMutationInput) {
  return knowledgeMutation(ctx, actor, input.mutationId, ['topic.archive', id, archived, input], (m) => {
    const topic = getKnowledgeTopic(ctx, id)
    activeProject(ctx, topic.projectId)
    requireTopicRevision(topic, input.expectedRevision)
    if (Boolean(topic.archivedAt) === archived) return { topic, changed: false, activityId: null }
    if (!archived) checkName(ctx, topic.projectId, topic.name, id)
    m.db.prepare('UPDATE knowledge_topics SET archived_at = ?, revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(archived ? m.now : null, actor.id, m.now, id)
    const activityId = m.record({ verb: archived ? 'knowledge.topic.archived' : 'knowledge.topic.restored', resource: { type: 'project', id: topic.projectId }, data: { topicId: id } })
    return { topic: getKnowledgeTopic(ctx, id), changed: true, activityId }
  })
}
