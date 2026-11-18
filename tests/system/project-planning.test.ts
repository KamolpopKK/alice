import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { HttpClient, bootstrapOwner, createAgent, inviteHuman, type AgentHandle } from '../helpers/client'
import { connectMcp, type McpHandle } from '../helpers/mcp'

const V1 = '/client/v1'

/** Project planning: dates, informational members, milestones and progress, with attributed activity. */
describe('project planning', () => {
  let app: RunningApp
  let owner: HttpClient
  let member: HttpClient
  let agent: AgentHandle
  let mcp: McpHandle
  let projectId: string
  let memberId: string

  beforeAll(async () => {
    app = await startApp()
    owner = await bootstrapOwner(app)
    member = await inviteHuman(owner, 'pia', 'Pia Planner')
    memberId = (await member.get(`${V1}/auth/me`)).body.actor.id
    agent = await createAgent(owner, 'Plan Agent')
    mcp = await connectMcp(app.url, agent.token)
    projectId = (await owner.post(`${V1}/projects`, { name: 'Launch' })).body.project.id
  })
  afterAll(async () => {
    await mcp?.close()
    await app?.stop()
  })

  it('advertises project-planning and keeps start and target dates in order', async () => {
    expect((await owner.get(`${V1}/info`)).body.capabilities).toContain('project-planning')
    const res = await owner.patch(`${V1}/projects/${projectId}`, { startDate: '2026-03-01', targetDate: '2026-04-30' })
    expect(res.body.project).toMatchObject({ startDate: '2026-03-01', targetDate: '2026-04-30' })
    expect((await owner.patch(`${V1}/projects/${projectId}`, { targetDate: '2026-02-01' })).body.error.code).toBe('VALIDATION_ERROR')
    expect((await owner.patch(`${V1}/projects/${projectId}`, { startDate: '2026-02-30' })).status).toBe(400)
    expect((await owner.patch(`${V1}/projects/${projectId}`, { targetDate: null })).body.project.targetDate).toBeNull()
    const act = (await owner.get(`${V1}/activity?resourceType=project&limit=50`)).body.items.find((e: any) => e.resourceId === projectId && e.data.changes?.startDate)
    expect(act.data.changes.startDate).toEqual({ from: null, to: '2026-03-01' })
  })

  it('adds and removes members without changing access, and records who did it', async () => {
    const added = await owner.request('PUT', `${V1}/projects/${projectId}/members/${memberId}`, {})
    expect(added.body).toMatchObject({ changed: true, members: [expect.objectContaining({ actor: expect.objectContaining({ id: memberId }), addedBy: expect.objectContaining({ displayName: 'Olivia Owner' }) })] })
    expect((await owner.request('PUT', `${V1}/projects/${projectId}/members/${memberId}`, {})).body.changed).toBe(false)
    // agent เป็นสมาชิกได้ (ผ่าน /api เดิมก็ใช้ได้)
    expect((await owner.request('PUT', `/api/projects/${projectId}/members/${agent.id}`, {})).body.members).toHaveLength(2)
    expect((await owner.request('PUT', `${V1}/projects/${projectId}/members/act_doesnotexist000000000`, {})).status).toBe(404)
    const verbs = (await owner.get(`${V1}/activity?resourceType=project&limit=50`)).body.items.filter((e: any) => e.resourceId === projectId).map((e: any) => e.verb)
    expect(verbs.filter((v: string) => v === 'project.member_added')).toHaveLength(2)
    expect((await owner.request('DELETE', `${V1}/projects/${projectId}/members/${agent.id}`, {})).body.members).toHaveLength(1)
    // การเป็นสมาชิกไม่ใช่สิทธิ์: คนที่ไม่ได้เป็นสมาชิกยังอ่าน project ได้เหมือนเดิม
    const outsider = await inviteHuman(owner, 'olaf', 'Olaf Outsider')
    expect((await outsider.get(`${V1}/projects/${projectId}`)).status).toBe(200)
  })

  it('keeps milestones in date order and completes or reopens them', async () => {
    const later = (await owner.post(`${V1}/projects/${projectId}/milestones`, { title: 'Launch', dueDate: '2026-04-30' })).body.milestone
    const sooner = (await member.post(`${V1}/projects/${projectId}/milestones`, { title: 'Design done', dueDate: '2026-03-15' })).body.milestone
    await owner.post(`${V1}/projects/${projectId}/milestones`, { title: 'Someday' })
    expect((await owner.get(`${V1}/projects/${projectId}/milestones`)).body.items.map((m: any) => m.title)).toEqual(['Design done', 'Launch', 'Someday'])
    expect(sooner.createdBy.displayName).toBe('Pia Planner')
    const done = (await owner.patch(`${V1}/milestones/${sooner.id}`, { completed: true })).body.milestone
    expect(done.completedAt).not.toBeNull()
    expect((await owner.patch(`${V1}/milestones/${sooner.id}`, { completed: false })).body.milestone.completedAt).toBeNull()
    expect((await owner.post(`${V1}/projects/${projectId}/milestones`, { title: '' })).status).toBe(400)
    expect((await owner.request('DELETE', `${V1}/milestones/${later.id}`, {})).body.deleted).toBe(true)
    const verbs = (await owner.get(`${V1}/activity?resourceType=project&limit=100`)).body.items.filter((e: any) => e.resourceId === projectId).map((e: any) => e.verb)
    expect(verbs).toEqual(expect.arrayContaining(['project.milestone_added', 'project.milestone_completed', 'project.milestone_reopened', 'project.milestone_removed']))
  })

  it('counts progress from live tasks only, and refuses plan changes on an archived project', async () => {
    const p = (await owner.post(`${V1}/projects`, { name: 'Counted' })).body.project.id
    for (const status of ['done', 'done', 'canceled', 'ready', 'in_progress']) await owner.post(`${V1}/tasks`, { title: `T ${status}`, status, projectId: p })
    const archived = (await owner.post(`${V1}/tasks`, { title: 'Gone', status: 'done', projectId: p })).body.task
    await owner.post(`${V1}/tasks/${archived.id}/archive`, {})
    expect((await owner.get(`${V1}/projects/${p}/progress`)).body.progress).toEqual({ total: 5, done: 2, canceled: 1, open: 2 })
    await owner.post(`${V1}/projects/${p}/archive`, {})
    expect((await owner.post(`${V1}/projects/${p}/milestones`, { title: 'Too late' })).body.error.code).toBe('INVALID_STATE')
  })

  it('lets agents read the plan and set dates over MCP, attributed to the agent', async () => {
    const plan = await mcp.ok('get_project_plan', { id: projectId })
    expect(plan).toMatchObject({ startDate: '2026-03-01', members: [expect.objectContaining({ actor: expect.objectContaining({ id: memberId }) })], progress: { total: 0 } })
    expect(plan.milestones.map((m: any) => m.title)).toEqual(['Design done', 'Someday'])
    const updated = await mcp.ok('update_project', { id: projectId, targetDate: '2026-05-31' })
    expect(updated.project).toMatchObject({ targetDate: '2026-05-31', updatedBy: expect.objectContaining({ kind: 'agent', displayName: 'Plan Agent' }) })
  })
})
