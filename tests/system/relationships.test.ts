import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { HttpClient, bootstrapOwner, createAgent } from '../helpers/client'
import { activityFor } from '../helpers/db'
import { connectMcp, type McpHandle } from '../helpers/mcp'
import { openEvents } from '../helpers/sse'

let app: RunningApp
let owner: HttpClient
let mcp: McpHandle

const newTask = async (title: string, extra: Record<string, unknown> = {}) => (await owner.post('/api/tasks', { title, ...extra })).body.task

beforeAll(async () => {
  app = await startApp()
  owner = await bootstrapOwner(app)
  const agent = await createAgent(owner, 'Planner')
  mcp = await connectMcp(app.url, agent.token)
})
afterAll(async () => {
  await mcp?.close()
  await app?.stop()
})

describe('parent and children', () => {
  it('reflects the relationship on both sides and in list indicators', async () => {
    const epic = await newTask('Epic')
    const child = await newTask('Child A')
    const set = await owner.put(`/api/tasks/${child.id}/parent`, { parentId: epic.id })
    expect(set.status).toBe(200)
    expect(set.body.task.parentId).toBe(epic.id)
    const viaCreate = await mcp.ok('create_task', { title: 'Child B', parentId: epic.id })
    expect(viaCreate.task.parentId).toBe(epic.id)

    const rel = (await owner.get(`/api/tasks/${epic.id}/relations`)).body
    expect(rel.children.map((t: any) => t.title)).toEqual(['Child A', 'Child B'])
    expect((await owner.get(`/api/tasks/${child.id}/relations`)).body.parent).toMatchObject({ id: epic.id, title: 'Epic' })
    expect((await owner.get(`/api/tasks/${epic.id}`)).body.task.childCount).toBe(2)
    const children = await mcp.ok('list_tasks', { parentId: epic.id })
    expect(children.items).toHaveLength(2)

    const cleared = await mcp.ok('set_task_parent', { id: child.id, parentId: null })
    expect(cleared.task.parentId).toBeNull()
    expect(activityFor(app, child.id).filter((e) => e.verb === 'task.parent_changed')).toHaveLength(2)
  })

  it('rejects self-parenting and parent cycles without partial writes', async () => {
    const a = await newTask('A')
    const b = await newTask('B', { parentId: a.id })
    const c = await newTask('C', { parentId: b.id })
    expect((await owner.put(`/api/tasks/${a.id}/parent`, { parentId: a.id })).body.error.code).toBe('INVALID_RELATIONSHIP')
    const cycle = await mcp.call('set_task_parent', { id: a.id, parentId: c.id })
    expect(cycle.error!.code).toBe('RELATIONSHIP_CYCLE')
    expect((await owner.get(`/api/tasks/${a.id}`)).body.task.parentId).toBeNull()
    expect(activityFor(app, a.id).map((e) => e.verb)).toEqual(['task.created'])
    expect((await owner.put(`/api/tasks/${a.id}/parent`, { parentId: 'tsk_missing' })).body.error.code).toBe('NOT_FOUND')
  })
})

describe('blockers', () => {
  it('adds and removes blockers consistently across task detail and MCP context', async () => {
    const api = await newTask('Build API')
    const ui = await newTask('Build UI')
    const added = await owner.post(`/api/tasks/${ui.id}/blockers`, { blockerId: api.id })
    expect(added.body.task.openBlockerCount).toBe(1)
    expect(added.body.activityId).toMatch(/^act_/)
    const context = await mcp.ok('get_task_context', { id: ui.id })
    expect(context.blockers).toEqual({ total: 1, items: [expect.objectContaining({ id: api.id, title: 'Build API' })] })
    const apiContext = await mcp.ok('get_task_context', { id: api.id })
    expect(apiContext.blocking.items.map((t: any) => t.id)).toEqual([ui.id])
    expect((await mcp.ok('list_tasks', { blockersOf: ui.id })).items.map((t: any) => t.id)).toEqual([api.id])
    expect((await mcp.ok('list_tasks', { dependentsOf: api.id })).items.map((t: any) => t.id)).toEqual([ui.id])

    await owner.patch(`/api/tasks/${api.id}`, { status: 'done' })
    expect((await owner.get(`/api/tasks/${ui.id}`)).body.task.openBlockerCount).toBe(0)

    const removed = await mcp.ok('remove_task_blocker', { id: ui.id, blockerId: api.id })
    expect(removed.task.openBlockerCount).toBe(0)
    expect((await owner.get(`/api/tasks/${ui.id}/relations`)).body.blockers).toEqual([])
    expect((await mcp.call('remove_task_blocker', { id: ui.id, blockerId: api.id })).error!.code).toBe('NOT_FOUND')
  })

  it('rejects self-blocking, duplicates and direct or indirect cycles atomically', async () => {
    const a = await newTask('Step A')
    const b = await newTask('Step B')
    const c = await newTask('Step C')
    await owner.post(`/api/tasks/${b.id}/blockers`, { blockerId: a.id }) // b waits on a
    await owner.post(`/api/tasks/${c.id}/blockers`, { blockerId: b.id }) // c waits on b
    expect((await owner.post(`/api/tasks/${a.id}/blockers`, { blockerId: a.id })).body.error.code).toBe('INVALID_RELATIONSHIP')
    expect((await owner.post(`/api/tasks/${b.id}/blockers`, { blockerId: a.id })).body.error.code).toBe('INVALID_RELATIONSHIP')
    expect((await mcp.call('add_task_blocker', { id: a.id, blockerId: b.id })).error!.code).toBe('RELATIONSHIP_CYCLE')
    expect((await mcp.call('add_task_blocker', { id: a.id, blockerId: c.id })).error!.code).toBe('RELATIONSHIP_CYCLE')
    expect((await owner.get(`/api/tasks/${a.id}/relations`)).body.blockers).toEqual([])
    expect(activityFor(app, a.id).map((e) => e.verb)).toEqual(['task.created'])
  })

  it('keeps relationships to archived tasks visible with their archive state', async () => {
    const parent = await newTask('Archived parent')
    const blocker = await newTask('Archived blocker')
    const t = await newTask('Survivor', { parentId: parent.id })
    await owner.post(`/api/tasks/${t.id}/blockers`, { blockerId: blocker.id })
    await owner.post(`/api/tasks/${parent.id}/archive`)
    await owner.post(`/api/tasks/${blocker.id}/archive`)
    const rel = (await owner.get(`/api/tasks/${t.id}/relations`)).body
    expect(rel.parent).toMatchObject({ id: parent.id })
    expect(rel.parent.archivedAt).toBeTruthy()
    expect(rel.blockers[0]).toMatchObject({ id: blocker.id })
    expect(rel.blockers[0].archivedAt).toBeTruthy()
    const context = await mcp.ok('get_task_context', { id: t.id })
    expect(context.parent.archivedAt).toBeTruthy()
  })

  it('records one attributed event per relationship change and invalidates browsers', async () => {
    const a = await newTask('Watched A')
    const b = await newTask('Watched B')
    const stream = await openEvents(owner)
    try {
      const res = await mcp.ok('add_task_blocker', { id: a.id, blockerId: b.id })
      const notice = await stream.waitFor((e) => e.event === 'invalidate' && e.data.activityId === res.activityId)
      expect(notice.data.resources).toEqual(expect.arrayContaining([{ type: 'task', id: a.id }, { type: 'task', id: b.id }]))
      const events = activityFor(app, a.id).filter((e) => e.verb === 'task.blocker_added')
      expect(events).toHaveLength(1)
      expect(events[0].data.blockerId).toBe(b.id)
    } finally {
      stream.close()
    }
  })
})
