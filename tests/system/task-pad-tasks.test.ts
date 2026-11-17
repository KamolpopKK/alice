import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli, startApp, type RunningApp } from '../helpers/app'
import { HttpClient, bootstrapOwner, createAgent, inviteHuman, type AgentHandle } from '../helpers/client'
import { activityFor, inspectDb } from '../helpers/db'
import { connectMcp, type McpHandle } from '../helpers/mcp'

const V1 = '/client/v1'
const text = (t: string) => [{ type: 'text', text: t }]

describe('Task Pads: authoritative task integration', () => {
  let app: RunningApp
  let owner: HttpClient
  let member: HttpClient
  let agent: AgentHandle
  let mcp: McpHandle

  beforeAll(async () => {
    app = await startApp()
    owner = await bootstrapOwner(app)
    member = await inviteHuman(owner, 'mia', 'Mia Member')
    agent = await createAgent(owner, 'Pad Bot')
    mcp = await connectMcp(app.url, agent.token)
  })
  afterAll(async () => {
    await mcp?.close()
    await app?.stop()
  })

  const newPad = async (client: HttpClient, name: string, defaults: Record<string, unknown> = {}) => {
    const res = await client.post(`${V1}/pads`, { name, ...defaults })
    if (res.status !== 201) throw new Error(JSON.stringify(res.body))
    return res.body.pad as { id: string }
  }
  const taskBlock = async (client: HttpClient, padId: string, body: Record<string, unknown>) => client.post(`${V1}/pads/${padId}/blocks`, { type: 'task', ...body })
  const taskCount = () => inspectDb(app, (db) => (db.prepare('SELECT count(*) AS n FROM tasks').get() as { n: number }).n)
  const blockCount = (padId: string) => inspectDb(app, (db) => (db.prepare('SELECT count(*) AS n FROM pad_blocks WHERE pad_id = ?').get(padId) as { n: number }).n)

  it('creates one authoritative task and its Task block in one mutation, with Untitled/Backlog/Unassigned/None defaults', async () => {
    const pad = await newPad(owner, 'Standup')
    const res = await taskBlock(owner, pad.id, { title: '  Follow up with legal  ' })
    expect(res.status).toBe(201)
    const { block } = res.body
    expect(block).toMatchObject({ type: 'task', content: [], depth: 1 })
    expect(block.task).toMatchObject({ title: 'Follow up with legal', status: 'backlog', priority: 'none', assignee: null, project: { name: 'Untitled', isSystem: true } })

    // task เดียวกันเห็นได้จาก Board, Client API และ MCP โดยไม่ต้องเปลี่ยน contract
    const board = (await member.get(`${V1}/board`)).body.columns.backlog.items.map((t: any) => t.id)
    expect(board).toContain(block.task.id)
    const viaMcp = await mcp.ok('get_task', { id: block.task.id })
    expect(JSON.stringify(viaMcp)).toContain('Follow up with legal')

    const created = activityFor(app, block.task.id)[0]
    expect(created.verb).toBe('task.created')
    expect(created.data).toMatchObject({ source: 'task_pad', padId: pad.id })
  })

  it('applies valid Pad defaults only to Project, Status and Assignee, and only for future tasks', async () => {
    const project = (await owner.post(`${V1}/projects`, { name: 'Pad project' })).body.project
    const mia = (await member.get(`${V1}/auth/me`)).body.actor
    const pad = await newPad(owner, 'Defaults')
    const before = (await taskBlock(owner, pad.id, { title: 'Before defaults' })).body.block.task
    await owner.patch(`${V1}/pads/${pad.id}`, { defaultProjectId: project.id, defaultStatus: 'ready', defaultAssigneeId: mia.id })
    const after = (await taskBlock(owner, pad.id, { title: 'After defaults' })).body.block.task
    expect(after).toMatchObject({ project: { id: project.id }, status: 'ready', assignee: { id: mia.id }, priority: 'none', labels: [], dueAt: null })
    expect((await owner.get(`${V1}/tasks/${before.id}`)).body.task).toMatchObject({ status: 'backlog', assignee: null, project: { name: 'Untitled' } })
    expect((await owner.get(`${V1}/pads/${pad.id}`)).body.pad.defaults).toMatchObject({ project: { id: project.id }, status: 'ready', assignee: { id: mia.id } })
  })

  it('fails safely on invalid or archived defaults without a partial task or block', async () => {
    const project = (await owner.post(`${V1}/projects`, { name: 'Soon archived' })).body.project
    const pad = await newPad(owner, 'Bad defaults', { defaultProjectId: project.id })
    expect((await owner.patch(`${V1}/pads/${pad.id}`, { defaultProjectId: 'prj_missing' })).status).toBe(404)
    await owner.post(`${V1}/projects/${project.id}/archive`)
    expect((await owner.patch(`${V1}/pads/${pad.id}`, { defaultProjectId: project.id })).status).toBe(409)
    const tasks = taskCount()
    const res = await taskBlock(owner, pad.id, { title: 'Should not exist' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('INVALID_STATE')
    expect(taskCount()).toBe(tasks)
    expect(blockCount(pad.id)).toBe(0)
    // ล้าง default แล้วสร้างได้ตามปกติ
    await owner.patch(`${V1}/pads/${pad.id}`, { defaultProjectId: null })
    expect((await taskBlock(owner, pad.id, { title: 'Now valid' })).status).toBe(201)

    // วางไม่ได้ (ใต้ Task) ก็ต้องไม่เหลือ task ค้าง
    const parent = (await taskBlock(owner, pad.id, { title: 'Parent task' })).body.block
    const count = taskCount()
    const nested = await taskBlock(owner, pad.id, { title: 'Nested task', parentId: parent.id })
    expect(nested.status).toBe(409)
    expect(nested.body.error.code).toBe('INVALID_RELATIONSHIP')
    expect(taskCount()).toBe(count)
    expect((await taskBlock(owner, pad.id, { title: 'x'.repeat(301) })).status).toBe(400)
  })

  it('allows one Task block per task; placing an already placed task inserts a mention instead', async () => {
    const existing = (await owner.post(`${V1}/tasks`, { title: 'Existing work' })).body.task
    const first = await newPad(owner, 'First')
    const second = await newPad(owner, 'Second')
    const placed = (await taskBlock(owner, first.id, { taskId: existing.id })).body.block
    expect(placed).toMatchObject({ type: 'task', task: { id: existing.id } })
    const again = (await taskBlock(owner, second.id, { taskId: existing.id })).body
    expect(again.block).toMatchObject({ type: 'text', content: [{ type: 'mention', taskId: existing.id }] })
    expect(again.mentions[existing.id].title).toBe('Existing work')
    // ไม่ถูกย้ายออกจาก Pad แรก
    expect((await owner.get(`${V1}/pads/${first.id}/blocks`)).body.items[0].task.id).toBe(existing.id)
    // อีกคนวางก็ได้ mention เช่นกัน และไม่รู้ว่าอยู่ใน Pad ของใคร
    const miaPad = await newPad(member, 'Mia')
    expect((await taskBlock(member, miaPad.id, { taskId: existing.id })).body.block.type).toBe('text')
    const candidates = (await member.get(`${V1}/pad-task-search?q=Existing work`)).body.items
    const hit = candidates.find((c: any) => c.task.id === existing.id)
    expect(hit).toMatchObject({ placed: true, placement: null })
    const mine = (await owner.get(`${V1}/pad-task-search?q=Existing`)).body.items.find((c: any) => c.task.id === existing.id)
    expect(mine).toMatchObject({ placed: true, placement: { padId: first.id, padName: 'First', blockId: placed.id } })
    // database invariant
    expect(inspectDb(app, (db) => db.prepare('SELECT count(*) AS n FROM pad_blocks WHERE task_id = ?').get(existing.id))).toEqual({ n: 1 })
    // ค้นด้วย id ได้
    const byId = (await owner.get(`${V1}/pad-task-search?q=${existing.id}`)).body.items
    expect(byId[0].task.id).toBe(existing.id)
    expect(byId[0].task).toHaveProperty('project.name')
    expect(byId[0].task).toHaveProperty('status')
  })

  it('keeps title and description identical across Pad, Task Detail, Board, Client API and MCP', async () => {
    const pad = await newPad(owner, 'Editing')
    const block = (await taskBlock(owner, pad.id, { title: 'Draft title' })).body.block
    const edited = await owner.patch(`${V1}/pads/${pad.id}/blocks/${block.id}`, { title: 'Final title', description: 'Context:\n\n- bullet\n1. step' })
    expect(edited.status).toBe(200)
    expect(edited.body.block.task).toMatchObject({ title: 'Final title', description: 'Context:\n\n- bullet\n1. step' })
    expect((await member.get(`${V1}/tasks/${block.task.id}`)).body.task).toMatchObject({ title: 'Final title', description: 'Context:\n\n- bullet\n1. step' })
    expect(JSON.stringify(await mcp.ok('get_task', { id: block.task.id }))).toContain('Final title')
    // แก้จาก Task Detail แล้ว Pad เห็นค่าใหม่
    await member.patch(`${V1}/tasks/${block.task.id}`, { description: 'Changed elsewhere' })
    expect((await owner.get(`${V1}/pads/${pad.id}/blocks`)).body.items[0].task.description).toBe('Changed elsewhere')
    expect(inspectDb(app, (db) => db.prepare('SELECT content FROM pad_blocks WHERE id = ?').get(block.id))).toEqual({ content: '[]' })
    // ชื่อที่เปลี่ยนจากที่อื่นค้นใน Pad search ได้
    await mcp.ok('update_task', { id: block.task.id, title: 'Renamed by agent quokka' })
    expect((await owner.get(`${V1}/pad-search?q=quokka`)).body.items[0]).toMatchObject({ padId: pad.id, blockId: block.id, blockType: 'task' })
    const updated = activityFor(app, block.task.id).find((e) => e.verb === 'task.updated' && e.data.source === 'task_pad')
    expect(updated?.data.changes).toHaveProperty('title')
  })

  it('completes from the Pad and reopens to the remembered status or Backlog', async () => {
    const pad = await newPad(owner, 'Completion', { defaultStatus: 'in_progress' })
    const block = (await taskBlock(owner, pad.id, { title: 'Ship it' })).body.block
    const done = await owner.post(`${V1}/pads/${pad.id}/blocks/${block.id}/complete`, {})
    expect(done.body.block).toMatchObject({ previousStatus: 'in_progress', task: { status: 'done' } })
    expect(done.body.block.task.completedAt).not.toBeNull()
    const reopened = await owner.post(`${V1}/pads/${pad.id}/blocks/${block.id}/reopen`, {})
    expect(reopened.body.block).toMatchObject({ previousStatus: null, task: { status: 'in_progress', completedAt: null } })

    // done จากที่อื่น ไม่มีสถานะเดิมที่จำไว้ → Backlog
    await owner.patch(`${V1}/tasks/${block.task.id}`, { status: 'done' })
    expect((await owner.post(`${V1}/pads/${pad.id}/blocks/${block.id}/reopen`, {})).body.block.task.status).toBe('backlog')

    await owner.post(`${V1}/pads/${pad.id}/blocks/${block.id}/complete`, {})
    const removed = await owner.post(`${V1}/pads/${pad.id}/remove-completed`, {})
    expect(removed.body.removed).toEqual([block.id])
    expect((await owner.get(`${V1}/tasks/${block.task.id}`)).body.task).toMatchObject({ status: 'done', archivedAt: null })
  })

  it('keeps archived tasks referenced and supports Restore or Remove from Pad', async () => {
    const pad = await newPad(owner, 'Archive')
    const a = (await taskBlock(owner, pad.id, { title: 'Archived elsewhere' })).body.block
    const b = (await taskBlock(owner, pad.id, { title: 'Neighbour', afterId: a.id })).body.block
    await member.post(`${V1}/tasks/${a.task.id}/archive`)
    const items = (await owner.get(`${V1}/pads/${pad.id}/blocks`)).body.items
    expect(items.map((x: any) => x.id)).toEqual([a.id, b.id])
    expect(items[0].task.archivedAt).not.toBeNull()
    // แก้ task ที่ archive ไม่ได้ ต้อง restore ก่อน
    expect((await owner.patch(`${V1}/pads/${pad.id}/blocks/${a.id}`, { title: 'Edit archived' })).status).toBe(409)
    await owner.post(`${V1}/tasks/${a.task.id}/restore`)
    expect((await owner.get(`${V1}/pads/${pad.id}/blocks`)).body.items[0].task.archivedAt).toBeNull()
    // Remove from Pad ลบเฉพาะ block
    await owner.delete(`${V1}/pads/${pad.id}/blocks/${a.id}`, {})
    expect((await owner.get(`${V1}/tasks/${a.task.id}`)).body.task.archivedAt).toBeNull()
  })

  it('never archives or deletes a task through conversion; Turn into description is explicit', async () => {
    const pad = await newPad(owner, 'Conversions')
    const t = (await taskBlock(owner, pad.id, { title: 'Becomes text' })).body.block
    const asText = await owner.post(`${V1}/pads/${pad.id}/blocks/${t.id}/convert`, { type: 'text' })
    expect(asText.body.block).toMatchObject({ id: t.id, type: 'text', task: null, content: text('Becomes text') })
    expect((await owner.get(`${V1}/tasks/${t.task.id}`)).body.task).toMatchObject({ title: 'Becomes text', archivedAt: null })
    // ตอนนี้ task ไม่มี block แล้ว จึงวางใหม่ได้
    expect((await owner.get(`${V1}/pad-task-search?q=Becomes text`)).body.items[0].placed).toBe(false)

    const note = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'heading', content: text('Promote me to work') })).body.block
    const count = taskCount()
    const promoted = await owner.post(`${V1}/pads/${pad.id}/blocks/${note.id}/convert`, { type: 'task' })
    expect(promoted.body.block).toMatchObject({ type: 'task', content: [], task: { title: 'Promote me to work', status: 'backlog' } })
    expect(taskCount()).toBe(count + 1)

    const parentNote = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'text', content: text('Has child') })).body.block
    await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'text', content: text('child'), parentId: parentNote.id })
    expect((await owner.post(`${V1}/pads/${pad.id}/blocks/${parentNote.id}/convert`, { type: 'task' })).body.error.code).toBe('INVALID_RELATIONSHIP')
    const empty = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'text', content: [] })).body.block
    expect((await owner.post(`${V1}/pads/${pad.id}/blocks/${empty.id}/convert`, { type: 'task' })).status).toBe(400)

    const target = (await owner.post(`${V1}/tasks`, { title: 'Umbrella', description: 'Existing notes' })).body.task
    const small = (await taskBlock(owner, pad.id, { title: 'Small detail' })).body.block
    const turned = await owner.post(`${V1}/pads/${pad.id}/blocks/${small.id}/turn-into-description`, { targetTaskId: target.id })
    expect(turned.body.task.description).toBe('Existing notes\n- Small detail')
    expect(turned.body.removedBlockId).toBe(small.id)
    expect((await owner.get(`${V1}/tasks/${small.task.id}`)).body.task).toMatchObject({ archivedAt: null, title: 'Small detail' })
    expect((await owner.post(`${V1}/pads/${pad.id}/blocks/${promoted.body.block.id}/turn-into-description`, { targetTaskId: promoted.body.block.task.id })).status).toBe(400)
  })

  it('bulk-creates all-or-nothing, ignores blank lines, validates every title and is idempotent', async () => {
    const pad = await newPad(owner, 'Bulk')
    const tasks = taskCount()
    const bad = await owner.post(`${V1}/pads/${pad.id}/blocks/bulk`, { titles: ['One', '', 'x'.repeat(301), 'Three', 'y'.repeat(400)], mutationId: 'bulk-bad-0001' })
    expect(bad.status).toBe(400)
    expect(bad.body.error.details).toEqual([
      { line: 3, message: expect.any(String) },
      { line: 5, message: expect.any(String) },
    ])
    expect(taskCount()).toBe(tasks)
    expect(blockCount(pad.id)).toBe(0)

    const body = { titles: ['Alpha', '   ', 'Beta', '', 'Gamma'], mutationId: 'bulk-good-0001' }
    const ok = await owner.post(`${V1}/pads/${pad.id}/blocks/bulk`, body)
    expect(ok.status).toBe(201)
    expect(ok.body.blocks.map((b: any) => b.task.title)).toEqual(['Alpha', 'Beta', 'Gamma'])
    const retry = await owner.post(`${V1}/pads/${pad.id}/blocks/bulk`, body)
    expect(retry.body.blocks.map((b: any) => b.id)).toEqual(ok.body.blocks.map((b: any) => b.id))
    expect(taskCount()).toBe(tasks + 3)
    expect((await owner.get(`${V1}/pads/${pad.id}/blocks`)).body.items.map((b: any) => b.task.title)).toEqual(['Alpha', 'Beta', 'Gamma'])

    // atomic: activity ล้มกลาง batch → ไม่มีอะไรเหลือ
    // (ใช้ fault injection ของ test runtime ที่ทำให้ task.created ล้ม)
    const failing = await startApp({ env: { ALICE_TEST_FAIL_ACTIVITY_VERB: 'task.created' } })
    try {
      const o = await bootstrapOwner(failing)
      const p = (await o.post(`${V1}/pads`, { name: 'Atomic' })).body.pad
      const res = await o.post(`${V1}/pads/${p.id}/blocks/bulk`, { titles: ['A', 'B'], mutationId: 'bulk-atomic-01' })
      expect(res.status).toBe(500)
      expect((await o.get(`${V1}/pads/${p.id}/blocks`)).body.items).toEqual([])
      expect((await o.get(`${V1}/tasks`)).body.items).toEqual([])
    } finally {
      await failing.stop()
    }

    // Undo ทั้ง batch เป็นหนึ่ง action: archive task และเอา block ออก ไม่มีการลบ task
    const undo = await owner.post(`${V1}/pads/${pad.id}/undo-task-capture`, { blockIds: ok.body.blocks.map((b: any) => b.id) })
    expect(undo.body.archived).toHaveLength(3)
    expect(blockCount(pad.id)).toBe(0)
    for (const b of ok.body.blocks) expect((await owner.get(`${V1}/tasks/${b.task.id}`)).body.task.archivedAt).not.toBeNull()
  })

  it('records task_pad activity without private Pad text and keeps Pad search out of task activity', async () => {
    const pad = await newPad(owner, 'Secret meeting about layoffs')
    await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'heading', content: text('Codename BLUEFIN') })
    const block = (await taskBlock(owner, pad.id, { title: 'Prepare slides' })).body.block
    await owner.post(`${V1}/pads/${pad.id}/blocks/${block.id}/complete`, {})
    const events = activityFor(app, block.task.id)
    expect(events.map((e) => e.verb)).toEqual(['task.created', 'task.updated'])
    for (const e of events) expect(e.data).toMatchObject({ source: 'task_pad', padId: pad.id })
    const all = JSON.stringify((await member.get(`${V1}/activity?limit=200`)).body)
    expect(all).not.toContain('BLUEFIN')
    expect(all).not.toContain('layoffs')
  })

  it('removes Task blocks of purged tasks and clears purged project defaults', async () => {
    const project = (await owner.post(`${V1}/projects`, { name: 'Purged project' })).body.project
    const pad = await newPad(owner, 'Purge', { defaultProjectId: project.id })
    const block = (await taskBlock(owner, pad.id, { title: 'Will be purged' })).body.block
    await owner.post(`${V1}/tasks/${block.task.id}/archive`)
    await owner.post(`${V1}/projects/${project.id}/archive`)
    const cutoff = new Date(Date.now() + 1000).toISOString()
    await new Promise((r) => setTimeout(r, 1100))
    const dry = runCli(['purge', '--before', cutoff, '--archived'], { ALICE_DATA_DIR: app.dataDir })
    const code = /--confirm (\w+)/.exec(dry.stdout)![1]
    const exec = runCli(['purge', '--before', cutoff, '--archived', '--execute', '--confirm', code], { ALICE_DATA_DIR: app.dataDir })
    expect(exec.status, exec.stderr).toBe(0)
    expect(blockCount(pad.id)).toBe(0)
    expect((await owner.get(`${V1}/pads/${pad.id}`)).body.pad.defaults.project).toBeNull()
  })
})
