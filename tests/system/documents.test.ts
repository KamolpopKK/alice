import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { HttpClient, bootstrapOwner, createAgent, inviteHuman, type AgentHandle } from '../helpers/client'
import { activityFor } from '../helpers/db'
import { connectMcp, type McpHandle } from '../helpers/mcp'
import { openEvents } from '../helpers/sse'

let app: RunningApp
let owner: HttpClient
let bob: HttpClient
let agent: AgentHandle
let mcp: McpHandle

beforeAll(async () => {
  app = await startApp()
  owner = await bootstrapOwner(app)
  bob = await inviteHuman(owner, 'bob', 'Bob')
  agent = await createAgent(owner, 'Doc Agent')
  mcp = await connectMcp(app.url, agent.token)
})
afterAll(async () => {
  await mcp?.close()
  await app?.stop()
})

describe('documents', () => {
  it('requires a body or source URL and is readable from web and MCP', async () => {
    const empty = await owner.post('/api/documents', { title: 'Empty' })
    expect(empty.status).toBe(400)
    expect(empty.body.error.code).toBe('VALIDATION_ERROR')
    expect((await mcp.call('create_document', { title: 'Empty', body: '   ' })).error!.code).toBe('VALIDATION_ERROR')
    expect((await owner.post('/api/documents', { title: 'Bad', sourceUrl: 'javascript:alert(1)' })).status).toBe(400)

    const linkOnly = await owner.post('/api/documents', { title: 'RFC 9110', sourceUrl: 'https://www.rfc-editor.org/rfc/rfc9110' })
    expect(linkOnly.status).toBe(201)
    expect(linkOnly.body.document).toMatchObject({ title: 'RFC 9110', body: '', revision: 1, sourceUrl: 'https://www.rfc-editor.org/rfc/rfc9110' })

    const withBody = await owner.post('/api/documents', { title: 'Style guide', body: '# Voice\nBe brief.' })
    const viaMcp = await mcp.ok('get_document', { id: withBody.body.document.id })
    expect(viaMcp.document).toMatchObject({ title: 'Style guide', body: '# Voice\nBe brief.', bodyWindow: { truncated: false, totalChars: 17 } })

    // ลบ body ออกจนไม่เหลือทั้ง body และ URL ต้องถูกปฏิเสธ
    expect((await owner.patch(`/api/documents/${withBody.body.document.id}`, { body: '' })).body.error.code).toBe('VALIDATION_ERROR')
  })

  it('keeps every edit as a full revision and restores older ones as a new revision', async () => {
    const doc = (await owner.post('/api/documents', { title: 'Runbook', body: 'v1 body' })).body.document
    await bob.patch(`/api/documents/${doc.id}`, { body: 'v2 body' })
    const v3 = await mcp.ok('update_document', { id: doc.id, title: 'Runbook (agent)', body: 'v3 body' })
    expect(v3.document).toMatchObject({ revision: 3, title: 'Runbook (agent)', updatedBy: { kind: 'agent' } })

    const revisions = (await owner.get(`/api/documents/${doc.id}/revisions`)).body.items
    expect(revisions.map((r: any) => [r.number, r.body])).toEqual([
      [3, 'v3 body'],
      [2, 'v2 body'],
      [1, 'v1 body'],
    ])
    expect(revisions[1].createdBy.displayName).toBe('Bob')

    const restored = await owner.post(`/api/documents/${doc.id}/revisions/1/restore`)
    expect(restored.body.document).toMatchObject({ revision: 4, body: 'v1 body', title: 'Runbook' })
    const after = (await mcp.ok('list_document_revisions', { id: doc.id })).items
    expect(after[0]).toMatchObject({ number: 4, restoredFrom: 1, body: 'v1 body' })
    expect(after).toHaveLength(4)
    const verbs = activityFor(app, doc.id).map((e) => e.verb)
    expect(verbs).toEqual(['document.created', 'document.updated', 'document.updated', 'document.revision_restored'])
    expect((await owner.post(`/api/documents/${doc.id}/revisions/99/restore`)).body.error.code).toBe('NOT_FOUND')
  })

  it('links one document independently to many tasks and projects', async () => {
    const doc = (await owner.post('/api/documents', { title: 'Shared spec', body: 'Spec' })).body.document
    const t1 = (await owner.post('/api/tasks', { title: 'Task one' })).body.task
    const t2 = (await owner.post('/api/tasks', { title: 'Task two' })).body.task
    const p1 = (await owner.post('/api/projects', { name: 'Proj one' })).body.project
    const p2 = (await owner.post('/api/projects', { name: 'Proj two' })).body.project

    await owner.post(`/api/documents/${doc.id}/links`, { taskId: t1.id })
    await mcp.ok('link_document', { id: doc.id, taskId: t2.id })
    await owner.post(`/api/documents/${doc.id}/links`, { projectId: p1.id })
    const last = await mcp.ok('link_document', { id: doc.id, projectId: p2.id })
    expect(last.document.links.tasks.map((t: any) => t.id)).toEqual([t1.id, t2.id])
    expect(last.document.links.projects.map((p: any) => p.id)).toEqual([p1.id, p2.id])

    const again = await mcp.ok('link_document', { id: doc.id, taskId: t1.id })
    expect(again.changed).toBe(false)
    expect((await owner.post(`/api/documents/${doc.id}/links`, { taskId: t1.id, projectId: p1.id })).body.error.code).toBe('VALIDATION_ERROR')

    const unlinked = await owner.delete(`/api/documents/${doc.id}/links`, { taskId: t1.id })
    expect(unlinked.body.changed).toBe(true)
    expect(unlinked.body.document.links.tasks.map((t: any) => t.id)).toEqual([t2.id])
    expect(unlinked.body.document.links.projects).toHaveLength(2)
    expect((await owner.get(`/api/tasks/${t1.id}`)).status).toBe(200)
    expect((await owner.get(`/api/documents/${doc.id}`)).status).toBe(200)

    const forTask = await mcp.ok('search_documents', { taskId: t2.id })
    expect(forTask.items.map((d: any) => d.id)).toEqual([doc.id])
    expect((await owner.get(`/api/documents?projectId=${p1.id}`)).body.items[0].id).toBe(doc.id)
    expect(activityFor(app, t1.id).map((e) => e.verb)).toEqual(['task.created', 'document.linked', 'document.unlinked'])
  })

  it('finds documents by title, body and source URL', async () => {
    const d1 = (await owner.post('/api/documents', { title: 'Kubernetes cheatsheet', body: 'kubectl get pods' })).body.document
    const d2 = (await owner.post('/api/documents', { title: 'Vendor contract', sourceUrl: 'https://contracts.example.com/acme-msa' })).body.document
    const d3 = (await owner.post('/api/documents', { title: 'คู่มือพนักงาน', body: 'วันลาพักร้อน 10 วัน' })).body.document
    expect((await owner.get('/api/search?q=kubernetes&kind=document')).body.items[0].id).toBe(d1.id)
    expect((await owner.get('/api/search?q=kubectl')).body.items[0]).toMatchObject({ kind: 'document', id: d1.id })
    expect((await owner.get('/api/search?q=acme-msa')).body.items[0].id).toBe(d2.id)
    expect((await mcp.ok('search_documents', { q: 'ลาพักร้อน' })).items.map((d: any) => d.id)).toEqual([d3.id])
    await owner.post(`/api/documents/${d1.id}/archive`)
    expect((await owner.get('/api/search?q=kubectl')).body.items).toHaveLength(0)
    expect((await owner.patch(`/api/documents/${d1.id}`, { body: 'x' })).body.error.code).toBe('INVALID_STATE')
    expect((await owner.post(`/api/documents/${d1.id}/restore`)).body.document.archivedAt).toBeNull()
  })

  it('windows long bodies for agents with explicit continuation', async () => {
    const body = 'x'.repeat(250)
    const doc = (await owner.post('/api/documents', { title: 'Long', body })).body.document
    const first = await mcp.ok('get_document', { id: doc.id, maxChars: 100 })
    expect(first.document.bodyWindow).toEqual({ offset: 0, returnedChars: 100, totalChars: 250, truncated: true, nextOffset: 100 })
    const last = await mcp.ok('get_document', { id: doc.id, maxChars: 100, offset: 200 })
    expect(last.document.bodyWindow).toMatchObject({ returnedChars: 50, truncated: false, nextOffset: null })
  })

  it('notifies open browser views when an agent edits or links a document', async () => {
    const doc = (await owner.post('/api/documents', { title: 'Watched doc', body: 'start' })).body.document
    const task = (await owner.post('/api/tasks', { title: 'Watched task' })).body.task
    const stream = await openEvents(owner)
    try {
      await mcp.ok('update_document', { id: doc.id, body: 'edited by agent' })
      await stream.waitForResource('document', doc.id)
      expect((await owner.get(`/api/documents/${doc.id}`)).body.document.body).toBe('edited by agent')
      await mcp.ok('link_document', { id: doc.id, taskId: task.id })
      await stream.waitForResource('task', task.id)
      expect((await owner.get(`/api/documents?taskId=${task.id}`)).body.items[0].id).toBe(doc.id)
    } finally {
      stream.close()
    }
  })
})
