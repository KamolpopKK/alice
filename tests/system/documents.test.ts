import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { HttpClient, bootstrapOwner, createAgent, inviteHuman, type AgentHandle } from '../helpers/client'
import { activityFor, inspectDb } from '../helpers/db'
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
  it('a repeated create or link with the same save-attempt key makes one document and one link', async () => {
    const task = (await owner.post('/client/v1/tasks', { title: 'Retry target' })).body.task
    const before = (await owner.get('/client/v1/documents?archived=all&limit=200')).body.items.length
    const payload = { title: 'Retried save', body: 'Once only' }
    const first = await owner.request('POST', '/client/v1/documents', payload, { 'idempotency-key': 'save-attempt-0001' })
    const again = await owner.request('POST', '/client/v1/documents', payload, { 'idempotency-key': 'save-attempt-0001' })
    expect(first.status).toBe(201)
    expect(again.headers.get('idempotent-replayed')).toBe('true')
    expect(again.body.document.id).toBe(first.body.document.id)
    expect((await owner.get('/client/v1/documents?archived=all&limit=200')).body.items.length).toBe(before + 1)
    const id = first.body.document.id
    for (let i = 0; i < 2; i++) expect((await owner.request('POST', `/client/v1/documents/${id}/links`, { taskId: task.id }, { 'idempotency-key': 'link-attempt-0001' })).status).toBeLessThan(300)
    expect((await owner.get(`/client/v1/documents/${id}`)).body.document.links.tasks.map((t: { id: string }) => t.id)).toEqual([task.id])
  })

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

  it('stores normalized knowledge metadata without creating content revisions', async () => {
    const created = await owner.post('/api/documents', {
      title: 'Knowledge base',
      body: 'Reusable guidance',
      tags: [' Platform ', 'platform', 'Runbook'],
      searchKeywords: [' K8s ', 'k8s', 'Kubernetes'],
      status: 'draft',
      ownerId: agent.id,
    })
    expect(created.status).toBe(201)
    expect(created.body.document).toMatchObject({
      revision: 1,
      tags: ['Platform', 'Runbook'],
      searchKeywords: ['K8s', 'Kubernetes'],
      status: 'draft',
      owner: { id: agent.id, kind: 'agent' },
      reviewedAt: null,
      reviewedBy: null,
      reviewedRevision: null,
    })

    const id = created.body.document.id
    const updated = await mcp.ok('update_document', { id, tags: ['Operations'], searchKeywords: [], ownerId: null, status: 'unreviewed' })
    expect(updated.document).toMatchObject({ revision: 1, tags: ['Operations'], searchKeywords: [], owner: null, status: 'unreviewed' })
    expect((await owner.get(`/api/documents/${id}/revisions`)).body.items).toHaveLength(1)

    const directCurrent = await owner.patch(`/api/documents/${id}`, { status: 'current' })
    expect(directCurrent.status).toBe(409)
    expect(directCurrent.body.error.code).toBe('INVALID_STATE')

    const inactive = await createAgent(owner, 'Inactive knowledge owner')
    await owner.post(`/api/agents/${inactive.id}/deactivate`)
    const invalidOwner = await owner.patch(`/api/documents/${id}`, { ownerId: inactive.id })
    expect(invalidOwner.body.error.code).toBe('INVALID_STATE')
  })

  it('records reviews against an expected revision and clears them on content changes', async () => {
    const doc = (await owner.post('/api/documents', { title: 'Reviewed runbook', body: 'v1' })).body.document
    const reviewed = await mcp.ok('review_document', { id: doc.id, expectedRevision: 1 })
    expect(reviewed.document).toMatchObject({ status: 'current', reviewedBy: { id: agent.id }, reviewedRevision: 1 })
    expect(reviewed.document.reviewedAt).toEqual(expect.any(String))

    const stale = await owner.post(`/api/documents/${doc.id}/review`, { expectedRevision: 2 })
    expect(stale.status).toBe(409)
    expect(stale.body.error).toMatchObject({ code: 'CONFLICT', details: { currentRevision: 1 } })

    const metadataOnly = await owner.patch(`/api/documents/${doc.id}`, { tags: ['runbook'] })
    expect(metadataOnly.body.document).toMatchObject({ revision: 1, status: 'current', reviewedRevision: 1 })

    const edited = await owner.patch(`/api/documents/${doc.id}`, { body: 'v2' })
    expect(edited.body.document).toMatchObject({
      revision: 2,
      status: 'unreviewed',
      reviewedAt: null,
      reviewedBy: null,
      reviewedRevision: null,
    })

    const kept = await mcp.ok('review_document', { id: doc.id, expectedRevision: 2, markCurrent: false })
    expect(kept.document).toMatchObject({ status: 'unreviewed', reviewedRevision: 2 })
    const current = await owner.post(`/api/documents/${doc.id}/review`, { expectedRevision: 2 })
    expect(current.body.document.status).toBe('current')
    const cleared = await mcp.ok('clear_document_review', { id: doc.id, expectedRevision: 2 })
    expect(cleared.document).toMatchObject({ status: 'unreviewed', reviewedAt: null, reviewedRevision: null })
  })

  it('rolls review state back when its activity write fails', async () => {
    const faulty = await startApp({ env: { ALICE_TEST_FAIL_ACTIVITY_VERB: 'document.reviewed' } })
    try {
      const client = await bootstrapOwner(faulty)
      const doc = (await client.post('/api/documents', { title: 'Atomic review', body: 'content' })).body.document
      const failed = await client.post(`/api/documents/${doc.id}/review`, { expectedRevision: 1 })
      expect(failed.status).toBe(500)
      expect((await client.get(`/api/documents/${doc.id}`)).body.document).toMatchObject({
        status: 'unreviewed',
        reviewedAt: null,
        reviewedBy: null,
        reviewedRevision: null,
      })
    } finally {
      await faulty.stop()
    }
  })

  it('creates, pages and removes typed relations with symmetric and cycle-safe semantics', async () => {
    const a = (await owner.post('/api/documents', { title: 'Relation A', body: 'A' })).body.document
    const b = (await owner.post('/api/documents', { title: 'Relation B', body: 'B' })).body.document
    const c = (await owner.post('/api/documents', { title: 'Relation C', body: 'C' })).body.document

    expect((await owner.post(`/api/documents/${a.id}/relations`, { targetId: b.id, type: 'references' })).body.changed).toBe(true)
    expect((await mcp.ok('link_document_relation', { id: a.id, targetId: b.id, type: 'references' })).changed).toBe(false)
    expect((await mcp.ok('link_document_relation', { id: a.id, targetId: c.id, type: 'related' })).changed).toBe(true)
    expect((await owner.post(`/api/documents/${c.id}/relations`, { targetId: a.id, type: 'related' })).body.changed).toBe(false)

    const outgoingA = await mcp.ok('list_document_relations', { id: a.id, direction: 'outgoing' })
    expect(outgoingA.items.map((r: any) => [r.type, r.document.id])).toEqual([
      ['references', b.id],
      ['related', c.id],
    ])
    expect((await owner.get(`/api/documents/${b.id}/relations?direction=incoming`)).body.items[0]).toMatchObject({
      type: 'references',
      direction: 'incoming',
      document: { id: a.id, status: 'unreviewed' },
      createdBy: { kind: 'human' },
    })
    expect((await owner.get(`/api/documents/${c.id}/relations?direction=incoming&type=related`)).body.items[0].document.id).toBe(a.id)
    expect((await owner.get(`/api/documents/${c.id}/relations?direction=outgoing&type=related`)).body.items[0].document.id).toBe(a.id)

    expect((await owner.post(`/api/documents/${a.id}/relations`, { targetId: a.id, type: 'references' })).body.error.code).toBe('INVALID_RELATIONSHIP')
    expect((await owner.post(`/api/documents/${a.id}/relations`, { targetId: b.id, type: 'supersedes' })).body.error.code).toBe('INVALID_STATE')

    await owner.post(`/api/documents/${b.id}/review`, { expectedRevision: 1 })
    const stream = await openEvents(owner)
    try {
      const supersedes = await mcp.ok('link_document_relation', { id: a.id, targetId: b.id, type: 'supersedes', acknowledgeSupersedes: true })
      expect(supersedes.changed).toBe(true)
      await stream.waitFor((event) =>
        event.event === 'invalidate' &&
        event.data.resources.some((r: any) => r.id === a.id) &&
        event.data.resources.some((r: any) => r.id === b.id),
      )
    } finally {
      stream.close()
    }
    expect((await owner.get(`/api/documents/${b.id}`)).body.document.status).toBe('superseded')
    expect((await owner.post(`/api/documents/${b.id}/relations`, { targetId: a.id, type: 'supersedes', acknowledgeSupersedes: true })).body.error.code).toBe(
      'RELATIONSHIP_CYCLE',
    )
    expect((await mcp.ok('unlink_document_relation', { id: a.id, targetId: b.id, type: 'supersedes' })).changed).toBe(true)
    expect((await mcp.ok('unlink_document_relation', { id: a.id, targetId: b.id, type: 'supersedes' })).changed).toBe(false)
    expect((await owner.get(`/api/documents/${b.id}`)).body.document.status).toBe('superseded')

    const extras: string[] = []
    for (let i = 0; i < 5; i++) {
      const extra = (await owner.post('/api/documents', { title: `Relation extra ${i}`, body: String(i) })).body.document
      extras.push(extra.id)
      await owner.post(`/api/documents/${a.id}/relations`, { targetId: extra.id, type: 'references' })
    }
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const page: any = await owner.get(`/api/documents/${a.id}/relations?direction=outgoing&type=references&limit=2${cursor ? `&cursor=${cursor}` : ''}`)
      seen.push(...page.body.items.map((r: any) => r.document.id))
      cursor = page.body.nextCursor
    } while (cursor)
    expect(seen).toEqual(expect.arrayContaining([b.id, ...extras]))
    expect(new Set(seen).size).toBe(6)

    await owner.post(`/api/documents/${c.id}/archive`)
    expect((await owner.post(`/api/documents/${a.id}/relations`, { targetId: c.id, type: 'references' })).body.error.code).toBe('INVALID_STATE')
  })

  it('rolls back supersedes edge, status, activity and invalidation when recording fails', async () => {
    const faulty = await startApp({ env: { ALICE_TEST_FAIL_ACTIVITY_VERB: 'document.superseded' } })
    try {
      const client = await bootstrapOwner(faulty)
      const source = (await client.post('/api/documents', { title: 'New policy', body: 'new' })).body.document
      const target = (await client.post('/api/documents', { title: 'Old policy', body: 'old' })).body.document
      const beforeEvents = inspectDb(faulty, (db) => (db.prepare('SELECT count(*) AS n FROM client_events').get() as { n: number }).n)
      const failed = await client.post(`/api/documents/${source.id}/relations`, {
        targetId: target.id,
        type: 'supersedes',
        acknowledgeSupersedes: true,
      })
      expect(failed.status).toBe(500)
      expect((await client.get(`/api/documents/${target.id}`)).body.document.status).toBe('unreviewed')
      expect((await client.get(`/api/documents/${source.id}/relations`)).body.items).toHaveLength(0)
      expect(activityFor(faulty, source.id).map((event) => event.verb)).toEqual(['document.created'])
      expect(activityFor(faulty, target.id).map((event) => event.verb)).toEqual(['document.created'])
      expect(inspectDb(faulty, (db) => (db.prepare('SELECT count(*) AS n FROM client_events').get() as { n: number }).n)).toBe(beforeEvents)
    } finally {
      await faulty.stop()
    }
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

  it('ranks and explains metadata-aware search while composing document filters', async () => {
    const p1 = (await owner.post('/api/projects', { name: 'Knowledge Alpha' })).body.project
    const p2 = (await owner.post('/api/projects', { name: 'Knowledge Beta' })).body.project
    const title = (await owner.post('/api/documents', {
      title: 'Phoenix handbook',
      body: 'general notes',
      tags: ['platform'],
      status: 'draft',
      ownerId: agent.id,
    })).body.document
    const keyword = (await owner.post('/api/documents', {
      title: 'Alias guide',
      body: 'general notes',
      searchKeywords: ['Phoenix'],
      tags: ['operations'],
      status: 'unreviewed',
    })).body.document
    const tag = (await owner.post('/api/documents', { title: 'Tagged guide', body: 'general notes', tags: ['Phoenix'], status: 'superseded' })).body.document
    const body = (await owner.post('/api/documents', { title: 'Body guide', body: 'The Phoenix procedure', tags: ['platform'] })).body.document
    const source = (await owner.post('/api/documents', { title: 'Source guide', sourceUrl: 'https://phoenix.example.test/runbook', tags: ['platform'] })).body.document
    await owner.post(`/api/documents/${body.id}/review`, { expectedRevision: 1 })
    await owner.post(`/api/documents/${title.id}/links`, { projectId: p1.id })
    await owner.post(`/api/documents/${keyword.id}/links`, { projectId: p2.id })

    const results = (await owner.get('/api/search?q=phoenix&kind=document')).body.items
    expect(results.map((r: any) => r.id)).toEqual([title.id, keyword.id, tag.id, body.id, source.id])
    expect(results.map((r: any) => r.match.field)).toEqual(['title', 'keyword', 'tag', 'body', 'sourceUrl'])
    expect(results[1]).toMatchObject({
      match: { field: 'keyword', value: 'Phoenix' },
      tags: ['operations'],
      status: 'unreviewed',
      owner: null,
      projectContext: { items: [{ id: p2.id }], total: 1 },
    })

    const documentResults = (await owner.get(`/api/documents?q=phoenix&tag=platform,operations&status=current,draft,unreviewed&ownerId=${agent.id},none&projectId=${p1.id},${p2.id}`)).body.items
    expect(documentResults.map((d: any) => d.id)).toEqual([title.id, keyword.id])
    expect(documentResults.every((d: any) => d.match?.field)).toBe(true)

    const titleCurrent = (await owner.post('/api/documents', { title: 'Lifecycle Phoenix', body: 'current' })).body.document
    const titleDraft = (await owner.post('/api/documents', { title: 'Lifecycle Phoenix', body: 'draft', status: 'draft' })).body.document
    const titleSuperseded = (await owner.post('/api/documents', { title: 'Lifecycle Phoenix', body: 'old', status: 'superseded' })).body.document
    await owner.post(`/api/documents/${titleCurrent.id}/review`, { expectedRevision: 1 })
    const lifecycle = (await owner.get('/api/search?q=lifecycle%20phoenix&kind=document')).body.items
    expect(lifecycle.map((r: any) => r.id)).toEqual([titleCurrent.id, titleDraft.id, titleSuperseded.id])

    await owner.post(`/api/documents/${source.id}/archive`)
    expect((await owner.get('/api/search?q=phoenix.example&kind=document')).body.items).toHaveLength(0)
    expect((await owner.get('/api/search?q=phoenix.example&kind=document&archived=all')).body.items[0]).toMatchObject({ id: source.id, archived: true })
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
