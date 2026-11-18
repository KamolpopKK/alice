import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { HttpClient, agentClient, bootstrapOwner, createAgent, inviteHuman } from '../helpers/client'
import { openClientEvents } from '../helpers/sse'

const V1 = '/client/v1'

/** Saved Tasks views: one person's private preference, kept on the server for every device. */
describe('saved views', () => {
  let app: RunningApp
  let owner: HttpClient
  let member: HttpClient

  beforeAll(async () => {
    app = await startApp()
    owner = await bootstrapOwner(app)
    member = await inviteHuman(owner, 'mira', 'Mira Member')
  })
  afterAll(async () => app?.stop())

  it('advertises the additive saved-views capability', async () => {
    const info = await owner.get(`${V1}/info`)
    expect(info.body.capabilities).toContain('saved-views')
  })

  it('saves, replaces by name, lists and deletes only the owner’s views', async () => {
    const created = await owner.post(`${V1}/saved-views`, { name: 'Urgent', view: 'list', query: 'priority=urgent&sort=due' })
    expect(created.status).toBe(201)
    expect(created.body.view).toMatchObject({ name: 'Urgent', view: 'list', query: 'priority=urgent&sort=due' })
    const replaced = await owner.post(`${V1}/saved-views`, { name: 'Urgent', view: 'board', query: 'priority=urgent' })
    expect(replaced.body.view.id).toBe(created.body.view.id)
    expect((await owner.get(`${V1}/saved-views`)).body.items).toEqual([expect.objectContaining({ name: 'Urgent', view: 'board', query: 'priority=urgent' })])

    // คนอื่นไม่เห็น และลบไม่ได้ (ตอบเหมือน id ที่ไม่มีอยู่)
    expect((await member.get(`${V1}/saved-views`)).body.items).toEqual([])
    const theirs = await member.request('DELETE', `${V1}/saved-views/${created.body.view.id}`, {})
    expect(theirs.status).toBe(404)
    const missing = await member.request('DELETE', `${V1}/saved-views/svw_doesnotexist0000000`, {})
    expect(missing.body).toEqual({ ...theirs.body, error: { ...theirs.body.error, message: missing.body.error.message } })

    expect((await owner.request('DELETE', `${V1}/saved-views/${created.body.view.id}`, {})).status).toBe(200)
    expect((await owner.get(`${V1}/saved-views`)).body.items).toEqual([])
  })

  it('rejects invalid input and agent credentials', async () => {
    expect((await owner.post(`${V1}/saved-views`, { name: '', view: 'list' })).status).toBe(400)
    expect((await owner.post(`${V1}/saved-views`, { name: 'Bad', view: 'calendar' })).status).toBe(400)
    const agent = agentClient(app, await createAgent(owner, 'View Agent'))
    // Client API ไม่รับ token ของ agent ตั้งแต่ชั้น auth
    expect([401, 403]).toContain((await agent.get(`${V1}/saved-views`)).status)
  })

  it('notifies only the owner, and writes no activity', async () => {
    const ownerEvents = await openClientEvents(owner)
    const memberEvents = await openClientEvents(member)
    const before = (await owner.get(`${V1}/activity?limit=200`)).body.items.length
    const saved = (await owner.post(`${V1}/saved-views`, { name: 'Mine', view: 'my-work', query: '' })).body.view
    await ownerEvents.waitFor((e) => e.event === 'invalidate' && e.data.kind === 'saved_view' && e.data.id === saved.id)
    // ให้ stream ของคนอื่นมีเวลารับ แล้วตรวจว่าไม่มีอะไรเกี่ยวกับ view นี้
    await owner.post(`${V1}/tasks`, { title: 'Marker after saved view' })
    await memberEvents.waitFor((e) => e.event === 'invalidate' && e.data.kind === 'task')
    expect(JSON.stringify(memberEvents.events)).not.toContain(saved.id)
    expect((await owner.get(`${V1}/activity?limit=200`)).body.items.length).toBe(before + 1)
    ownerEvents.close()
    memberEvents.close()
  })
})
