import AxeBuilder from '@axe-core/playwright'
import { FakeNativeCore } from './desktop-bridge'
import { expect, test } from './fixtures'
import { createWorkspace, listWorkspaces } from '../../src/local/registry'
import { localHome, stopLocalDaemons } from '../helpers/local'

/** Local-first Desktop onboarding, workspace switching and recovery. */
test.afterAll(stopLocalDaemons)

test.describe('Alice Desktop with Local workspaces', () => {
  test('first launch reaches a focused Task Pad without URL, password or sign-in', async ({ app, page }) => {
    const home = localHome()
    const native = await FakeNativeCore.attach(page, { localHome: home })
    await page.goto(app.url)
    await expect(page.getByRole('heading', { name: 'Welcome to Alice' })).toBeFocused()
    await expect(page.getByText('Step 1 of 4')).toBeVisible()
    await page.getByRole('button', { name: 'Get started' }).click()
    await expect(page.getByRole('heading', { name: 'Where should your work live?' })).toBeFocused()
    // ทาง Local ไม่ถาม URL, password, port หรือ database
    await expect(page.getByLabel(/URL|password|port|database/i)).toHaveCount(0)
    await expect(page.getByRole('radio', { name: /On this computer/ })).toBeChecked()
    await expect(page.getByLabel('Your name')).toHaveValue('Local Owner')
    await page.getByLabel('Your name').fill('Kim')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Work with your terminal and agents' })).toBeFocused()
    for (const box of await page.getByRole('checkbox').all()) await expect(box).toBeChecked()
    await page.getByRole('button', { name: 'Continue' }).click()
    // onboarding ติดตั้ง CLI + skill ของ Codex/Claude (bridge รัน CLI จริงแบบ sync): บน CI ใช้เกิน 5 วินาทีได้
    await expect(page.getByRole('heading', { name: 'Capture your first task' })).toBeFocused({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Open my Task Pad' }).click()

    // onboarding ติดตั้ง CLI + skill ของ Codex/Claude ก่อนเปิด (bridge รัน CLI จริง 3 ครั้งแบบ sync): บน CI ใช้เกิน 5 วินาทีได้
    await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toContainText('Personal', { timeout: 20_000 })
    await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toContainText('Local')
    await expect(page.getByRole('textbox', { name: 'New task' }).first()).toBeFocused()
    expect(listWorkspaces(home)).toHaveLength(1)
    expect(native.calls).not.toContain('auth_login_start')

    // ชื่อที่แก้ระหว่าง onboarding ถูกใช้เป็นผู้สร้างงาน
    await page.keyboard.type('First local task')
    await page.keyboard.press('Enter')
    const conn = await native.localConnect(native.active!)
    await expect
      .poll(async () => {
        const res = await fetch(`${conn.baseUrl}/client/v1/tasks?q=First`, { headers: { authorization: `Bearer ${conn.capability}` } })
        return ((await res.json()) as { items: Array<{ createdBy: { displayName: string } }> }).items[0]?.createdBy.displayName
      })
      .toBe('Kim')
    // หลังงานแรก: หน้าตั้งค่า agent ขึ้นก่อน (ครั้งเดียว) พร้อม prompt ที่ไม่ต้องใช้ token แล้วค่อยไป Home
    await page.getByRole('button', { name: 'Done, connect an agent' }).click()
    await expect(page.getByRole('status').or(page.getByRole('alert')).filter({ hasText: 'One more step: connect your agent' })).toBeVisible()
    const guide = page.getByRole('region', { name: 'Set up your agent' })
    await expect(guide.getByRole('tab', { name: 'Claude Code' })).toHaveAttribute('aria-selected', 'true')
    await expect(guide).toContainText('alice integration enable claude-code')
    await expect(guide).toContainText('alice --as claude-code workspace list --json')
    await expect(guide).not.toContainText(/token file|Paste the Alice agent token|\/mcp\/v1/)
    await guide.getByRole('tab', { name: 'Codex' }).click()
    await expect(guide).toContainText('alice integration enable codex')
    await expect(page.getByRole('region', { name: 'Agents on this computer' })).toBeVisible()
    await page.getByRole('button', { name: 'Continue to Home' }).click()
    await expect(page.getByRole('region', { name: 'Just captured' }).getByRole('link', { name: 'First local task' })).toBeVisible()
    // Agents เปิดเองภายหลังได้ แต่ไม่มีแถบ "One more step" อีก
    await page.goto(`${app.url}/agents`)
    await expect(page.getByRole('region', { name: 'Set up your agent' })).toBeVisible()
    await expect(page.getByText('One more step: connect your agent')).toHaveCount(0)

    // เปิดใหม่: ไม่ onboarding ซ้ำ และไม่สร้าง Personal ซ้ำ
    await page.reload()
    await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toContainText('Personal')
    expect(listWorkspaces(home)).toHaveLength(1)
  })

  test('switches between Local workspaces and a Remote server without showing the previous data', async ({ app, page }) => {
    const home = localHome()
    const a = createWorkspace(home, { name: 'Notes', alias: 'notes-a' })
    createWorkspace(home, { name: 'Notes', alias: 'notes-b' })
    const native = await FakeNativeCore.attach(page, { localHome: home })
    await native.handle('profile_use', { name: a.id })
    await page.goto(`${app.url}/tasks/new`)
    await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toContainText('notes-a')
    await page.getByLabel('Title').fill('Only in notes-a')
    await page.getByRole('button', { name: 'Create task' }).click()
    await expect(page.getByRole('heading', { name: 'Only in notes-a' })).toBeVisible()

    await page.getByRole('button', { name: 'Switch workspace' }).click()
    await expect(page.getByRole('heading', { name: 'Local workspaces' })).toBeVisible()
    await page.getByRole('button', { name: 'Use Notes (notes-b)' }).click()
    await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toContainText('notes-b')
    await expect(page).toHaveURL(`${app.url}/`)
    await page.goto(`${app.url}/tasks`)
    await expect(page.getByText('Only in notes-a')).toHaveCount(0)

    // Remote ยังต้อง sign in เสมอ
    await page.getByRole('button', { name: 'Switch workspace' }).click()
    await page.getByLabel('Profile name').fill('team')
    await page.getByLabel('Server URL').fill(app.url)
    await page.getByRole('button', { name: 'Add server' }).click()
    await expect(page.getByRole('heading', { name: 'Sign in to team' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Server profile' })).toContainText('Remote')
  })

  test('creates, renames and aliases Local workspaces from the keyboard', async ({ app, page }) => {
    const home = localHome()
    createWorkspace(home)
    const native = await FakeNativeCore.attach(page, { localHome: home })
    await native.handle('profile_use', { name: listWorkspaces(home)[0].id })
    await page.goto(app.url)
    await page.getByRole('button', { name: 'Switch workspace' }).click()
    await page.getByLabel('New Local workspace').fill('Side projects')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toContainText('Side projects')
    await page.getByRole('button', { name: 'Switch workspace' }).click()
    await page.getByRole('button', { name: 'Change alias of side-projects' }).click()
    await page.getByLabel('New alias for Side projects').fill('side')
    await page.keyboard.press('Enter')
    await expect(page.getByText('alias side ·')).toBeVisible()
    await page.getByRole('button', { name: 'Rename side' }).click()
    await page.getByLabel('New name for Side projects').fill('Hobbies')
    await page.keyboard.press('Enter')
    await expect(page.getByText('Hobbies', { exact: true })).toBeVisible()
    expect(listWorkspaces(home).map((w) => w.alias).sort()).toEqual(['personal', 'side'])
  })

  test('deep links select their Local workspace first and unknown ids never fall back', async ({ app, page }) => {
    const home = localHome()
    const a = createWorkspace(home, { name: 'A' })
    const b = createWorkspace(home, { name: 'B' })
    const native = await FakeNativeCore.attach(page, { localHome: home })
    await native.handle('profile_use', { name: a.id })
    await page.goto(`${app.url}/tasks/new`)
    // งานใน B สร้างผ่าน daemon ของ B โดยตรง
    const conn = await native.localConnect(b.id)
    const created = await fetch(`${conn.baseUrl}/client/v1/tasks`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${conn.capability}` }, body: JSON.stringify({ title: 'Linked into B' }) })
    const task = ((await created.json()) as { task?: { id: string }; id?: string })
    const id = task.task?.id ?? task.id!

    expect(await native.deliverDeepLink(`alice://open/task/${id}?workspace=wsp_doesnotexist0000`)).toBe('unknown_workspace')
    await expect(page.getByRole('alert')).toContainText('does not exist on this computer')
    await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toContainText(a.alias)

    expect(await native.deliverDeepLink(`alice://open/task/${id}?workspace=${b.id}`)).toBe('accepted')
    await expect(page.getByRole('heading', { name: 'Linked into B' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toContainText(b.alias)
  })

  test('switching workspace with an unsaved document asks first and never carries the draft across', async ({ app, page }) => {
    const home = localHome()
    const a = createWorkspace(home, { name: 'Docs', alias: 'docs-a' })
    createWorkspace(home, { name: 'Docs', alias: 'docs-b' })
    const native = await FakeNativeCore.attach(page, { localHome: home })
    await native.handle('profile_use', { name: a.id })
    await page.goto(`${app.url}/documents/new`)
    await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toContainText('docs-a')
    await page.getByLabel('Document title').fill('Draft only in docs-a')
    const leave = page.getByRole('dialog', { name: 'Discard unsaved changes?' })

    await page.getByRole('button', { name: 'Switch workspace' }).click()
    await expect(leave).toBeVisible()
    await leave.getByRole('button', { name: 'Stay and keep editing' }).click()
    await expect(page.getByRole('heading', { name: 'Local workspaces' })).toHaveCount(0)
    await expect(page.getByLabel('Document title')).toHaveValue('Draft only in docs-a')

    await page.getByRole('button', { name: 'Switch workspace' }).click()
    await leave.getByRole('button', { name: 'Discard changes' }).click()
    await page.getByRole('button', { name: 'Use Docs (docs-b)' }).click()
    await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toContainText('docs-b')
    await page.goto(`${app.url}/documents/new`)
    await expect(page.getByLabel('Document title')).toHaveValue('')
    const conn = await native.localConnect(native.active!)
    const docs = await fetch(`${conn.baseUrl}/client/v1/documents?archived=all`, { headers: { authorization: `Bearer ${conn.capability}` } })
    expect(((await docs.json()) as { items: unknown[] }).items).toHaveLength(0)
  })

  test('a workspace change from outside keeps the draft in its own workspace and never shows it in the other', async ({ app, page }) => {
    const home = localHome()
    const a = createWorkspace(home, { name: 'Ext', alias: 'ext-a' })
    const b = createWorkspace(home, { name: 'Ext', alias: 'ext-b' })
    const native = await FakeNativeCore.attach(page, { localHome: home })
    const conn = await native.localConnect(b.id)
    const created = await fetch(`${conn.baseUrl}/client/v1/tasks`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${conn.capability}` }, body: JSON.stringify({ title: 'Task in B' }) })
    const taskId = ((await created.json()) as { task: { id: string } }).task.id
    await native.handle('profile_use', { name: a.id })
    await page.goto(`${app.url}/documents/new`)
    await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toContainText('ext-a')
    await page.getByLabel('Document title').fill('Draft of ext-a')

    // ลิงก์ภายใน workspace เดียวกันผ่าน guard: Stay อยู่หน้าเดิมพร้อม draft
    const connA = await native.localConnect(a.id)
    const inA = await fetch(`${connA.baseUrl}/client/v1/tasks`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${connA.capability}` }, body: JSON.stringify({ title: 'Task in A' }) })
    const taskA = ((await inA.json()) as { task: { id: string } }).task.id
    expect(await native.deliverDeepLink(`alice://open/task/${taskA}?workspace=${a.id}`)).toBe('accepted')
    const leave = page.getByRole('dialog', { name: 'Discard unsaved changes?' })
    await leave.getByRole('button', { name: 'Stay and keep editing' }).click()
    await expect(page).toHaveURL(/\/documents\/new$/)
    await expect(page.getByLabel('Document title')).toHaveValue('Draft of ext-a')

    // ลิงก์จากภายนอกพาไป workspace B
    expect(await native.deliverDeepLink(`alice://open/task/${taskId}?workspace=${b.id}`)).toBe('accepted')
    await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toContainText('ext-b')
    // การสลับจากภายนอก unmount หน้าเขียนโดยไม่ทิ้ง draft; ไปหน้า New ใน B แบบไม่ reload (RAM ยังอยู่) ต้องว่าง
    await expect(page.getByRole('heading', { name: 'Task in B' })).toBeVisible()
    const newDocument = async () => {
      await page.getByRole('button', { name: 'New', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Document' }).click()
    }
    await newDocument()
    await expect(page.getByLabel('Document title')).toHaveValue('')
    // กลับไป A: draft ของ A ยังอยู่
    await page.getByRole('button', { name: 'Switch workspace' }).click()
    await page.getByRole('button', { name: 'Use Ext (ext-a)' }).click()
    await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toContainText('ext-a')
    await newDocument()
    await expect(page.getByLabel('Document title')).toHaveValue('Draft of ext-a')
    const docsB = await fetch(`${conn.baseUrl}/client/v1/documents?archived=all`, { headers: { authorization: `Bearer ${conn.capability}` } })
    expect(((await docsB.json()) as { items: unknown[] }).items).toHaveLength(0)
  })

  test('closing or quitting with an unsaved document asks in the app and answers the core once', async ({ app, page }) => {
    const home = localHome()
    const ws = createWorkspace(home, { name: 'Close' })
    const native = await FakeNativeCore.attach(page, { localHome: home })
    await native.handle('profile_use', { name: ws.id })
    await page.goto(`${app.url}/documents/new`)
    await expect(page.getByLabel('Document title')).toBeVisible()
    expect(native.editorDirty).toBe(false)
    await page.getByLabel('Document title').fill('Secret plan')
    await expect.poll(() => native.editorDirty).toBe(true)
    // core รู้แค่ว่ามีของค้าง ไม่เคยได้เนื้อหา
    expect(JSON.stringify(native.calls)).not.toContain('Secret plan')

    const leave = page.getByRole('dialog', { name: 'Discard unsaved changes?' })
    await native.emit('alice://editor-leave-requested', { requestId: 'leave-1', action: 'close' })
    await expect(leave).toContainText('close the window')
    await leave.getByRole('button', { name: 'Stay and keep editing' }).click()
    await expect.poll(() => native.leaveReplies).toEqual([{ requestId: 'leave-1', discard: false }])
    await expect(page.getByLabel('Document title')).toHaveValue('Secret plan')

    await native.emit('alice://editor-leave-requested', { requestId: 'leave-2', action: 'exit' })
    await expect(leave).toContainText('quit Alice')
    await leave.getByRole('button', { name: 'Discard changes' }).click()
    await expect.poll(() => native.leaveReplies.at(-1)).toEqual({ requestId: 'leave-2', discard: true })
    expect(native.leaveReplies).toHaveLength(2)
  })

  test('a slow check of the previous workspace never takes the screen back after a switch', async ({ app, page }) => {
    const home = localHome()
    const a = createWorkspace(home, { name: 'Slow A' })
    const b = createWorkspace(home, { name: 'Fast B' })
    const native = await FakeNativeCore.attach(page, { localHome: home })
    const conn = await native.localConnect(b.id)
    const created = await fetch(`${conn.baseUrl}/client/v1/tasks`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${conn.capability}` }, body: JSON.stringify({ title: 'Only in B' }) })
    const id = ((await created.json()) as { task: { id: string } }).task.id
    // A กำลังเปิด (daemon ช้า) ตอนที่ลิงก์ของ B มาถึง
    let releaseA = () => {}
    native.holdTest.set(a.id, new Promise<void>((resolve) => (releaseA = resolve)))
    await native.handle('profile_use', { name: a.id })
    await page.goto(`${app.url}/`)
    await expect.poll(() => native.calls.filter((c) => c === 'profile_test').length).toBeGreaterThan(0)
    expect(await native.deliverDeepLink(`alice://open/task/${id}?workspace=${b.id}`)).toBe('accepted')
    await expect(page.getByRole('heading', { name: 'Only in B' })).toBeVisible()
    releaseA()
    await page.waitForTimeout(500)
    await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toContainText(b.alias)
    await expect(page.getByRole('heading', { name: 'Only in B' })).toBeVisible()
  })

  test('a capture shortcut queued before a switch never lands in the new workspace', async ({ app, page }) => {
    const home = localHome()
    const a = createWorkspace(home, { name: 'A' })
    const b = createWorkspace(home, { name: 'B' })
    const native = await FakeNativeCore.attach(page, { localHome: home })
    await native.handle('profile_use', { name: a.id })
    await page.goto(app.url)
    await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toContainText(a.alias)
    native.pendingCapture = { id: 99, intent: 'new-pad' }
    await native.handle('profile_use', { name: b.id })
    await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toContainText(b.alias)
    expect(native.pendingCapture).toBeNull()
    await expect(page).not.toHaveURL(/\/pads/)
  })

  test('a Local startup failure shows only the keyboard-accessible recovery surface', async ({ app, page }) => {
    const home = localHome()
    const ws = createWorkspace(home)
    const native = await FakeNativeCore.attach(page, { localHome: home })
    await native.handle('profile_use', { name: ws.id })
    native.failLocal = 'database is locked by an unexpected process'
    await page.goto(app.url)
    await expect(page.getByRole('heading', { name: 'Personal could not open' })).toBeFocused()
    await expect(page.getByRole('navigation')).toHaveCount(0)
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused()
    await page.getByRole('button', { name: 'Open data folder' }).press('Enter')
    expect(native.opened).toContain(`folder:${ws.id}`)
    await page.getByText('Technical details').click()
    await expect(page.getByText('database is locked by an unexpected process')).toBeVisible()
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    expect(axe.violations.map((v) => v.id)).toEqual([])

    native.failLocal = null
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toContainText('Personal')
  })

  test('the recovery surface runs diagnostics and restores the latest backup after confirmation', async ({ app, page }) => {
    const home = localHome()
    const ws = createWorkspace(home)
    const native = await FakeNativeCore.attach(page, { localHome: home })
    await native.handle('profile_use', { name: ws.id })
    const conn = await native.localConnect(ws.id)
    const post = (p: string, body: unknown) => fetch(`${conn.baseUrl}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${conn.capability}` }, body: JSON.stringify(body) })
    await post('/client/v1/tasks', { title: 'Saved before the backup' })
    expect((await post('/local/v1/backups', {})).status).toBe(201)
    await post('/client/v1/tasks', { title: 'Lost with the damaged copy' })
    native.failLocal = 'SQLite quick_check reported: database disk image is malformed'

    await page.goto(app.url)
    await expect(page.getByRole('heading', { name: 'Personal could not open' })).toBeVisible()
    await page.getByRole('button', { name: 'Diagnostics' }).click()
    await expect(page.getByRole('region', { name: 'Diagnostics' })).toContainText('quick_check')
    await page.getByRole('button', { name: 'Restore latest backup' }).click()
    await expect(page.getByText('Its current data is backed up first')).toBeVisible()
    await page.getByRole('button', { name: 'Replace with latest backup' }).click()
    await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toContainText('Personal')
    // daemon อาจยังเริ่มใหม่อยู่หลัง restore: ถามซ้ำจนอ่านรายการได้ (คำตอบระหว่างนั้นไม่มี items)
    await expect
      .poll(async () => {
        const after = await native.localConnect(ws.id)
        const res = await fetch(`${after.baseUrl}/client/v1/tasks`, { headers: { authorization: `Bearer ${after.capability}` } }).catch(() => null)
        const body = res?.ok ? ((await res.json()) as { items?: Array<{ title: string }> }) : null
        return body?.items?.map((t) => t.title) ?? null
      }, { timeout: 15_000 })
      .toEqual(['Saved before the backup'])
  })

  test('onboarding installs only the consented tools; Settings disables an agent and offers to unassign its work', async ({ app, page }) => {
    const home = localHome()
    const native = await FakeNativeCore.attach(page, { localHome: home })
    await page.goto(app.url)
    await page.getByRole('button', { name: 'Get started' }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('checkbox', { name: /Claude Code/ }).uncheck()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Open my Task Pad' }).click({ timeout: 20_000 })
    await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toContainText('Personal', { timeout: 20_000 })
    const fsMod = await import('node:fs')
    const pathMod = await import('node:path')
    expect(fsMod.existsSync(pathMod.join(native.userHome, '.local/bin/alice'))).toBe(true)
    expect(fsMod.existsSync(pathMod.join(native.userHome, '.codex/skills/alice/SKILL.md'))).toBe(true)
    expect(fsMod.existsSync(pathMod.join(native.userHome, '.claude/skills/alice'))).toBe(false)

    // Codex รับงานไปหนึ่งชิ้น แล้วคนปิด Codex จาก Settings
    const ws = listWorkspaces(home)[0]
    const created = native.runCli(['task', 'create', '--workspace', ws.id, '--title', 'Codex has this', '--status', 'ready'])
    native.runCli(['--as', 'codex', '--workspace', ws.id, 'task', 'claim', created.id])
    await page.getByRole('button', { name: 'Switch workspace' }).click()
    const agents = page.getByRole('region', { name: 'Agents on this computer' })
    await expect(agents).toContainText('Codex')
    await agents.getByRole('button', { name: 'Disable Codex' }).click()
    await expect(page.getByText('1 open task(s) in personal are still assigned to Codex')).toBeVisible()
    await page.getByRole('button', { name: 'Unassign them in personal' }).click()
    await expect(page.getByText('still assigned to Codex')).toHaveCount(0)
    await expect(agents.getByRole('button', { name: 'Enable Codex' })).toBeVisible()
    const task = native.runCli(['task', 'show', created.id, '--workspace', ws.id])
    expect(task.assignee).toBeNull()
  })

  test('every onboarding stage passes axe WCAG 2.2 AA and fits a 320px window', async ({ app, browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 720 } })
    const page = await ctx.newPage()
    await FakeNativeCore.attach(page, { localHome: localHome() })
    await page.goto(app.url)
    const check = async (heading: string) => {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
      expect(axe.violations.map((v) => v.id), heading).toEqual([])
    }
    await check('Welcome to Alice')
    await page.getByRole('button', { name: 'Get started' }).click()
    await check('Where should your work live?')
    await page.getByRole('button', { name: 'Continue' }).click()
    await check('Work with your terminal and agents')
    await page.getByRole('button', { name: 'Skip for now' }).click()
    await check('Capture your first task')
    await ctx.close()
  })

  test('onboarding goes back, skips agents, and resumes at the last stage after a restart without creating anything twice', async ({ app, page }) => {
    const home = localHome()
    const native = await FakeNativeCore.attach(page, { localHome: home })
    await page.goto(app.url)
    await page.getByRole('button', { name: 'Get started' }).click()
    await page.getByLabel('Workspace name').fill('Studio')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page.getByLabel('Workspace name')).toHaveValue('Studio')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Skip for now' }).click()
    await expect(page.getByRole('heading', { name: 'Capture your first task' })).toBeFocused()
    expect(native.calls).not.toContain('tools_apply')
    expect(listWorkspaces(home)).toHaveLength(1)

    // ปิดแอปตรงนี้แล้วเปิดใหม่: กลับมาที่ขั้นงานแรก ไม่สร้าง workspace ใหม่
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Capture your first task' })).toBeVisible()
    expect(listWorkspaces(home)).toHaveLength(1)
    await page.getByRole('button', { name: 'Open my Task Pad' }).click()
    await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toContainText('Studio')
    await expect(page.getByRole('textbox', { name: 'New task' }).first()).toBeFocused()
    // จบแล้ว: เปิดใหม่ไม่ย้อนกลับไป onboarding
    await page.reload()
    await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toContainText('Studio')
    await expect(page.getByRole('heading', { name: 'Capture your first task' })).toHaveCount(0)
  })

  test('choosing a team server signs in there, then onboarding continues to the first task and Home', async ({ app, owner, page }) => {
    const native = await FakeNativeCore.attach(page, { localHome: localHome() })
    await page.goto(app.url)
    await page.getByRole('button', { name: 'Get started' }).click()
    await page.getByRole('radio', { name: /On a team server/ }).check()
    await expect(page.getByLabel('Your name')).toHaveCount(0)
    await page.getByRole('button', { name: 'Connect to a server' }).click()
    await page.getByLabel('Profile name').fill('team')
    await page.getByLabel('Server URL').fill(app.url)
    await page.getByRole('button', { name: 'Add server' }).click()
    await page.getByRole('button', { name: 'Sign in with browser' }).click()
    await expect(page.getByLabel('Sign-in code')).toBeVisible()
    await owner.post('/client/v1/device/approve', { userCode: native.pendingUserCode })
    // กลับเข้า onboarding ขั้นที่ 3 หลัง sign in
    await expect(page.getByRole('heading', { name: 'You’re connected' })).toBeFocused({ timeout: 15_000 })
    await expect(page.getByText('Step 3 of 4')).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: 'Capture your first task' })).toBeFocused()
    await page.getByRole('button', { name: 'Open my Task Pad' }).click()
    await expect(page.getByRole('textbox', { name: 'New task' }).first()).toBeFocused({ timeout: 15_000 })
    await page.keyboard.type('First team task')
    await page.keyboard.press('Enter')
    await expect.poll(async () => ((await owner.get('/client/v1/tasks?q=First%20team')).body.items as unknown[]).length).toBe(1)
    await page.getByRole('button', { name: 'Done, connect an agent' }).click()
    // บน server: คู่มือ MCP ของหน้า Agents (ไม่ใช่ของ Local)
    await expect(page.getByRole('heading', { name: 'Connect an agent' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Set up your agent' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Continue to Home' }).click()
    await expect(page.getByRole('region', { name: 'Just captured' }).getByRole('link', { name: 'First team task' })).toBeVisible()
    // จบแล้ว: เปิดใหม่ไม่ย้อนกลับไป onboarding
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  })
})
