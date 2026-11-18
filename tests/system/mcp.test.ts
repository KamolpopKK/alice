import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { HttpClient, bootstrapOwner, createAgent, type AgentHandle } from '../helpers/client'
import { activityFor } from '../helpers/db'
import { connectMcp, type McpHandle } from '../helpers/mcp'

let app: RunningApp
let owner: HttpClient
let agentA: AgentHandle
let agentB: AgentHandle
let a: McpHandle
let b: McpHandle

const EXPECTED_CORE_TOOLS = [
  'whoami',
  'list_actors',
  'list_projects',
  'get_project',
  'get_project_plan',
  'create_project',
  'update_project',
  'archive_project',
  'restore_project',
  'list_tasks',
  'get_task',
  'create_task',
  'update_task',
  'archive_task',
  'restore_task',
  'claim_task',
  'search',
]

beforeAll(async () => {
  app = await startApp()
  owner = await bootstrapOwner(app)
  agentA = await createAgent(owner, 'Agent A')
  agentB = await createAgent(owner, 'Agent B')
  a = await connectMcp(app.url, agentA.token)
  b = await connectMcp(app.url, agentB.token)
})
afterAll(async () => {
  await a?.close()
  await b?.close()
  await app?.stop()
})

describe('remote MCP endpoint', () => {
  it('initializes with server info, instructions and the documented tool set', async () => {
    expect(a.client.getServerVersion()).toMatchObject({ name: 'alice' })
    expect(a.client.getInstructions()).toContain('claim_task')
    const { tools } = await a.client.listTools()
    const names = tools.map((t) => t.name)
    for (const name of EXPECTED_CORE_TOOLS) expect(names).toContain(name)
    const claim = tools.find((t) => t.name === 'claim_task')!
    expect(claim.inputSchema).toMatchObject({ type: 'object', required: ['id'] })
    expect(tools.find((t) => t.name === 'list_tasks')!.annotations?.readOnlyHint).toBe(true)
    expect(await a.ok('whoami')).toMatchObject({ actor: { id: agentA.id, kind: 'agent', displayName: 'Agent A' } })
  })

  it('rejects missing, invalid and revoked tokens without leaking details', async () => {
    const missing = await fetch(`${app.url}/mcp/v1`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' })
    expect(missing.status).toBe(401)
    expect(missing.headers.get('www-authenticate')).toContain('Bearer')
    await expect(connectMcp(app.url, 'alice_at_notarealtoken')).rejects.toThrow()

    const doomed = await createAgent(owner, 'Doomed')
    const handle = await connectMcp(app.url, doomed.token)
    expect((await handle.ok('whoami')).actor.id).toBe(doomed.id)
    await owner.post(`/api/agent-tokens/${doomed.tokenId}/revoke`)
    const err = await handle.call('whoami').catch((e: Error) => e)
    expect(String(err)).toMatch(/401|UNAUTHENTICATED|valid agent bearer token/i)
    expect(String(err)).not.toContain(doomed.token)
    await handle.close().catch(() => {})
    expect(app.output()).not.toContain(doomed.token)
  })

  it('lists tasks with structured filters matching the browser-visible state', async () => {
    const project = await a.ok('create_project', { name: 'MCP project', labels: ['agents'] })
    expect(project.activityId).toMatch(/^act_/)
    const projectId = project.project.id
    for (let i = 0; i < 5; i++) {
      await owner.post('/api/tasks', { title: `Ready ${i}`, projectId, status: 'ready', priority: i % 2 ? 'high' : 'low' })
    }
    await owner.post('/api/tasks', { title: 'Backlog item', projectId })
    const page1 = await a.ok('list_tasks', { projectId: [projectId], status: ['ready'], assigneeId: ['none'], limit: 3 })
    expect(page1.items).toHaveLength(3)
    expect(page1.nextCursor).toBeTruthy()
    const page2 = await a.ok('list_tasks', { projectId: [projectId], status: ['ready'], assigneeId: ['none'], limit: 3, cursor: page1.nextCursor })
    expect(page2.items).toHaveLength(2)
    expect(page2.nextCursor).toBeNull()
    const browser = await owner.get(`/api/tasks?projectId=${projectId}&status=ready&assigneeId=none&limit=3`)
    expect(page1.items.map((t: any) => t.id)).toEqual(browser.body.items.map((t: any) => t.id))
    const high = await a.ok('list_tasks', { projectId: [projectId], priority: ['high'] })
    expect(high.items.every((t: any) => t.priority === 'high')).toBe(true)
  })

  it('lets exactly one of two concurrent agents claim a ready task', async () => {
    const task = (await owner.post('/api/tasks', { title: 'Contended', status: 'ready' })).body.task
    const [ra, rb] = await Promise.all([a.call('claim_task', { id: task.id }), b.call('claim_task', { id: task.id })])
    const winners = [ra, rb].filter((r) => !r.isError)
    const losers = [ra, rb].filter((r) => r.isError)
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expect(losers[0].error!.code).toBe('CLAIM_FAILED')
    const winner = winners[0].result
    expect(winner.task.status).toBe('in_progress')
    expect([agentA.id, agentB.id]).toContain(winner.task.assignee.id)
    expect(winner.activityId).toMatch(/^act_/)
    const claims = activityFor(app, task.id).filter((e) => e.verb === 'task.claimed')
    expect(claims).toHaveLength(1)
    expect(claims[0].data.changes.status).toEqual({ from: 'ready', to: 'in_progress' })

    // ไม่ ready / มีเจ้าของ / archived ⇒ claim ไม่ได้
    const backlog = (await owner.post('/api/tasks', { title: 'Not ready' })).body.task
    expect((await a.call('claim_task', { id: backlog.id })).error!.code).toBe('CLAIM_FAILED')
    const archived = (await owner.post('/api/tasks', { title: 'Archived ready', status: 'ready' })).body.task
    await owner.post(`/api/tasks/${archived.id}/archive`)
    expect((await a.call('claim_task', { id: archived.id })).error!.code).toBe('CLAIM_FAILED')
  })

  it('returns mutation results that match subsequent browser reads, with activity ids', async () => {
    const created = await a.ok('create_task', { title: 'Agent-created', description: 'From MCP', labels: ['mcp'] })
    expect(created.task.createdBy).toMatchObject({ id: agentA.id, kind: 'agent' })
    const updated = await a.ok('update_task', { id: created.task.id, priority: 'urgent', status: 'ready' })
    expect(updated.activityId).toMatch(/^act_/)
    const browser = await owner.get(`/api/tasks/${created.task.id}`)
    expect(browser.body.task).toEqual(updated.task)
    const activity = await owner.get(`/api/tasks/${created.task.id}/activity?limit=1`)
    expect(activity.body.items[0].id).toBe(updated.activityId)
    expect(activity.body.items[0].actor).toMatchObject({ id: agentA.id, kind: 'agent' })

    const archived = await a.ok('archive_task', { id: created.task.id })
    expect(archived.task.archivedAt).toBeTruthy()
    expect((await a.ok('restore_task', { id: created.task.id })).task.archivedAt).toBeNull()
    expect((await a.ok('get_project', { id: created.task.project.id })).project.isSystem).toBe(true)
  })

  it('returns stable machine-readable errors with safe messages', async () => {
    const validation = await a.call('create_task', { title: '' })
    expect(validation.error).toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(validation.error!.message).toContain('title')
    expect((await a.call('create_task', { title: 'x', bogus: true })).error!.code).toBe('VALIDATION_ERROR')
    expect((await a.call('get_task', { id: 'tsk_missing' })).error).toMatchObject({ code: 'NOT_FOUND', message: 'Task tsk_missing not found' })
    const untitled = (await a.ok('list_projects')).items[0]
    expect((await a.call('archive_project', { id: untitled.id })).error!.code).toBe('PROTECTED_RESOURCE')
    const task = (await a.ok('create_task', { title: 'Done by agent?', status: 'in_progress' })).task
    expect((await a.call('update_task', { id: task.id, status: 'done' })).error!.code).toBe('INVALID_STATE')
    expect((await a.call('no_such_tool')).error!.code).toBe('NOT_FOUND')
  })

  it('records token use and serves a discovery document', async () => {
    const agents = (await owner.get('/api/agents')).body.items
    expect(agents.find((x: any) => x.id === agentA.id).tokens[0].lastUsedAt).toBeTruthy()
    const discovery = await (await fetch(`${app.url}/mcp`)).json()
    expect(discovery).toMatchObject({ name: 'alice', contractVersion: '1', transport: 'streamable-http' })
    expect(discovery.endpoint).toBe(`${app.url}/mcp/v1`)
  })
})
