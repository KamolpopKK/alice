import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { HttpClient, agentClient, bootstrapOwner, createAgent, inviteHuman, type AgentHandle } from '../helpers/client'
import { connectMcp, type McpHandle } from '../helpers/mcp'

const V1 = '/client/v1'

/** Approval requests: agents ask, people decide, and every step is attributed in task activity. */
describe('approval requests', () => {
  let app: RunningApp
  let owner: HttpClient
  let mia: HttpClient
  let noah: HttpClient
  let miaId: string
  let agent: AgentHandle
  let mcp: McpHandle
  let taskId: string

  beforeAll(async () => {
    app = await startApp()
    owner = await bootstrapOwner(app)
    mia = await inviteHuman(owner, 'mia', 'Mia Reviewer')
    noah = await inviteHuman(owner, 'noah', 'Noah Bystander')
    miaId = (await mia.get(`${V1}/auth/me`)).body.actor.id
    agent = await createAgent(owner, 'Deploy Agent')
    mcp = await connectMcp(app.url, agent.token)
    taskId = (await owner.post(`${V1}/tasks`, { title: 'Ship the release', status: 'ready' })).body.task.id
  })
  afterAll(async () => {
    await mcp?.close()
    await app?.stop()
  })

  it('advertises approvals; an agent asks a named person, who sees it waiting for them', async () => {
    expect((await owner.get(`${V1}/info`)).body.capabilities).toContain('approvals')
    const asked = await mcp.ok('request_approval', { taskId, question: 'Deploy v2 to production tonight?', requestedOfId: miaId })
    expect(asked.approval).toMatchObject({ status: 'pending', requestedBy: { kind: 'agent', displayName: 'Deploy Agent' }, requestedOf: { id: miaId }, task: { id: taskId } })
    const forMia = (await mia.get(`${V1}/approvals?for=me`)).body.items
    expect(forMia.map((a: any) => a.id)).toEqual([asked.approval.id])
    // คนอื่นที่ไม่ได้ถูกถามไม่เห็นใน for=me (owner เห็นทุกคำขอ)
    expect((await noah.get(`${V1}/approvals?for=me`)).body.items).toEqual([])
    expect((await owner.get(`${V1}/approvals?for=me`)).body.items.map((a: any) => a.id)).toContain(asked.approval.id)
    // agent ตัดสินไม่ได้ และคนที่ไม่ได้ถูกถามก็ตัดสินไม่ได้
    expect((await agentClient(app, agent).post(`/api/approvals/${asked.approval.id}/approve`, {})).body.error.code).toBe('FORBIDDEN')
    expect((await noah.post(`${V1}/approvals/${asked.approval.id}/approve`, {})).body.error.code).toBe('FORBIDDEN')

    const decided = await mia.post(`${V1}/approvals/${asked.approval.id}/approve`, { note: 'Go after 22:00' })
    expect(decided.body.approval).toMatchObject({ status: 'approved', note: 'Go after 22:00', decidedBy: { id: miaId } })
    expect((await mcp.ok('get_approval', { id: asked.approval.id })).approval).toMatchObject({ status: 'approved', note: 'Go after 22:00' })
    expect((await mia.post(`${V1}/approvals/${asked.approval.id}/reject`, {})).body.error.code).toBe('INVALID_STATE')
    const verbs = (await owner.get(`${V1}/tasks/${taskId}/activity`)).body.items.map((e: any) => [e.verb, e.actor?.displayName])
    expect(verbs).toEqual(expect.arrayContaining([['approval.requested', 'Deploy Agent'], ['approval.approved', 'Mia Reviewer']]))
  })

  it('asks anyone when no person is named, never lets the asker decide, and lets the asker withdraw', async () => {
    const own = (await noah.post(`${V1}/tasks/${taskId}/approvals`, { question: 'Can I drop the old API?' })).body.approval
    expect(own.requestedOf).toBeNull()
    expect((await noah.post(`${V1}/approvals/${own.id}/approve`, {})).body.error.code).toBe('FORBIDDEN')
    expect((await noah.get(`${V1}/approvals?for=me`)).body.items.map((a: any) => a.id)).not.toContain(own.id)
    expect((await mia.get(`${V1}/approvals?for=me`)).body.items.map((a: any) => a.id)).toContain(own.id)
    expect((await mia.post(`${V1}/approvals/${own.id}/cancel`, {})).body.error.code).toBe('FORBIDDEN')
    expect((await noah.post(`${V1}/approvals/${own.id}/cancel`, {})).body.approval.status).toBe('canceled')

    const agentAsk = (await mcp.ok('request_approval', { taskId, question: 'Rotate the keys?' })).approval
    expect((await mcp.ok('cancel_approval', { id: agentAsk.id })).approval.status).toBe('canceled')
    expect((await mcp.ok('list_approvals', { taskId, status: 'canceled' })).items).toHaveLength(2)
  })

  it('refuses requests on archived tasks or of agents and unknown people', async () => {
    expect((await owner.post(`${V1}/tasks/${taskId}/approvals`, { question: 'x', requestedOfId: agent.id })).body.error.code).toBe('VALIDATION_ERROR')
    expect((await owner.post(`${V1}/tasks/${taskId}/approvals`, { question: '' })).status).toBe(400)
    const archived = (await owner.post(`${V1}/tasks`, { title: 'Old' })).body.task.id
    await owner.post(`${V1}/tasks/${archived}/archive`, {})
    expect((await owner.post(`${V1}/tasks/${archived}/approvals`, { question: 'Still?' })).body.error.code).toBe('INVALID_STATE')
  })
})
