import type { knowledgeContextInput, KnowledgeContext } from '../../shared/contracts'
import { ContextBudget } from './context-budget'
import { knowledgeFilters, documentTopicContext } from './knowledge-scope'
import { listDocuments } from './documents'
import type { listTopicDocumentsInput, putTopicDocumentInput, TopicDocumentPage } from '../../shared/contracts'
import { requireDocRow, toSummary } from './documents'
import { projectContext } from './search'
import { keyBetween, evenKeys, MAX_KEY_LENGTH } from './order-keys'
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

export function listTopicDocuments(ctx: AppContext, id: string, input: z.infer<typeof listTopicDocumentsInput>): TopicDocumentPage {
  const topic = getKnowledgeTopic(ctx, id)
  const params: unknown[] = [id]
  let after = ''
  if (input.cursor) {
    const c = decodeCursor(input.cursor)
    if (!c || c.length !== 4 || c[0] !== id || typeof c[1] !== 'number' || typeof c[2] !== 'string' || typeof c[3] !== 'string') throw new AliceError('VALIDATION_ERROR', 'Invalid reading list cursor')
    requireTopicRevision(topic, c[1])
    after = ' AND (order_key, document_id) > (?, ?)'
    params.push(c[2], c[3])
  }
  const limit = input.limit ?? 50
  const rows = ctx.db.prepare(`SELECT document_id, order_key FROM knowledge_topic_documents WHERE topic_id = ?${after} ORDER BY order_key, document_id LIMIT ?`).all(...params, limit + 1) as {
    document_id: string
    order_key: string
  }[]
  const page = rows.slice(0, limit)
  const last = page.at(-1)
  return {
    topic,
    items: page.map((r) => ({ document: toSummary(requireDocRow(ctx.db, ctx.workspaceId, r.document_id), ctx.db), orderKey: r.order_key, projectContext: projectContext(ctx.db, r.document_id) })),
    nextCursor: rows.length > limit && last ? encodeCursor([id, topic.revision, last.order_key, last.document_id]) : null,
  }
}

