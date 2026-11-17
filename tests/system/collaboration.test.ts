import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { HttpClient, bootstrapOwner, createAgent, type AgentHandle } from '../helpers/client'
import { activityFor, inspectDb } from '../helpers/db'
import { connectMcp, type McpHandle } from '../helpers/mcp'
import { openEvents } from '../helpers/sse'

let app: RunningApp
let owner: HttpClient
let agent: AgentHandle
let mcp: McpHandle

beforeAll(async () => {
  app = await startApp()
  owner = await bootstrapOwner(app)
  agent = await createAgent(owner, 'Finisher')
  mcp = await connectMcp(app.url, agent.token)
})
afterAll(async () => {
  await mcp?.close()
  await app?.stop()
})

describe('comments', () => {
  it('records attributed comments from humans and agents, separate from activity', async () => {
    const task = (await owner.post('/api/tasks', { title: 'Discuss API shape' })).body.task
    const human = await owner.post(`/api/tasks/${task.id}/comments`, { body: 'Should we version the URL? @Finisher' })
    expect(human.status).toBe(201)
    expect(human.body.comment).toMatchObject({ kind: 'comment', author: { kind: 'human', displayName: 'Olivia Owner' }, body: 'Should we version the URL? @Finisher' })
    const fromAgent = await mcp.ok('add_comment', { taskId: task.id, body: 'Yes — /v1 prefix.' })
    expect(fromAgent.comment.author).toMatchObject({ id: agent.id, kind: 'agent' })
    expect(fromAgent.activityId).toMatch(/^act_/)

    const list = (await owner.get(`/api/tasks/${task.id}/comments`)).body.items
    expect(list.map((c: any) => c.body)).toEqual(['Should we version the URL? @Finisher', 'Yes — /v1 prefix.'])
    expect(list[0].createdAt).toBeTruthy()
    // comment ไม่ใช่ activity: activity เก็บแค่การอ้างอิง
    const verbs = activityFor(app, task.id).map((e) => e.verb)
    expect(verbs).toEqual(['task.created', 'comment.added', 'comment.added'])
    expect((await owner.get(`/api/tasks/${task.id}`)).body.task.description).toBe('')
    expect(() => inspectDb(app, (db) => db.prepare(`UPDATE comments SET body = 'x'`).run())).toThrow()
    expect((await mcp.call('add_comment', { taskId: task.id, body: '   ' })).error!.code).toBe('VALIDATION_ERROR')
  })

  it('makes comment text searchable and paginates comments', async () => {
    const task = (await owner.post('/api/tasks', { title: 'Retro notes' })).body.task
    for (let i = 0; i < 5; i++) await owner.post(`/api/tasks/${task.id}/comments`, { body: `note ${i} about flamingo deploys` })
    const hits = (await owner.get('/api/search?q=flamingo&kind=comment')).body.items
    expect(hits).toHaveLength(5)
    expect(hits[0]).toMatchObject({ kind: 'comment', taskId: task.id, title: 'Retro notes' })
    const page1 = await mcp.ok('list_comments', { taskId: task.id, order: 'desc', limit: 2 })
    expect(page1.items.map((c: any) => c.body)).toEqual(['note 4 about flamingo deploys', 'note 3 about flamingo deploys'])
    const page2 = await mcp.ok('list_comments', { taskId: task.id, order: 'desc', limit: 2, cursor: page1.nextCursor })
    expect(page2.items.map((c: any) => c.body)).toEqual(['note 2 about flamingo deploys', 'note 1 about flamingo deploys'])
  })
})

