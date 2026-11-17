import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli, startApp, tempDataDir, type RunningApp } from '../helpers/app'
import { HttpClient, agentClient, bootstrapOwner, createAgent, inviteHuman, OWNER, type AgentHandle } from '../helpers/client'
import { inspectDb } from '../helpers/db'
import { connectMcp } from '../helpers/mcp'
import { openClientEvents, openEvents } from '../helpers/sse'

const V1 = '/client/v1'
const text = (t: string) => [{ type: 'text', text: t }]

describe('Task Pads: persistence, ownership and Client API', () => {
  let app: RunningApp
  let owner: HttpClient
  let member: HttpClient
  let agent: AgentHandle

  beforeAll(async () => {
    app = await startApp()
    owner = await bootstrapOwner(app)
    member = await inviteHuman(owner, 'mia', 'Mia Member')
    agent = await createAgent(owner, 'Pad Prober')
  })
  afterAll(async () => {
    await app?.stop()
  })

  const newPad = async (client: HttpClient, name: string) => {
    const res = await client.post(`${V1}/pads`, { name })
    expect(res.status).toBe(201)
    return res.body.pad as { id: string; name: string }
  }
  const addBlock = async (client: HttpClient, padId: string, body: Record<string, unknown>) => {
    const res = await client.post(`${V1}/pads/${padId}/blocks`, body)
    if (res.status !== 201) throw new Error(`block failed: ${JSON.stringify(res.body)}`)
    return res.body.block as { id: string; depth: number; parentId: string | null }
  }
  const allBlocks = async (client: HttpClient, padId: string) => {
    const out: any[] = []
    let cursor: string | null = null
    do {
      const res: any = await client.get(`${V1}/pads/${padId}/blocks?limit=200${cursor ? `&cursor=${cursor}` : ''}`)
      expect(res.status).toBe(200)
      out.push(...res.body.items)
      cursor = res.body.nextCursor
    } while (cursor)
    return out
  }

  it('advertises the additive task-pads capability', async () => {
    const info = await new HttpClient(app.url).get(`${V1}/info`)
    expect(info.body.capabilities).toContain('task-pads')
    expect(info.body.capabilities).toContain('tasks')
  })

  it('creates multiple duplicate-named Pads and supports rename, pin, archive, restore and confirmed delete', async () => {
    const a = await newPad(owner, '15 Nov 2026, 09:00')
    const b = await newPad(owner, '15 Nov 2026, 09:00')
    expect(a.id).not.toBe(b.id)
    expect(a.id).toMatch(/^pad_/)

    const renamed = await owner.patch(`${V1}/pads/${a.id}`, { name: 'Planning call' })
    expect(renamed.body.pad.name).toBe('Planning call')
    expect((await owner.patch(`${V1}/pads/${a.id}`, { name: '   ' })).status).toBe(400)

    const c = await newPad(owner, 'Newest')
    // pinned ขึ้นก่อน แล้วตามเวลาที่อัปเดตล่าสุด
    await owner.patch(`${V1}/pads/${b.id}`, { pinned: true })
    const listed = (await owner.get(`${V1}/pads`)).body.items.map((p: any) => p.id)
    expect(listed.slice(0, 3)).toEqual([b.id, c.id, a.id])
    await addBlock(owner, a.id, { type: 'text', content: text('touch') })
    expect((await owner.get(`${V1}/pads`)).body.items.map((p: any) => p.id).slice(0, 3)).toEqual([b.id, a.id, c.id])

    const archived = await owner.post(`${V1}/pads/${c.id}/archive`)
    expect(archived.body.pad.archivedAt).not.toBeNull()
    expect((await owner.get(`${V1}/pads`)).body.items.map((p: any) => p.id)).not.toContain(c.id)
    expect((await owner.get(`${V1}/pads?archived=archived`)).body.items.map((p: any) => p.id)).toContain(c.id)
    await owner.post(`${V1}/pads/${c.id}/restore`)
    expect((await owner.get(`${V1}/pads`)).body.items.map((p: any) => p.id)).toContain(c.id)

    const unconfirmed = await owner.delete(`${V1}/pads/${c.id}`, {})
    expect(unconfirmed.status).toBe(400)
    const deleted = await owner.delete(`${V1}/pads/${c.id}`, { confirm: true })
    expect(deleted.body).toEqual({ deleted: true, id: c.id })
    expect((await owner.get(`${V1}/pads/${c.id}`)).status).toBe(404)
  })

  it('pages the Pad list deterministically', async () => {
    for (let i = 0; i < 5; i++) await newPad(member, `Page pad ${i}`)
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const res: any = await member.get(`${V1}/pads?limit=2${cursor ? `&cursor=${cursor}` : ''}`)
      seen.push(...res.body.items.map((p: any) => p.id))
      cursor = res.body.nextCursor
    } while (cursor)
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen.length).toBeGreaterThanOrEqual(5)
  })

  it('treats another human’s Pad exactly like an unknown id and refuses agents', async () => {
    const pad = await newPad(owner, 'Private thoughts')
    const block = await addBlock(owner, pad.id, { type: 'text', content: text('confidential salary note') })
    const unknown = await member.get(`${V1}/pads/pad_doesnotexist000000000`)
    for (const res of [
      await member.get(`${V1}/pads/${pad.id}`),
      await member.get(`${V1}/pads/${pad.id}/blocks`),
      await member.patch(`${V1}/pads/${pad.id}`, { name: 'Hijacked' }),
      await member.post(`${V1}/pads/${pad.id}/archive`),
      await member.delete(`${V1}/pads/${pad.id}`, { confirm: true }),
      await member.post(`${V1}/pads/${pad.id}/blocks`, { type: 'text', content: text('intrusion') }),
      await member.patch(`${V1}/pads/${pad.id}/blocks/${block.id}`, { content: text('edited') }),
      await member.delete(`${V1}/pads/${pad.id}/blocks/${block.id}`, {}),
    ]) {
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: { ...unknown.body.error, message: res.body.error.message } })
      expect(JSON.stringify(res.body)).not.toContain('confidential')
    }
    expect((await member.get(`${V1}/pads?archived=all`)).body.items.map((p: any) => p.id)).not.toContain(pad.id)
    expect((await member.get(`${V1}/pad-search?q=confidential`)).body.items).toEqual([])
    expect((await owner.get(`${V1}/pads/${pad.id}/blocks`)).body.items[0].content).toEqual(text('confidential salary note'))

    // agent: Client API ปฏิเสธ token, /api ไม่มี route ของ Pad, MCP ไม่มี tool ของ Pad
    const bot = agentClient(app, agent)
    expect((await bot.get(`${V1}/pads`)).status).toBe(401)
    expect((await bot.post(`${V1}/pads`, { name: 'Agent pad' })).status).toBe(401)
    expect((await bot.get(`/api/pads`)).status).toBe(404)
    expect((await owner.get(`/api/pads`)).status).toBe(404)
    const mcp = await connectMcp(app.url, agent.token)
    try {
      const tools = (await mcp.client.listTools()).tools.map((t) => t.name)
      expect(tools.some((t) => /pad/i.test(t))).toBe(false)
    } finally {
      await mcp.close()
    }
  })

  it('stores Text and Heading as plain segments with immutable task mentions', async () => {
    const task = (await owner.post(`${V1}/tasks`, { title: 'Mentioned work' })).body.task
    const pad = await newPad(owner, 'Mentions')
    const block = await addBlock(owner, pad.id, {
      type: 'text',
      content: [{ type: 'text', text: 'See ' }, { type: 'mention', taskId: task.id }, { type: 'text', text: '\u0007 for details' }],
    })
    const page = (await owner.get(`${V1}/pads/${pad.id}/blocks`)).body
    expect(page.items[0].content).toEqual([{ type: 'text', text: 'See ' }, { type: 'mention', taskId: task.id }, { type: 'text', text: ' for details' }])
    expect(page.mentions[task.id]).toMatchObject({ title: 'Mentioned work', status: 'backlog' })
    // ชื่อ task เปลี่ยน: mention ยังชี้ id เดิม และ label มาจากข้อมูลปัจจุบัน
    await owner.patch(`${V1}/tasks/${task.id}`, { title: 'Renamed work' })
    expect((await owner.get(`${V1}/pads/${pad.id}/blocks`)).body.mentions[task.id].title).toBe('Renamed work')

    const heading = await addBlock(owner, pad.id, { type: 'heading', content: text('Line one\nline two'), afterId: block.id })
    expect((await owner.get(`${V1}/pads/${pad.id}/blocks`)).body.items[1].content).toEqual(text('Line one line two'))
    expect(heading.depth).toBe(1)
    expect((await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'text', content: [{ type: 'mention', taskId: 'tsk_missing' }] })).status).toBe(404)
    expect((await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'text', content: [{ type: 'bold', text: 'x' }] })).status).toBe(400)
  })

  it('enforces hierarchy: four levels, no cycles, no cross-Pad parents', async () => {
    const pad = await newPad(owner, 'Hierarchy')
    const other = await newPad(owner, 'Other')
    const h1 = await addBlock(owner, pad.id, { type: 'heading', content: text('L1') })
    const h2 = await addBlock(owner, pad.id, { type: 'heading', content: text('L2'), parentId: h1.id })
    const t3 = await addBlock(owner, pad.id, { type: 'text', content: text('L3'), parentId: h2.id })
    const t4 = await addBlock(owner, pad.id, { type: 'text', content: text('L4'), parentId: t3.id })
    expect(t4.depth).toBe(4)
    const tooDeep = await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'text', content: text('L5'), parentId: t4.id })
    expect(tooDeep.status).toBe(409)
    expect(tooDeep.body.error.code).toBe('INVALID_RELATIONSHIP')

    const cycle = await owner.post(`${V1}/pads/${pad.id}/blocks/${h1.id}/move`, { parentId: t3.id })
    expect(cycle.status).toBe(409)
    expect(cycle.body.error.code).toBe('RELATIONSHIP_CYCLE')

    const foreign = await addBlock(owner, other.id, { type: 'heading', content: text('Elsewhere') })
    expect((await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'text', content: text('x'), parentId: foreign.id })).status).toBe(404)
    expect((await owner.post(`${V1}/pads/${pad.id}/blocks/${t3.id}/move`, { parentId: foreign.id })).status).toBe(404)

    // ย้าย subtree สูง 3 ชั้นไปไว้ใต้ block ระดับ 2 = ลึก 5 → ปฏิเสธ
    const side = await addBlock(owner, pad.id, { type: 'heading', content: text('Side'), afterId: h1.id })
    const sideChild = await addBlock(owner, pad.id, { type: 'text', content: text('Side child'), parentId: side.id })
    expect((await owner.post(`${V1}/pads/${pad.id}/blocks/${h2.id}/move`, { parentId: sideChild.id })).status).toBe(409)
    // Task block ยังไม่รองรับใน task นี้ไม่ได้ทำให้ข้อมูลเสีย
    const before = await allBlocks(owner, pad.id)
    expect(before.map((b) => b.depth)).toEqual([1, 2, 3, 4, 1, 2])
  })

  it('moves a Heading with its subtree atomically and keeps stable order', async () => {
    const pad = await newPad(owner, 'Ordering')
    const a = await addBlock(owner, pad.id, { type: 'heading', content: text('A') })
    const a1 = await addBlock(owner, pad.id, { type: 'text', content: text('A1'), parentId: a.id })
    const a2 = await addBlock(owner, pad.id, { type: 'text', content: text('A2'), parentId: a.id, afterId: a1.id })
    const b = await addBlock(owner, pad.id, { type: 'heading', content: text('B'), afterId: a.id })
    const c = await addBlock(owner, pad.id, { type: 'text', content: text('C'), afterId: b.id })
    // แทรกตรงกลาง
    await addBlock(owner, pad.id, { type: 'text', content: text('A1.5'), parentId: a.id, afterId: a1.id })
    const names = async () => (await allBlocks(owner, pad.id)).map((x) => `${x.depth}:${x.content[0]?.text}`)
    expect(await names()).toEqual(['1:A', '2:A1', '2:A1.5', '2:A2', '1:B', '1:C'])

    const moved = await owner.post(`${V1}/pads/${pad.id}/blocks/${a.id}/move`, { afterId: c.id })
    expect(moved.status).toBe(200)
    expect(moved.body.affected).toHaveLength(3)
    expect(await names()).toEqual(['1:B', '1:C', '1:A', '2:A1', '2:A1.5', '2:A2'])
    // ย้ายเข้าไปใต้ B แล้ว depth ของ subtree เปลี่ยนตาม
    await owner.post(`${V1}/pads/${pad.id}/blocks/${a.id}/move`, { parentId: b.id })
    expect(await names()).toEqual(['1:B', '2:A', '3:A1', '3:A1.5', '3:A2', '1:C'])
    expect((await owner.post(`${V1}/pads/${pad.id}/blocks/${a2.id}/move`, { afterId: c.id, parentId: b.id })).status).toBe(400)

    // ลบแบบปกติ: children เลื่อนขึ้นหนึ่งระดับแทนที่
    await owner.delete(`${V1}/pads/${pad.id}/blocks/${a.id}`, {})
    expect(await names()).toEqual(['1:B', '2:A1', '2:A1.5', '2:A2', '1:C'])
    // ลบทั้ง subtree แยกเป็น mode ชัดเจน
    await owner.delete(`${V1}/pads/${pad.id}/blocks/${b.id}`, { mode: 'subtree' })
    expect(await names()).toEqual(['1:C'])
  })

  it('keeps order valid across many inserts at the same spot (transparent rebalance)', async () => {
    const pad = await newPad(owner, 'Rebalance')
    const first = await addBlock(owner, pad.id, { type: 'text', content: text('0') })
    let after = first.id
    for (let i = 1; i <= 120; i++) after = (await addBlock(owner, pad.id, { type: 'text', content: text(String(i)), afterId: first.id })).id
    const list = (await allBlocks(owner, pad.id)).map((b) => Number(b.content[0].text))
    expect(list[0]).toBe(0)
    expect(list.slice(1)).toEqual(Array.from({ length: 120 }, (_, i) => 120 - i))
    expect(after).toBeTruthy()
    const longest = inspectDb(app, (db) => (db.prepare('SELECT max(length(order_key)) AS n FROM pad_blocks WHERE pad_id = ?').get(pad.id) as { n: number }).n)
    expect(longest).toBeLessThanOrEqual(48)
  })

  it('searches owner content beyond the first block page without leaking into workspace search', async () => {
    const pad = await newPad(owner, 'Long call notes')
    const top = await addBlock(owner, pad.id, { type: 'heading', content: text('Section') })
    let prev: string | null = null
    for (let i = 0; i < 230; i++) {
      const b = await addBlock(owner, pad.id, { type: 'text', content: text(i === 225 ? 'needle zebra-orchid remark' : `filler line ${i}`), parentId: top.id, afterId: prev })
      prev = b.id
    }
    await owner.patch(`${V1}/pads/${pad.id}/blocks/${top.id}`, { collapsed: true })
    const firstPage = (await owner.get(`${V1}/pads/${pad.id}/blocks?limit=100`)).body
    expect(firstPage.items.some((b: any) => b.content[0]?.text?.includes('zebra'))).toBe(false)
    const found = (await owner.get(`${V1}/pad-search?q=zebra-orchid`)).body.items
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ padId: pad.id, padName: 'Long call notes', blockType: 'text', ancestorIds: [top.id] })
    expect(found[0].snippet).toContain('zebra')
    expect((await owner.get(`${V1}/pad-search?q=Long call`)).body.items.some((r: any) => r.padId === pad.id && r.blockId === null)).toBe(true)

    expect((await member.get(`${V1}/pad-search?q=zebra-orchid`)).body.items).toEqual([])
    for (const client of [owner, member]) {
      expect((await client.get(`${V1}/search?q=zebra-orchid`)).body.items).toEqual([])
      expect((await client.get(`/api/search?q=zebra-orchid`)).body.items).toEqual([])
    }
    // คำสั้นกว่า trigram ก็ค้นได้
    expect((await owner.get(`${V1}/pad-search?q=ze`)).body.items.length).toBeGreaterThan(0)
  })

  it('routes private invalidations only to the owner’s sessions, live and on replay', async () => {
    const ownerStream = await openClientEvents(owner)
    const memberStream = await openClientEvents(member)
    const legacy = await openEvents(member)
    const start = ownerStream.events.find((e) => e.event === 'ready')!.data.position
    const pad = (await owner.post(`${V1}/pads`, { name: 'Event pad', mutationId: 'mut-event-pad-1' })).body.pad
    const seen = await ownerStream.waitFor((e) => e.event === 'invalidate' && e.data.kind === 'pad' && e.data.id === pad.id)
    expect(seen.data).toMatchObject({ kind: 'pad', mutation: 'pad.created', origin: 'mut-event-pad-1', activityId: null })
    expect(seen.data).not.toHaveProperty('audience')
    // แจ้ง event สาธารณะหลังจากนั้น เพื่อยืนยันว่า stream ของ member ยังทำงานแต่ไม่เห็น Pad
    const task = (await owner.post(`${V1}/tasks`, { title: 'Public marker' })).body.task
    await memberStream.waitFor((e) => e.event === 'invalidate' && e.data.id === task.id)
    await legacy.waitForResource('task', task.id)
    expect(JSON.stringify(memberStream.events)).not.toContain(pad.id)
    expect(JSON.stringify(legacy.events)).not.toContain(pad.id)
    ownerStream.close()
    memberStream.close()
    legacy.close()

    const replayMember = await openClientEvents(member, { after: start })
    const replayOwner = await openClientEvents(owner, { after: start })
    await replayMember.waitFor((e) => e.event === 'invalidate' && e.data.id === task.id)
    await replayOwner.waitFor((e) => e.event === 'invalidate' && e.data.id === pad.id)
    expect(JSON.stringify(replayMember.events)).not.toContain(pad.id)
    replayMember.close()
    replayOwner.close()

    // Pad mutation ไม่เขียน workspace activity
    expect(inspectDb(app, (db) => db.prepare(`SELECT count(*) AS n FROM activity_events WHERE resource_id = ? OR data LIKE ?`).get(pad.id, `%${pad.id}%`))).toEqual({ n: 0 })
  })

  it('deduplicates retried mutations by mutationId', async () => {
    const pad = await newPad(owner, 'Retry')
    const body = { type: 'text', content: text('once'), mutationId: 'mut-retry-block-1' }
    const first = await owner.post(`${V1}/pads/${pad.id}/blocks`, body)
    const again = await owner.post(`${V1}/pads/${pad.id}/blocks`, body)
    expect(again.body.block.id).toBe(first.body.block.id)
    expect((await allBlocks(owner, pad.id)).length).toBe(1)
    const conflict = await owner.post(`${V1}/pads/${pad.id}/blocks`, { ...body, content: text('different') })
    expect(conflict.status).toBe(409)
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT')
  })

  it('refuses edits to archived Pads but allows restoring them', async () => {
    const pad = await newPad(owner, 'Archived edits')
    const block = await addBlock(owner, pad.id, { type: 'text', content: text('frozen') })
    await owner.post(`${V1}/pads/${pad.id}/archive`)
    expect((await owner.patch(`${V1}/pads/${pad.id}/blocks/${block.id}`, { content: text('changed') })).status).toBe(409)
    await owner.post(`${V1}/pads/${pad.id}/restore`)
    expect((await owner.patch(`${V1}/pads/${pad.id}/blocks/${block.id}`, { content: text('changed') })).status).toBe(200)
  })

  it('exports only the requesting human’s Pads and keeps them out of the workspace export', async () => {
    const mine = await newPad(member, 'Mia export pad')
    await addBlock(member, mine.id, { type: 'heading', content: text('Mia heading') })
    const exported = await member.get(`${V1}/pads/export`)
    expect(exported.status).toBe(200)
    expect(exported.headers.get('content-disposition')).toContain('attachment')
    expect(exported.body).toMatchObject({ format: 'alice-pad-export', formatVersion: 1, owner: { displayName: 'Mia Member' } })
    const names = exported.body.pads.map((p: any) => p.name)
    expect(names).toContain('Mia export pad')
    expect(names).not.toContain('Private thoughts')
    expect(exported.body.pads.find((p: any) => p.id === mine.id).blocks[0]).toMatchObject({ type: 'heading', depth: 1, content: text('Mia heading'), taskId: null })

    const out = path.join(tempDataDir('export'), 'ws')
    const res = runCli(['export', '--out', out], { ALICE_DATA_DIR: app.dataDir })
    expect(res.status, res.stderr).toBe(0)
    const all = fs.readFileSync(path.join(out, 'workspace.json'), 'utf8')
    expect(all).not.toContain('Mia heading')
    expect(all).not.toContain('confidential salary note')
  })

  it('preserves Pads exactly through backup and restore', async () => {
    const pad = await newPad(owner, 'Backup pad')
    const h = await addBlock(owner, pad.id, { type: 'heading', content: text('Keep me') })
    await addBlock(owner, pad.id, { type: 'text', content: text('nested'), parentId: h.id })
    const before = await allBlocks(owner, pad.id)
    const dir = path.join(tempDataDir('pad-backup'), 'b')
    const backup = runCli(['backup', '--out', dir], { ALICE_DATA_DIR: app.dataDir })
    expect(backup.status, backup.stderr).toBe(0)
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
    expect(manifest.counts.pads).toBeGreaterThan(0)
    expect(manifest.counts.pad_blocks).toBeGreaterThan(0)

    const target = tempDataDir('pad-restore')
    expect(runCli(['restore', '--from', dir], { ALICE_DATA_DIR: target }).status).toBe(0)
    const restored = await startApp({ dataDir: target })
    try {
      const client = new HttpClient(restored.url)
      expect((await client.post('/api/auth/login', { username: OWNER.username, password: OWNER.password })).status).toBe(200)
      expect(await allBlocks(client, pad.id)).toEqual(before)
      expect((await client.get(`${V1}/pad-search?q=Keep me`)).body.items[0].padId).toBe(pad.id)
    } finally {
      await restored.stop()
    }
  })
})
