import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { HttpClient, agentClient, bootstrapOwner, createAgent, inviteHuman, type AgentHandle } from '../helpers/client'
import { activityFor } from '../helpers/db'

let app: RunningApp
let owner: HttpClient
let bob: HttpClient
let bobId: string
let agent: AgentHandle
let untitledId: string

beforeAll(async () => {
  app = await startApp()
  owner = await bootstrapOwner(app)
  bob = await inviteHuman(owner, 'bob', 'Bob')
  bobId = (await bob.get('/api/auth/me')).body.actor.id
  agent = await createAgent(owner, 'Worker')
  untitledId = (await owner.get('/api/projects')).body.items.find((p: any) => p.isSystem).id
})
afterAll(async () => app?.stop())

describe('task creation', () => {
  it('creates a task from only a title in Untitled with defaults and creator', async () => {
    const res = await owner.post('/api/tasks', { title: 'Write the README' })
    expect(res.status).toBe(201)
    expect(res.body.task).toMatchObject({
      title: 'Write the README',
      description: '',
      status: 'backlog',
      priority: 'none',
      dueAt: null,
      assignee: null,
      labels: [],
      completedAt: null,
      archivedAt: null,
      project: { id: untitledId, name: 'Untitled', isSystem: true },
      createdBy: { kind: 'human', displayName: 'Olivia Owner' },
    })
    expect(res.body.task.id).toMatch(/^tsk_/)
    expect(res.body.activityId).toMatch(/^act_/)
    const events = activityFor(app, res.body.task.id)
    expect(events).toHaveLength(1)
    expect(events[0].verb).toBe('task.created')
  })

  it('creates a task in an explicit active project and rejects missing or archived destinations', async () => {
    const project = (await owner.post('/api/projects', { name: 'Platform' })).body.project
    const res = await bob.post('/api/tasks', {
      title: 'Add rate limits',
      projectId: project.id,
      status: 'ready',
      priority: 'high',
      dueAt: '2030-01-15',
      assigneeId: agent.id,
      labels: ['security', 'api'],
    })
    expect(res.status).toBe(201)
    expect(res.body.task).toMatchObject({
      project: { id: project.id },
      status: 'ready',
      priority: 'high',
      dueAt: '2030-01-15T23:59:59.999Z',
      assignee: { id: agent.id, kind: 'agent' },
      labels: ['security', 'api'],
    })

    const missing = await bob.post('/api/tasks', { title: 'x', projectId: 'prj_nope' })
    expect(missing.status).toBe(404)
    expect(missing.body.error.code).toBe('NOT_FOUND')

    const archived = (await owner.post('/api/projects', { name: 'Old' })).body.project
    await owner.post(`/api/projects/${archived.id}/archive`)
    const rejected = await bob.post('/api/tasks', { title: 'x', projectId: archived.id })
    expect(rejected.status).toBe(409)
    expect(rejected.body.error.code).toBe('INVALID_STATE')

    const badAssignee = await bob.post('/api/tasks', { title: 'x', assigneeId: 'usr_ghost' })
    expect(badAssignee.body.error.code).toBe('NOT_FOUND')
    const badStatus = await bob.post('/api/tasks', { title: 'x', status: 'doing' })
    expect(badStatus.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('accepts every fixed status and priority value', async () => {
    for (const status of ['backlog', 'ready', 'in_progress', 'blocked', 'done', 'canceled']) {
      for (const priority of ['none', 'low', 'medium', 'high', 'urgent']) {
        const res = await owner.post('/api/tasks', { title: `${status}/${priority}`, status, priority })
        expect(res.status).toBe(201)
      }
    }
  })
})

describe('task updates', () => {
  it('allows any status transition and records actor with before/after values', async () => {
    const id = (await owner.post('/api/tasks', { title: 'Flexible' })).body.task.id
    const path = ['done', 'backlog', 'blocked', 'canceled', 'ready', 'in_progress', 'done', 'blocked']
    for (const status of path) {
      const res = await bob.patch(`/api/tasks/${id}`, { status })
      expect(res.status).toBe(200)
      expect(res.body.task.status).toBe(status)
    }
    const events = activityFor(app, id).filter((e) => e.verb === 'task.updated')
    expect(events).toHaveLength(path.length)
    expect(events[0].data.changes.status).toEqual({ from: 'backlog', to: 'done' })
    expect(events[1].data.changes.status).toEqual({ from: 'done', to: 'backlog' })
    expect(events.every((e) => e.actor_id === bobId)).toBe(true)
  })

  it('sets completion time on done, preserves assignee, and clears it when reopened', async () => {
    const id = (await owner.post('/api/tasks', { title: 'Ship', assigneeId: bobId, status: 'in_progress' })).body.task.id
    const done = await owner.patch(`/api/tasks/${id}`, { status: 'done' })
    expect(done.body.task.completedAt).toBeTruthy()
    expect(done.body.task.assignee.id).toBe(bobId)

    const reopened = await owner.patch(`/api/tasks/${id}`, { status: 'ready' })
    expect(reopened.body.task.completedAt).toBeNull()
    expect(reopened.body.task.assignee.id).toBe(bobId)
    const verbs = activityFor(app, id).map((e) => e.data.changes?.status?.to)
    expect(verbs).toContain('done')
    expect(verbs).toContain('ready')
  })

  it('assigns, reassigns, clears assignee and moves between projects', async () => {
    const id = (await owner.post('/api/tasks', { title: 'Triage' })).body.task.id
    expect((await owner.patch(`/api/tasks/${id}`, { assigneeId: bobId })).body.task.assignee.displayName).toBe('Bob')
    expect((await owner.patch(`/api/tasks/${id}`, { assigneeId: agent.id })).body.task.assignee.kind).toBe('agent')
    expect((await owner.patch(`/api/tasks/${id}`, { assigneeId: null })).body.task.assignee).toBeNull()
    const project = (await owner.post('/api/projects', { name: 'Sorted' })).body.project
    const moved = await owner.patch(`/api/tasks/${id}`, { projectId: project.id, dueAt: '2031-02-03T10:00:00+07:00' })
    expect(moved.body.task.project.id).toBe(project.id)
    expect(moved.body.task.dueAt).toBe('2031-02-03T03:00:00.000Z')
    expect((await owner.patch(`/api/tasks/${id}`, { dueAt: null })).body.task.dueAt).toBeNull()
  })

  it('applies overlapping writes last-write-wins and keeps both activity events', async () => {
    const id = (await owner.post('/api/tasks', { title: 'Original' })).body.task.id
    const [a, b] = await Promise.all([owner.patch(`/api/tasks/${id}`, { title: 'Owner title' }), bob.patch(`/api/tasks/${id}`, { title: 'Bob title' })])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    const titleEvents = activityFor(app, id).filter((e) => e.verb === 'task.updated')
    expect(titleEvents).toHaveLength(2)
    const lastWritten = titleEvents[1].data.changes.title.to
    expect((await owner.get(`/api/tasks/${id}`)).body.task.title).toBe(lastWritten)

    // sequential: คนที่เขียนทีหลังชนะเสมอ ไม่มี conflict error
    await owner.patch(`/api/tasks/${id}`, { description: 'from owner' })
    await bob.patch(`/api/tasks/${id}`, { description: 'from bob' })
    expect((await owner.get(`/api/tasks/${id}`)).body.task.description).toBe('from bob')
  })

  it('prevents agents from marking work done without the completion flow', async () => {
    const id = (await owner.post('/api/tasks', { title: 'Agent work', status: 'in_progress' })).body.task.id
    const res = await agentClient(app, agent).patch(`/api/tasks/${id}`, { status: 'done' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('INVALID_STATE')
    expect((await agentClient(app, agent).patch(`/api/tasks/${id}`, { status: 'blocked' })).status).toBe(200)
  })
})

describe('archive and restore', () => {
  it('omits archived tasks from active queries and restores with the same identity', async () => {
    const id = (await owner.post('/api/tasks', { title: 'Archivable unique' })).body.task.id
    const archived = await owner.post(`/api/tasks/${id}/archive`)
    expect(archived.body.task.archivedAt).toBeTruthy()

    const active = await owner.get(`/api/tasks?limit=200`)
    expect(active.body.items.some((t: any) => t.id === id)).toBe(false)
    const archivedList = await owner.get(`/api/tasks?archived=archived`)
    expect(archivedList.body.items.some((t: any) => t.id === id)).toBe(true)
    expect((await owner.patch(`/api/tasks/${id}`, { title: 'nope' })).body.error.code).toBe('INVALID_STATE')

    const restored = await bob.post(`/api/tasks/${id}/restore`)
    expect(restored.body.task).toMatchObject({ id, archivedAt: null, title: 'Archivable unique' })
    expect(activityFor(app, id).map((e) => e.verb)).toEqual(['task.created', 'task.archived', 'task.restored'])
  })

  it('exposes task activity newest first with pagination', async () => {
    const id = (await owner.post('/api/tasks', { title: 'History' })).body.task.id
    for (let i = 0; i < 3; i++) await owner.patch(`/api/tasks/${id}`, { title: `History ${i}` })
    const first = await owner.get(`/api/tasks/${id}/activity?limit=2`)
    expect(first.body.items).toHaveLength(2)
    expect(first.body.items[0].data.changes.title.to).toBe('History 2')
    expect(first.body.items[0].actor.displayName).toBe('Olivia Owner')
    const second = await owner.get(`/api/tasks/${id}/activity?limit=2&cursor=${first.body.nextCursor}`)
    expect(second.body.items.map((e: any) => e.verb)).toEqual(['task.updated', 'task.created'])
    expect(second.body.nextCursor).toBeNull()
  })
})

describe('mutation atomicity', () => {
  it('rolls back the resource change when its activity event cannot be written', async () => {
    const faulty = await startApp({ env: { ALICE_TEST_FAIL_ACTIVITY_VERB: 'task.archived' } })
    try {
      const o = await bootstrapOwner(faulty)
      const id = (await o.post('/api/tasks', { title: 'Atomic' })).body.task.id
      const res = await o.post(`/api/tasks/${id}/archive`)
      expect(res.status).toBe(500)
      expect(res.body.error.code).toBe('INTERNAL_ERROR')
      const after = await o.get(`/api/tasks/${id}`)
      expect(after.body.task.archivedAt).toBeNull()
      expect(after.body.task.updatedAt).toBe(after.body.task.createdAt)
      expect(activityFor(faulty, id).map((e) => e.verb)).toEqual(['task.created'])
    } finally {
      await faulty.stop()
    }
  })
})