describe('task context', () => {
  it('returns project, linked documents and recent comments in one bounded response', async () => {
    const project = (await owner.post('/api/projects', { name: 'Billing', description: 'Invoices and payments.' })).body.project
    const task = (await owner.post('/api/tasks', { title: 'Add VAT', description: 'Thai VAT is 7%.', projectId: project.id, status: 'ready' })).body.task
    const doc = (await owner.post('/api/documents', { title: 'Tax rules', body: 'VAT applies to services.' })).body.document
    await owner.post(`/api/documents/${doc.id}/links`, { taskId: task.id })
    await owner.post(`/api/tasks/${task.id}/comments`, { body: 'Use the existing rounding helper.' })

    const context = await mcp.ok('get_task_context', { id: task.id })
    expect(context.task).toMatchObject({ id: task.id, description: 'Thai VAT is 7%.' })
    expect(context.project).toMatchObject({ id: project.id, description: 'Invoices and payments.' })
    expect(context.documents).toEqual({ total: 1, items: [expect.objectContaining({ id: doc.id, title: 'Tax rules', body: 'VAT applies to services.' })] })
    expect(context.comments.items.map((c: any) => c.body)).toEqual(['Use the existing rounding helper.'])
    expect(context).toHaveProperty('parent', null)
    expect(context.children).toEqual({ items: [], total: 0 })
    expect(context.budget.truncations).toEqual([])
    expect(context.budget.usedChars).toBeLessThanOrEqual(context.budget.maxChars)
    expect((await owner.get(`/api/tasks/${task.id}/context`)).body.documents.total).toBe(1)
  })

  it('identifies every truncation with continuation information when context is oversized', async () => {
    const task = (await owner.post('/api/tasks', { title: 'Huge', description: 'd'.repeat(5000) })).body.task
    for (let i = 0; i < 3; i++) {
      const doc = (await owner.post('/api/documents', { title: `Big doc ${i}`, body: String(i).repeat(6000) })).body.document
      await owner.post(`/api/documents/${doc.id}/links`, { taskId: task.id })
    }
    for (let i = 0; i < 6; i++) await owner.post(`/api/tasks/${task.id}/comments`, { body: `comment ${i} `.repeat(50) })

    const context = await mcp.ok('get_task_context', { id: task.id, maxChars: 6000, commentLimit: 3, documentLimit: 2 })
    const { truncations, usedChars, maxChars } = context.budget
    expect(usedChars).toBeLessThanOrEqual(maxChars)
    const paths = truncations.map((t: any) => t.path)
    expect(paths).toContain('task.description')
    expect(paths).toContain('comments')
    expect(paths).toContain('documents')
    expect(paths.filter((p: string) => p.startsWith('documents.doc_'))).toHaveLength(2)

    const desc = truncations.find((t: any) => t.path === 'task.description')
    expect(desc).toMatchObject({ kind: 'text', total: 5000, returned: 1800, continuation: { tool: 'get_task', args: { id: task.id } } })
    expect(context.task.description).toHaveLength(1800)
    const comments = truncations.find((t: any) => t.path === 'comments')
    expect(comments).toMatchObject({ kind: 'collection', total: 6, returned: 3, continuation: { tool: 'list_comments' } })
    const docs = truncations.find((t: any) => t.path === 'documents')
    expect(docs).toMatchObject({ total: 3, returned: 2, continuation: { tool: 'search_documents', args: { taskId: task.id } } })

    // continuation ใช้ได้จริง
    const docCut = truncations.find((t: any) => t.path.startsWith('documents.doc_'))
    const rest = await mcp.ok(docCut.continuation.tool, { ...docCut.continuation.args, maxChars: 100 })
    expect(rest.document.bodyWindow.offset).toBe(docCut.returned)
    const older = await mcp.ok(comments.continuation.tool, comments.continuation.args)
    expect(older.items).toHaveLength(3)
    expect(older.items[0].body).toContain('comment 2')
    const moreDocs = await mcp.ok(docs.continuation.tool, docs.continuation.args)
    expect(moreDocs.items).toHaveLength(1)

    // ผลลัพธ์ต้องเหมือนเดิมทุกครั้ง (deterministic)
    expect(await mcp.ok('get_task_context', { id: task.id, maxChars: 6000, commentLimit: 3, documentLimit: 2 })).toEqual(context)
  })
})

