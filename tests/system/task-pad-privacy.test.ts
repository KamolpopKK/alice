import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clientEventSchema } from '../../src/shared/contracts'
import { CLIENT_CAPABILITIES } from '../../src/shared/version'
import { startApp, type RunningApp } from '../helpers/app'
import { HttpClient, bootstrapOwner, createAgent, inviteHuman, type AgentHandle } from '../helpers/client'
import { alice, cliHome } from '../helpers/cli'
import { inspectDb } from '../helpers/db'
import { connectMcp, type McpHandle } from '../helpers/mcp'
import { openClientEvents, openEvents } from '../helpers/sse'

const V1 = '/client/v1'
const SECRET = 'okapi-vault-merger-memo'

/**
 * Privacy and compatibility proof across every surface: another human and an agent learn
 * nothing about a private Pad, while tasks created from it behave like any other task.
 */
describe('Task Pads: cross-surface privacy and compatibility', () => {
  let app: RunningApp
  let owner: HttpClient
  let member: HttpClient
  let agent: AgentHandle
  let mcp: McpHandle
  let padId: string
  let headingId: string
  let taskId: string

  beforeAll(async () => {
    app = await startApp()
    owner = await bootstrapOwner(app)
    member = await inviteHuman(owner, 'nora', 'Nora Neighbour')
    agent = await createAgent(owner, 'Curious Agent')
    mcp = await connectMcp(app.url, agent.token)
    const ownerEvents = await openClientEvents(owner)
    const memberStream = await openClientEvents(member)
    const legacy = await openEvents(member)

    padId = (await owner.post(`${V1}/pads`, { name: `Board prep ${SECRET}` })).body.pad.id
    headingId = (await owner.post(`${V1}/pads/${padId}/blocks`, { type: 'heading', content: [{ type: 'text', text: `Agenda ${SECRET}` }] })).body.block.id
    await owner.post(`${V1}/pads/${padId}/blocks`, { type: 'text', parentId: headingId, content: [{ type: 'text', text: `Private context ${SECRET}` }] })
    const block = (await owner.post(`${V1}/pads/${padId}/blocks`, { type: 'task', parentId: headingId, title: 'Prepare the board deck' })).body.block
    taskId = block.task.id
    await owner.patch(`${V1}/pads/${padId}/blocks/${block.id}`, { description: 'Slides 1-12' })
    await ownerEvents.waitFor((e) => e.event === 'invalidate' && e.data.kind === 'pad_block' && e.data.id === block.id)
    await memberStream.waitFor((e) => e.event === 'invalidate' && e.data.id === taskId)
    await legacy.waitForResource('task', taskId)
    // member และ stream เดิมไม่เห็นตัวตนหรือเนื้อหาของ Pad เลย
    for (const stream of [memberStream, legacy]) {
      const seen = JSON.stringify(stream.events)
      expect(seen).not.toContain(padId)
      expect(seen).not.toContain(headingId)
      expect(seen).not.toContain(SECRET)
    }
    // event ส่วนตัวยัง parse ได้ด้วย schema ของ client รุ่นเก่า (field เพิ่มเป็นแบบ additive)
    for (const e of ownerEvents.events.filter((x) => x.event === 'invalidate')) expect(clientEventSchema.safeParse(e.data).success).toBe(true)
    ownerEvents.close()
    memberStream.close()
    legacy.close()
  })
  afterAll(async () => {
    await mcp?.close()
    await app?.stop()
  })

  it('keeps Pad identifiers and content away from another human on every HTTP path', async () => {
    expect((await member.get(`${V1}/pads/${padId}`)).status).toBe(404)
    expect((await member.get(`${V1}/pads/${padId}/blocks`)).status).toBe(404)
    expect((await member.get(`${V1}/pads?archived=all`)).body.items).toEqual([])
    expect((await member.get(`${V1}/pad-search?q=${SECRET}`)).body.items).toEqual([])
    expect((await member.get(`${V1}/search?q=${SECRET}`)).body.items).toEqual([])
    expect(JSON.stringify((await member.get(`${V1}/pads/export`)).body.pads)).toBe('[]')
    const activity = JSON.stringify((await member.get(`${V1}/activity?limit=200`)).body)
    expect(activity).not.toContain(SECRET)
    expect(activity).not.toContain(headingId)
    // ข้อมูล task เป็นของ workspace ตามปกติ
    expect((await member.get(`${V1}/tasks/${taskId}`)).body.task).toMatchObject({ title: 'Prepare the board deck', description: 'Slides 1-12' })
    // แม้แต่ owner ก็ไม่มีเส้นทาง /api สำหรับ Pad
    expect((await owner.get(`/api/pads`)).status).toBe(404)
  })

  it('gives agents ordinary task access and no Pad surface over MCP', async () => {
    const tools = (await mcp.client.listTools()).tools.map((t) => t.name)
    expect(tools.filter((t) => /pad/i.test(t))).toEqual([])
    const listed = JSON.stringify(await mcp.ok('list_tasks', {}))
    expect(listed).toContain('Prepare the board deck')
    expect(listed).not.toContain(SECRET)
    const searched = JSON.stringify(await mcp.ok('search', { q: SECRET }))
    expect(searched).not.toContain(SECRET)
    expect(searched).not.toContain(padId)
    const task = JSON.stringify(await mcp.ok('get_task', { id: taskId }))
    expect(task).not.toContain(SECRET)
    // agent token ใช้ Client API ไม่ได้เลย
    const bot = new HttpClient(app.url)
    bot.bearer = agent.token
    expect((await bot.get(`${V1}/pads`)).status).toBe(401)
    expect((await bot.get(`${V1}/pad-search?q=${SECRET}`)).status).toBe(401)
  })

  it('offers no CLI Pad command, while the CLI sees Pad-created tasks', async () => {
    const home = cliHome('pad-cli')
    const help = await alice(home, ['--help'])
    expect(`${help.stdout}${help.stderr}`).not.toMatch(/\bpads?\b/i)
    const unknown = await alice(home, ['pad', 'list'])
    expect(unknown.code).not.toBe(0)
    expect(`${unknown.stdout}${unknown.stderr}`).not.toContain(SECRET)
  })

  it('stores Pad content only in Pad tables and never in workspace activity or search', () => {
    const leaks = inspectDb(app, (db) => ({
      activity: (db.prepare('SELECT count(*) AS n FROM activity_events WHERE data LIKE ?').get(`%${SECRET}%`) as { n: number }).n,
      search: (db.prepare('SELECT count(*) AS n FROM search_index WHERE body LIKE ? OR title LIKE ?').get(`%${SECRET}%`, `%${SECRET}%`) as { n: number }).n,
      events: (db.prepare(`SELECT count(*) AS n FROM client_events WHERE kind IN ('pad', 'pad_block') AND audience_id IS NULL`).get() as { n: number }).n,
      created: db.prepare(`SELECT data FROM activity_events WHERE resource_id = ? AND verb = 'task.created'`).get(taskId) as { data: string },
    }))
    expect(leaks.activity).toBe(0)
    expect(leaks.search).toBe(0)
    expect(leaks.events).toBe(0)
    expect(JSON.parse(leaks.created.data)).toMatchObject({ source: 'task_pad', padId })
  })

  it('negotiates task-pads as an additive capability without changing the protocol version', async () => {
    const info = (await new HttpClient(app.url).get(`${V1}/info`)).body
    expect(info.clientApi).toMatchObject({ current: 1, minimum: 1 })
    expect(info.capabilities).toEqual([...CLIENT_CAPABILITIES])
    expect(info.capabilities).toContain('task-pads')
    // client รุ่นเก่าที่ส่ง header v1 ยังใช้ route เดิมได้ทั้งหมด
    const old = await member.request('GET', `${V1}/tasks`, undefined, { 'alice-client-api': '1', 'alice-client': 'alice-cli/0.2.0' })
    expect(old.status).toBe(200)
  })
})
