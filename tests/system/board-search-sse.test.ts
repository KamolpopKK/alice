import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { HttpClient, agentClient, bootstrapOwner, createAgent, inviteHuman, type AgentHandle } from '../helpers/client'
import { openEvents } from '../helpers/sse'

let app: RunningApp
let owner: HttpClient
let bob: HttpClient
let bobId: string
let agent: AgentHandle
let alpha: string
let beta: string

beforeAll(async () => {
  app = await startApp()
  owner = await bootstrapOwner(app)
  bob = await inviteHuman(owner, 'bob', 'Bob')
  bobId = (await bob.get('/api/auth/me')).body.actor.id
  agent = await createAgent(owner, 'Indexer')
  alpha = (await owner.post('/api/projects', { name: 'Alpha' })).body.project.id
  beta = (await owner.post('/api/projects', { name: 'Beta' })).body.project.id
  const statuses = ['backlog', 'ready', 'in_progress', 'blocked', 'done', 'canceled']
  const priorities = ['none', 'low', 'medium', 'high', 'urgent']
  // 60 งาน กระจายทุก project/status/priority/assignee/label
  for (let i = 0; i < 60; i++) {
    await owner.post('/api/tasks', {
      title: `Seed task ${String(i).padStart(2, '0')}`,
      projectId: i % 2 ? alpha : beta,
      status: statuses[i % 6],
      priority: priorities[i % 5],
      assigneeId: i % 3 === 0 ? bobId : i % 3 === 1 ? agent.id : null,
      labels: i % 4 === 0 ? ['frontend'] : ['backend'],
      dueAt: i % 2 ? `2030-01-${String((i % 28) + 1).padStart(2, '0')}` : null,
    })
  }
})
afterAll(async () => app?.stop())

async function collectAll(client: HttpClient, query: string) {
  const all: any[] = []
  let cursor: string | null = null
  do {
    const res: any = await client.get(`/api/tasks?${query}&limit=7${cursor ? `&cursor=${cursor}` : ''}`)
    expect(res.status).toBe(200)
    all.push(...res.body.items)
    cursor = res.body.nextCursor
  } while (cursor)
  return all
}

describe('board and list', () => {
  it('groups active tasks into the correct status columns', async () => {
    const archivedId = (await owner.post('/api/tasks', { title: 'Archived ready', status: 'ready', projectId: alpha })).body.task.id
    await owner.post(`/api/tasks/${archivedId}/archive`)
    const res = await owner.get(`/api/board?projectId=${alpha}`)
    expect(Object.keys(res.body.columns)).toEqual(['backlog', 'ready', 'in_progress', 'blocked', 'done', 'canceled'])
    let total = 0
    for (const [status, page] of Object.entries<any>(res.body.columns)) {
      total += page.items.length
      expect(page.items.every((t: any) => t.status === status && t.project.id === alpha)).toBe(true)
    }
    expect(total).toBe(30)
    expect(res.body.columns.ready.items.length).toBe(10)
    expect(res.body.columns.ready.items.some((t: any) => t.id === archivedId)).toBe(false)
  })

  it('paginates stably with filters and every sort order without duplicates', async () => {
    for (const sort of ['updated', 'created', 'priority', 'due', 'title']) {
      for (const order of ['asc', 'desc']) {
        const all = await collectAll(owner, `sort=${sort}&order=${order}`)
        expect(all).toHaveLength(60)
        expect(new Set(all.map((t) => t.id)).size).toBe(60)
      }
    }
    const byPriority = await collectAll(owner, 'sort=priority&order=desc')
    const ranks = byPriority.map((t) => ['none', 'low', 'medium', 'high', 'urgent'].indexOf(t.priority))
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a))

    const filtered = await collectAll(owner, `projectId=${beta}&status=backlog,ready&label=frontend`)
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.every((t) => t.project.id === beta && ['backlog', 'ready'].includes(t.status) && t.labels.includes('frontend'))).toBe(true)

    const unassigned = await collectAll(owner, 'assigneeId=none')
    expect(unassigned).toHaveLength(20)
    const dueWindow = await collectAll(owner, 'dueAfter=2030-01-10&dueBefore=2030-01-20&sort=due')
    expect(dueWindow.every((t) => t.dueAt >= '2030-01-10' && t.dueAt <= '2030-01-20T23:59:59.999Z')).toBe(true)
    expect(dueWindow.map((t) => t.dueAt)).toEqual([...dueWindow.map((t) => t.dueAt)].sort())
    expect((await owner.get('/api/tasks?status=nope')).body.error.code).toBe('VALIDATION_ERROR')
  })

  it('shows My Tasks for the signed-in human', async () => {
    const mine = await collectAll(bob, 'assigneeId=me')
    expect(mine).toHaveLength(20)
    expect(mine.every((t) => t.assignee?.id === bobId)).toBe(true)
  })
})