export function putTopicDocument(ctx: AppContext, actor: Actor, id: string, documentId: string, input: z.infer<typeof putTopicDocumentInput>) {
  return changeTopicDocument(ctx, actor, id, documentId, input, false)
}
export function removeTopicDocument(ctx: AppContext, actor: Actor, id: string, documentId: string, input: TopicMutationInput) {
  return changeTopicDocument(ctx, actor, id, documentId, input, true)
}
function changeTopicDocument(ctx: AppContext, actor: Actor, id: string, documentId: string, input: z.infer<typeof putTopicDocumentInput>, remove: boolean) {
  return knowledgeMutation(ctx, actor, input.mutationId, ['topic.document', id, documentId, remove, input], (m) => {
    const topic = getKnowledgeTopic(ctx, id)
    activeProject(ctx, topic.projectId)
    requireTopicRevision(topic, input.expectedRevision)
    if (topic.archivedAt) throw new AliceError('INVALID_STATE', 'Restore the topic before editing its reading list')
    const doc = requireDocRow(m.db, ctx.workspaceId, documentId)
    const current = m.db.prepare('SELECT order_key FROM knowledge_topic_documents WHERE topic_id = ? AND document_id = ?').get(id, documentId) as { order_key: string } | undefined
    if (remove) {
      if (!current) return { topic, changed: false, activityId: null }
      m.db.prepare('DELETE FROM knowledge_topic_documents WHERE topic_id = ? AND document_id = ?').run(id, documentId)
    } else {
      if (doc.archived_at && !current) throw new AliceError('INVALID_STATE', 'Restore the document before adding it')
      const before = input.beforeDocumentId
      if (before === documentId) throw new AliceError('VALIDATION_ERROR', 'A document cannot be placed before itself')
      const next = before ? m.db.prepare('SELECT order_key FROM knowledge_topic_documents WHERE topic_id = ? AND document_id = ?').get(id, before) as { order_key: string } | undefined : undefined
      if (before && !next) throw new AliceError('VALIDATION_ERROR', 'beforeDocumentId must belong to this topic')
      const previous = m.db.prepare(`SELECT order_key FROM knowledge_topic_documents WHERE topic_id = ? AND document_id <> ?${next ? ' AND order_key < ?' : ''} ORDER BY order_key DESC, document_id DESC LIMIT 1`).get(...(next ? [id, documentId, next.order_key] : [id, documentId])) as { order_key: string } | undefined
      if (current && (!previous || previous.order_key < current.order_key) && (!next || current.order_key < next.order_key)) return { topic, changed: false, activityId: null }
      let key = keyBetween(previous?.order_key ?? null, next?.order_key ?? null)
      if (key.length > MAX_KEY_LENGTH) {
        const rows = m.db.prepare('SELECT document_id FROM knowledge_topic_documents WHERE topic_id = ? AND document_id <> ? ORDER BY order_key, document_id').all(id, documentId) as { document_id: string }[]
        const position = before ? rows.findIndex((r) => r.document_id === before) : rows.length
        rows.splice(position, 0, { document_id: documentId })
        const keys = evenKeys(rows.length)
        const update = m.db.prepare('UPDATE knowledge_topic_documents SET order_key = ? WHERE topic_id = ? AND document_id = ?')
        rows.forEach((r, i) => {
          if (r.document_id === documentId) key = keys[i]
          else update.run(keys[i], id, r.document_id)
        })
      }
      m.db.prepare(`INSERT INTO knowledge_topic_documents (topic_id, document_id, order_key, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(topic_id, document_id) DO UPDATE SET order_key = excluded.order_key, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).run(id, documentId, key, actor.id, actor.id, m.now, m.now)
    }
    m.db.prepare('UPDATE knowledge_topics SET revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ?').run(actor.id, m.now, id)
    const activityId = m.record({ verb: remove ? 'knowledge.document.removed' : 'knowledge.document.put', resource: { type: 'project', id: topic.projectId }, data: { topicId: id, documentId } })
    return { topic: getKnowledgeTopic(ctx, id), changed: true, activityId }
  })
}

/** Discovery returns candidates, never a semantic answer or an aggregation of document bodies. */
export function getKnowledgeContext(ctx: AppContext, projectId: string, input: z.infer<typeof knowledgeContextInput>): KnowledgeContext {
  const project = getProject(ctx, projectId)
  knowledgeFilters(ctx, { knowledgeProjectId: projectId, topicId: input.topicId }, 'd')
  let position = 0
  let searchCursor: string | null = null
  if (input.cursor) {
    const c = decodeCursor(input.cursor)
    if (!c || c.length !== 4 || c[0] !== projectId || c[1] !== (input.q ?? '') || c[2] !== (input.topicId ?? '') || typeof c[3] !== 'string') throw new AliceError('VALIDATION_ERROR', 'Invalid knowledge context cursor')
    if (input.q) searchCursor = c[3]
    else {
      position = Number(c[3])
      if (!Number.isSafeInteger(position) || position < 0) throw new AliceError('VALIDATION_ERROR', 'Invalid knowledge context position')
    }
  }
  const budget = new ContextBudget(96_000)
  const topics = input.topicId ? { items: [getKnowledgeTopic(ctx, input.topicId)], nextCursor: null } : listKnowledgeTopics(ctx, projectId, { archived: 'active', limit: 10 })
  const topicItems = topics.items.map((t, i) => ({ id: t.id, name: t.name, revision: t.revision, description: budget.text(`topics.items.${i}.description`, t.description, 500, { tool: 'get_knowledge_topic', args: { id: t.id } }) }))
  const scope = input.topicId ? ' AND k.id = ?' : ''
  const params = [ctx.workspaceId, projectId, ...(input.topicId ? [input.topicId] : [])]
  const from = `FROM knowledge_topics k JOIN knowledge_topic_documents m ON m.topic_id = k.id JOIN documents d ON d.id = m.document_id
    WHERE k.workspace_id = ? AND k.project_id = ? AND k.archived_at IS NULL AND d.workspace_id = k.workspace_id AND d.archived_at IS NULL${scope}`
  const hasCuration = ctx.db.prepare(`SELECT 1 ${from} LIMIT 1`).get(...params)
  let documents: ReturnType<typeof listDocuments> = { items: [], nextCursor: null }
  if (hasCuration && input.q) documents = listDocuments(ctx, { q: input.q, knowledgeProjectId: projectId, topicId: input.topicId, archived: 'active', limit: input.limit, cursor: searchCursor })
  else if (hasCuration) {
    const rows = ctx.db.prepare(`WITH ordered AS (
      SELECT d.id, k.name_key, k.id AS topic_id, m.order_key,
        row_number() OVER (PARTITION BY d.id ORDER BY k.name_key, k.id, m.order_key, d.id) AS occurrence ${from}
    ) SELECT id FROM ordered WHERE occurrence = 1 ORDER BY name_key, topic_id, order_key, id LIMIT ? OFFSET ?`).all(...params, input.limit + 1, position) as { id: string }[]
    documents = { items: rows.slice(0, input.limit).map((r) => toSummary(requireDocRow(ctx.db, ctx.workspaceId, r.id), ctx.db)), nextCursor: rows.length > input.limit ? String(position + input.limit) : null }
  }
  const candidates = documents.items.map((d, i) => {
    const { id, title, revision, status, owner, reviewedAt, reviewedBy, reviewedRevision, updatedAt, updatedBy } = d
    const document = { id, title, revision, status, owner, reviewedAt, reviewedBy, reviewedRevision, updatedAt, updatedBy }
    const match = d.match ? { ...d.match, excerpt: budget.text(`candidates.items.${i}.match.excerpt`, d.match.excerpt, 200, { tool: 'get_document', args: { id, expectedRevision: revision } }) } : null
    const candidate = { document, match, projectContext: d.projectContext ?? projectContext(ctx.db, id), topicContext: d.topicContext ?? documentTopicContext(ctx.db, ctx.workspaceId, id), read: {
      outline: { tool: 'get_document_outline', args: { id, expectedRevision: revision } },
      content: { tool: 'get_document', args: { id, expectedRevision: revision, maxChars: 20000 } },
    } }
    budget.charge(JSON.stringify(candidate).length)
    return { ...candidate, excerpt: budget.text(`candidates.items.${i}.excerpt`, d.excerpt, 200, candidate.read.content) }
  })
  return {
    project: { id: project.id, name: project.name, archivedAt: project.archivedAt },
    topics: { items: topicItems, nextCursor: topics.nextCursor, continuation: topics.nextCursor ? { tool: 'list_knowledge_topics', args: { projectId, archived: 'active', cursor: topics.nextCursor, limit: 10 } } : null },
    candidates: { items: candidates, nextCursor: documents.nextCursor === null ? null : encodeCursor([projectId, input.q ?? '', input.topicId ?? '', documents.nextCursor]) },
    discovery: input.q ? 'lexical' : 'curated-order',
    limitations: ['Curated does not mean reviewed or current.', 'Lexical matches do not detect semantic conflicts.', 'Read selected outlines and content at the returned revision; discovery does not include full bodies.'],
    fallback: { tool: 'search_documents', args: { ...(input.q ? { q: input.q } : {}), archived: 'active', limit: input.limit } },
    budget: { maxChars: budget.maxChars, usedChars: budget.usedChars, truncations: budget.truncations },
  }
}