describe('completion', () => {
  it('rejects agent completion without a summary and commits status, time, comment and activity together', async () => {
    const task = (await owner.post('/api/tasks', { title: 'Ship VAT', status: 'ready' })).body.task
    await mcp.ok('claim_task', { id: task.id })
    expect((await mcp.call('complete_task', { id: task.id, summary: '  ' })).error!.code).toBe('VALIDATION_ERROR')
    expect((await mcp.call('complete_task', { id: task.id })).error!.code).toBe('VALIDATION_ERROR')
    const viaHttp = await new HttpClient(app.url)
    viaHttp.bearer = agent.token
    expect((await viaHttp.post(`/api/tasks/${task.id}/complete`, {})).body.error.code).toBe('VALIDATION_ERROR')
    expect((await owner.get(`/api/tasks/${task.id}`)).body.task.status).toBe('in_progress')

    const done = await mcp.ok('complete_task', { id: task.id, summary: 'Added VAT line items; see PR #42.' })
    expect(done.task).toMatchObject({ status: 'done', assignee: { id: agent.id } })
    expect(done.task.completedAt).toBeTruthy()
    expect(done.comment).toMatchObject({ kind: 'completion_summary', body: 'Added VAT line items; see PR #42.', author: { id: agent.id } })
    const completed = activityFor(app, task.id).find((e) => e.verb === 'task.completed')!
    expect(completed.data.commentId).toBe(done.comment.id)
    expect(completed.actor_id).toBe(agent.id)
    expect((await mcp.call('complete_task', { id: task.id, summary: 'again' })).error!.code).toBe('INVALID_STATE')
  })

  it('rolls back the summary comment if completion fails to record', async () => {
    const faulty = await startApp({ env: { ALICE_TEST_FAIL_ACTIVITY_VERB: 'task.completed' } })
    try {
      const o = await bootstrapOwner(faulty)
      const a = await createAgent(o, 'Faulty')
      const handle = await connectMcp(faulty.url, a.token)
      const task = (await o.post('/api/tasks', { title: 'Atomic completion', status: 'ready' })).body.task
      await handle.ok('claim_task', { id: task.id })
      expect((await handle.call('complete_task', { id: task.id, summary: 'done' })).error!.code).toBe('INTERNAL_ERROR')
      expect((await o.get(`/api/tasks/${task.id}`)).body.task).toMatchObject({ status: 'in_progress', completedAt: null })
      expect((await o.get(`/api/tasks/${task.id}/comments`)).body.items).toHaveLength(0)
      await handle.close()
    } finally {
      await faulty.stop()
    }
  })

  it('lets humans complete without a summary, attributed to them', async () => {
    const task = (await owner.post('/api/tasks', { title: 'Water plants' })).body.task
    const res = await owner.post(`/api/tasks/${task.id}/complete`, {})
    expect(res.body.task.status).toBe('done')
    expect(res.body.comment).toBeNull()
    expect(res.body.task.updatedBy.displayName).toBe('Olivia Owner')
  })

  it('core proof: human-created task and document, agent completes, human sees it after invalidation', async () => {
    const task = (await owner.post('/api/tasks', { title: 'Write onboarding email', status: 'ready' })).body.task
    const doc = (await owner.post('/api/documents', { title: 'Tone of voice', body: 'Friendly, short sentences.' })).body.document
    await owner.post(`/api/documents/${doc.id}/links`, { taskId: task.id })
    const stream = await openEvents(owner)
    try {
      const ready = await mcp.ok('list_tasks', { status: ['ready'], assigneeId: ['none'], q: 'onboarding' })
      expect(ready.items.map((t: any) => t.id)).toContain(task.id)
      await mcp.ok('claim_task', { id: task.id })
      const context = await mcp.ok('get_task_context', { id: task.id })
      expect(context.documents.items[0].body).toBe('Friendly, short sentences.')
      await mcp.ok('add_comment', { taskId: task.id, body: 'Drafting now.' })
      const done = await mcp.ok('complete_task', { id: task.id, summary: 'Draft saved as document "Onboarding email v1".' })
      const notice = await stream.waitFor((e) => e.event === 'invalidate' && e.data.activityId === done.activityId)
      expect(notice.data.resources).toEqual(expect.arrayContaining([{ type: 'task', id: task.id }]))
      const seen = (await owner.get(`/api/tasks/${task.id}`)).body.task
      expect(seen).toMatchObject({ status: 'done', assignee: { kind: 'agent', displayName: 'Finisher' } })
      const comments = (await owner.get(`/api/tasks/${task.id}/comments`)).body.items
      expect(comments.map((c: any) => [c.kind, c.author.kind])).toEqual([
        ['comment', 'agent'],
        ['completion_summary', 'agent'],
      ])
    } finally {
      stream.close()
    }
  })
})