describe('full-text search', () => {
  it('finds tasks by title or description, in English and Thai, with stable pagination', async () => {
    const t1 = (await owner.post('/api/tasks', { title: 'Implement OAuth callback', description: 'Handle the redirect from the identity provider' })).body.task.id
    const t2 = (await owner.post('/api/tasks', { title: 'ออกแบบหน้าจอต้อนรับ', description: 'สำหรับผู้ใช้ใหม่' })).body.task.id

    const byTitle = await owner.get('/api/search?q=oauth')
    expect(byTitle.body.items.map((r: any) => r.id)).toContain(t1)
    const byBody = await owner.get('/api/search?q=redirect%20provider')
    expect(byBody.body.items[0]).toMatchObject({ kind: 'task', id: t1, title: 'Implement OAuth callback' })
    const thai = await owner.get(`/api/search?q=${encodeURIComponent('หน้าจอ')}`)
    expect(thai.body.items.map((r: any) => r.id)).toEqual([t2])
    const viaList = await owner.get(`/api/tasks?q=${encodeURIComponent('ผู้ใช้')}`)
    expect(viaList.body.items.map((t: any) => t.id)).toEqual([t2])

    // ไม่ให้ operator ของ FTS5 รั่ว: เครื่องหมายพิเศษต้องไม่ทำให้ error
    for (const q of ['"', 'OR AND NOT', 'a*', 'col:x', '(', 'NEAR(a b)']) {
      expect((await owner.get(`/api/search?q=${encodeURIComponent(q)}`)).status).toBe(200)
    }

    const pages: string[] = []
    let cursor: string | null = null
    do {
      const res: any = await owner.get(`/api/search?q=seed%20task&limit=9${cursor ? `&cursor=${cursor}` : ''}`)
      pages.push(...res.body.items.map((r: any) => r.id))
      cursor = res.body.nextCursor
    } while (cursor)
    expect(pages).toHaveLength(60)
    expect(new Set(pages).size).toBe(60)
  })

  it('keeps the index in sync with edits and archive state', async () => {
    const id = (await owner.post('/api/tasks', { title: 'Zebra migration' })).body.task.id
    await owner.patch(`/api/tasks/${id}`, { title: 'Giraffe migration' })
    expect((await owner.get('/api/search?q=zebra')).body.items).toHaveLength(0)
    expect((await owner.get('/api/search?q=giraffe')).body.items[0].id).toBe(id)
    await owner.post(`/api/tasks/${id}/archive`)
    expect((await owner.get('/api/search?q=giraffe')).body.items).toHaveLength(0)
    expect((await owner.get('/api/search?q=giraffe&archived=all')).body.items[0]).toMatchObject({ id, archived: true })
  })
})

describe('activity feed', () => {
  it('lists recent activity across the workspace newest first', async () => {
    const res = await owner.get('/api/activity?limit=5')
    expect(res.body.items).toHaveLength(5)
    expect(res.body.nextCursor).toBeTruthy()
    const agentId = (await agentClient(app, agent).post('/api/tasks', { title: 'Agent-made' })).body.task.id
    const latest = (await owner.get('/api/activity?limit=1')).body.items[0]
    expect(latest).toMatchObject({ verb: 'task.created', resourceId: agentId, actor: { kind: 'agent', displayName: 'Indexer' } })
  })
})

describe('server-sent invalidation', () => {
  it('notifies other browser sessions after a mutation by a human or an agent', async () => {
    const id = (await owner.post('/api/tasks', { title: 'Watched task' })).body.task.id
    const ownerStream = await openEvents(owner)
    const bobStream = await openEvents(bob)
    try {
      const update = await bob.patch(`/api/tasks/${id}`, { status: 'ready' })
      const notice = await ownerStream.waitForResource('task', id)
      expect(notice.data.activityId).toBe((await bob.get(`/api/tasks/${id}/activity?limit=1`)).body.items[0].id)
      expect(notice.data).not.toHaveProperty('task')
      expect((await owner.get(`/api/tasks/${id}`)).body.task.status).toBe(update.body.task.status)

      await agentClient(app, agent).patch(`/api/tasks/${id}`, { status: 'in_progress' })
      await bobStream.waitFor((e) => e.event === 'invalidate' && e.data.resources.some((r: any) => r.id === id) && e !== undefined && bobStream.events.filter((x) => x.event === 'invalidate').length >= 2)
      expect((await bob.get(`/api/tasks/${id}`)).body.task.status).toBe('in_progress')
    } finally {
      ownerStream.close()
      bobStream.close()
    }
  })

  it('requires authentication for the event stream', async () => {
    const res = await fetch(`${app.url}/api/events`)
    expect(res.status).toBe(401)
  })
})
