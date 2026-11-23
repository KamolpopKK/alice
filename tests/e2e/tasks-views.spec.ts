import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { agentClient, createAgent, type HttpClient } from '../helpers/client'
import { expect, signIn, test } from './fixtures'

/** Unified Tasks views and the shared Task Detail (side panel, sheet and full page). */
const V1 = '/client/v1'
const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
const panel = (page: Page) => page.getByRole('complementary', { name: 'Task details' })

async function newTask(owner: HttpClient, body: Record<string, unknown>) {
  return (await owner.post(`${V1}/tasks`, body)).body.task as { id: string; title: string }
}

test('a task opens beside the List view, Back and Escape close it and focus returns to the task', async ({ app, owner, page }) => {
  const t = await newTask(owner, { title: `Panel task ${stamp()}`, priority: 'high' })
  await signIn(page, app)
  await page.goto(`${app.url}/tasks?view=list`)
  const link = page.getByRole('link', { name: t.title })
  await link.click()
  await expect(page).toHaveURL(new RegExp(`view=list&task=${t.id}$`))
  await expect(panel(page).getByRole('heading', { level: 2, name: t.title })).toBeFocused()
  // หน้าเดิมยังอยู่ ไม่ได้เปลี่ยนไปหน้าใหม่
  await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible()
  await expect(link).toHaveAttribute('aria-current', 'true')

  await page.goBack()
  await expect(panel(page)).toHaveCount(0)
  await expect(page).toHaveURL(/view=list$/)

  await link.focus()
  await page.keyboard.press('Enter')
  await expect(panel(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)
  await expect(link).toBeFocused()

  // ลิงก์ตรงไปที่ task ใน view ยังใช้ได้ และปุ่มปิดก็คืนโฟกัส
  await page.goto(`${app.url}/tasks?view=board&task=${t.id}`)
  await expect(panel(page).getByRole('heading', { name: t.title })).toBeVisible()
  await panel(page).getByRole('button', { name: 'Close task details' }).click()
  await expect(page).toHaveURL(/\/tasks\?view=board$/)
  await expect(page.getByRole('link', { name: t.title })).toBeFocused()
})

test('panel and full page expose the same fields, actions and sections', async ({ app, owner, page }) => {
  const t = await newTask(owner, { title: `Parity ${stamp()}` })
  await signIn(page, app)
  const expectSame = async (scope: ReturnType<Page['locator']>) => {
    for (const label of ['Status', 'Assignee', 'Priority', 'Project', 'Due date']) await expect(scope.getByLabel(label, { exact: true })).toBeVisible()
    for (const name of ['Edit', 'Archive', 'Complete task…', 'Set parent', 'Add blocker', 'Link existing', 'Comment']) await expect(scope.getByRole('button', { name, exact: true })).toBeVisible()
    for (const heading of ['Comments', 'Relationships', 'Documents', 'Activity']) await expect(scope.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }
  await page.goto(`${app.url}/tasks?view=list&task=${t.id}`)
  await expectSame(panel(page))
  await panel(page).getByRole('link', { name: 'Open full page' }).click()
  await expect(page).toHaveURL(new RegExp(`/tasks/${t.id}$`))
  await expect(page.getByRole('heading', { level: 1, name: t.title })).toBeVisible()
  await expectSame(page.locator('#main'))
})

test('field changes show Saved next to the field, and failures stay next to the field or task', async ({ app, owner, page }) => {
  const t = await newTask(owner, { title: `Feedback ${stamp()}`, status: 'ready' })
  await signIn(page, app)
  await page.goto(`${app.url}/tasks?view=list&task=${t.id}`)
  const p = panel(page)
  await p.getByLabel('Priority').selectOption('urgent')
  await expect(p.locator('.task-property').filter({ has: page.getByLabel('Priority') }).getByRole('status')).toHaveText('Saved')
  expect((await owner.get(`${V1}/tasks/${t.id}`)).body.task.priority).toBe('urgent')
  // แถวในรายการอัปเดตตามโดยไม่ต้อง reload
  await expect(page.getByRole('row', { name: new RegExp(t.title) }).getByText('Urgent')).toBeVisible()

  // server ปฏิเสธ: ข้อความผิดพลาดอยู่ใต้ช่องที่เปลี่ยน และค่าเดิมยังอยู่
  await page.route(`**/client/v1/tasks/${t.id}`, (route) =>
    route.request().method() === 'PATCH' ? route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'Due date is not valid.' } }) }) : route.fallback(),
  )
  await p.getByLabel('Due date').fill('2030-01-02')
  await expect(p.locator('.task-property').filter({ has: page.getByLabel('Due date') })).toContainText('Due date is not valid.')
  await page.getByLabel(`Status of ${t.title}`).selectOption('done')
  await expect(page.getByRole('row', { name: new RegExp(t.title) })).toContainText('Status not changed')
  await page.unroute(`**/client/v1/tasks/${t.id}`)
  expect((await owner.get(`${V1}/tasks/${t.id}`)).body.task.status).toBe('ready')
})

test('editing warns when an agent changes the task meanwhile, and agent changes are attributed live', async ({ app, owner, page }) => {
  const botName = `Editor Bot ${stamp()}`
  const agent = await createAgent(owner, botName)
  const t = await newTask(owner, { title: `Conflict ${stamp()}`, status: 'ready' })
  await signIn(page, app)
  await page.goto(`${app.url}/tasks?view=board&task=${t.id}`)
  const p = panel(page)
  await p.getByRole('button', { name: 'Edit' }).click()
  await p.getByLabel('Title').fill('My local title')
  await agentClient(app, agent).patch(`/api/tasks/${t.id}`, { title: `${t.title} (agent)`, status: 'in_progress' })
  const warning = p.getByRole('alert').filter({ hasText: 'This task changed while you were editing' })
  await expect(warning).toContainText(botName)
  // สถานะที่ agent เปลี่ยนขึ้นทันที ทั้งใน panel และบนบอร์ด
  await expect(p.getByLabel('Status', { exact: true })).toHaveValue('in_progress')
  await expect(page.getByRole('region', { name: 'In progress' }).getByRole('link', { name: `${t.title} (agent)` })).toBeVisible()
  await warning.getByRole('button', { name: 'Load their changes' }).click()
  await expect(p.getByLabel('Title')).toHaveValue(`${t.title} (agent)`)
  await p.getByRole('button', { name: 'Cancel' }).click()
  await expect(p.getByRole('region', { name: 'Activity' })).toContainText(botName)
})

test('filters, search and sort are shared across views, and saved views restore them on every device', async ({ app, owner, page, browser }) => {
  const s = stamp()
  await newTask(owner, { title: `Shared urgent ${s}`, priority: 'urgent', status: 'ready' })
  await newTask(owner, { title: `Shared low ${s}`, priority: 'low', status: 'ready' })
  await signIn(page, app)
  await page.goto(`${app.url}/tasks?view=list`)
  await page.getByLabel('Search tasks').fill(`Shared`)
  await page.getByRole('button', { name: 'Filters' }).click()
  await page.getByRole('dialog', { name: 'Filters' }).getByLabel('Priority').selectOption('urgent')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Filters, 1 active' })).toBeVisible()
  await expect(page.getByRole('link', { name: `Shared urgent ${s}` })).toBeVisible()
  await expect(page.getByRole('link', { name: `Shared low ${s}` })).toHaveCount(0)

  await page.getByRole('radio', { name: 'Board' }).click()
  await expect(page.getByRole('region', { name: 'Ready' }).getByRole('link', { name: `Shared urgent ${s}` })).toBeVisible()
  await expect(page.getByRole('link', { name: `Shared low ${s}` })).toHaveCount(0)

  await page.getByRole('button', { name: 'Saved views' }).click()
  const saved = page.getByRole('dialog', { name: 'Saved views' })
  await saved.getByLabel('Name').fill(`Urgent ${s}`)
  await saved.getByRole('button', { name: 'Save current view' }).click()
  await expect(saved.getByRole('button', { name: `Urgent ${s}`, exact: true })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.goto(`${app.url}/tasks?view=my-work`)
  await page.getByRole('button', { name: 'Saved views' }).click()
  await page.getByRole('dialog', { name: 'Saved views' }).getByRole('button', { name: `Urgent ${s}`, exact: true }).click()
  await expect(page.getByRole('radio', { name: 'Board' })).toHaveAttribute('aria-checked', 'true')
  await expect(page).toHaveURL(/priority=urgent/)
  await expect(page.getByLabel('Search tasks')).toHaveValue('Shared')
  // อุปกรณ์อื่นของคนเดียวกันเห็น view เดียวกัน (เก็บที่ server)
  const other = await browser.newContext()
  const second = await other.newPage()
  await signIn(second, app)
  await second.goto(`${app.url}/tasks?view=list`)
  await second.getByRole('button', { name: 'Saved views' }).click()
  await expect(second.getByRole('dialog', { name: 'Saved views' }).getByRole('button', { name: `Urgent ${s}`, exact: true })).toBeVisible()
  await expect(second.getByText('Available on all your devices. Only you can see it.')).toBeVisible()
  await other.close()
  await page.getByRole('button', { name: 'Saved views' }).click()
  await page.getByRole('button', { name: `Delete saved view Urgent ${s}` }).click()
  await expect(page.getByRole('dialog', { name: 'Saved views' }).getByRole('button', { name: `Urgent ${s}`, exact: true })).toHaveCount(0)
})

test('rows and cards keep to the content budget; secondary details are in Task Detail', async ({ app, owner, page }) => {
  const s = stamp()
  const parent = await newTask(owner, { title: `Budget parent ${s}`, status: 'ready', priority: 'low', labels: ['budget-label'], description: 'Only in detail' })
  await owner.post(`${V1}/tasks`, { title: `Budget child ${s}`, parentId: parent.id })
  await signIn(page, app)
  await page.goto(`${app.url}/tasks?view=board`)
  const card = page.getByRole('region', { name: 'Ready' }).getByRole('listitem').filter({ has: page.getByRole('link', { name: parent.title }) })
  await expect(card.getByLabel(`Status of ${parent.title}`)).toBeVisible()
  await expect(card.getByText('Unassigned')).toBeVisible()
  // ไม่มี priority ต่ำ, label, คำอธิบาย หรือจำนวน subtask บนการ์ด
  for (const text of ['Low', 'budget-label', 'Only in detail', 'subtask']) await expect(card.getByText(text)).toHaveCount(0)
  await card.getByRole('link', { name: parent.title }).click()
  await expect(panel(page).getByText('budget-label')).toBeVisible()
  await expect(panel(page).getByText('Only in detail')).toBeVisible()
  await expect(panel(page).getByRole('link', { name: `Budget child ${s}` })).toBeVisible()
})

test('phones open Task Detail as a full-height sheet that returns focus on close @mobile', async ({ app, owner, page }) => {
  const t = await newTask(owner, { title: `Sheet ${stamp()}`, assigneeId: (await owner.get(`${V1}/auth/me`)).body.actor.id })
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, app)
  await page.goto(`${app.url}/tasks?view=my-work`)
  const link = page.getByRole('link', { name: t.title })
  await link.click()
  const sheet = page.getByRole('dialog', { name: 'Task details' })
  await expect(sheet.getByRole('heading', { name: t.title })).toBeVisible()
  const box = await sheet.boundingBox()
  expect(box?.width).toBeGreaterThanOrEqual(389)
  expect(box?.height).toBeGreaterThanOrEqual(843)
  await sheet.getByLabel('Status', { exact: true }).selectOption('in_progress')
  await expect(sheet.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await sheet.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(sheet).toHaveCount(0)
  await expect(link).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

for (const scheme of ['light', 'dark'] as const) {
  test(`every Tasks view and Task Detail passes axe and reflows at 320 px (${scheme})`, async ({ app, owner, page }) => {
    const t = await newTask(owner, { title: `Axe ${stamp()}`, priority: 'urgent', status: 'blocked', assigneeId: (await owner.get(`${V1}/auth/me`)).body.actor.id, dueAt: '2020-01-01' })
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
    await signIn(page, app)
    const axe = async (where: string) => {
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).include('#main').analyze()
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), where).toEqual([])
    }
    for (const view of ['my-work', 'board', 'list']) {
      await page.goto(`${app.url}/tasks?view=${view}&task=${t.id}`)
      await expect(panel(page).getByRole('heading', { name: t.title })).toBeVisible()
      await expect(page.getByRole('link', { name: t.title })).toBeVisible()
      await axe(view)
    }
    await page.goto(`${app.url}/tasks/${t.id}`)
    await expect(page.getByRole('heading', { level: 1, name: t.title })).toBeVisible()
    await axe('page')
    await page.setViewportSize({ width: 320, height: 700 })
    for (const path of ['/tasks?view=my-work', '/tasks?view=board', '/tasks?view=list', `/tasks/${t.id}`]) {
      await page.goto(`${app.url}${path}`)
      await expect(page.locator('#main h1').first()).toBeVisible()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), { message: path }).toBe(true)
    }
  })
}

test('List selection changes several tasks at once and keeps failures selected', async ({ app, owner, page }) => {
  const s = stamp()
  const a = await newTask(owner, { title: `Bulk A ${s}`, status: 'ready' })
  const b = await newTask(owner, { title: `Bulk B ${s}`, status: 'ready' })
  const c = await newTask(owner, { title: `Bulk C ${s}`, status: 'ready' })
  await signIn(page, app)
  await page.goto(`${app.url}/tasks?view=list&q=${s}`)
  await expect(page.getByRole('link', { name: c.title })).toBeVisible()
  // คีย์บอร์ด: Space เลือก
  await page.getByLabel(`Select ${a.title}`).focus()
  await page.keyboard.press('Space')
  await page.getByLabel(`Select ${b.title}`).check()
  const all = page.getByLabel('Select all shown tasks')
  expect(await all.evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(true)
  const bar = page.getByRole('region', { name: 'Selected tasks' })
  await expect(bar).toContainText('2 selected')
  await bar.getByLabel('Set status of selected tasks').selectOption('done')
  await expect(bar).toContainText('Status set to Done: 2 tasks.')
  for (const t of [a, b]) expect((await owner.get(`${V1}/tasks/${t.id}`)).body.task.status).toBe('done')
  expect((await owner.get(`${V1}/tasks/${c.id}`)).body.task.status).toBe('ready')

  // งานที่เปลี่ยนไม่สำเร็จยังถูกเลือกไว้
  await all.check()
  await page.route(`**/client/v1/tasks/${c.id}`, (r) => (r.request().method() === 'PATCH' ? r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'boom' } }) }) : r.fallback()))
  await bar.getByLabel('Assign selected tasks').selectOption({ label: 'Olivia Owner' })
  await expect(bar).toContainText('2 done, 1 could not be changed and stay selected.')
  await expect(page.getByLabel(`Select ${c.title}`)).toBeChecked()
  await expect(page.getByLabel(`Select ${a.title}`)).not.toBeChecked()
  await page.unroute(`**/client/v1/tasks/${c.id}`)
  const act = (await owner.get(`${V1}/tasks/${a.id}/activity`)).body.items as Array<{ actor: { displayName: string } }>
  expect(act[0].actor.displayName).toBe('Olivia Owner')
})

test('clicking anywhere on a Board card opens its task, while its controls keep their own action', async ({ app, owner, page }) => {
  const s = stamp()
  const t = await newTask(owner, { title: `Card body ${s}`, status: 'ready', priority: 'high' })
  await signIn(page, app)
  await page.goto(`${app.url}/tasks?view=board&q=${s}`)
  const card = page.getByRole('region', { name: 'Ready' }).getByRole('listitem').filter({ has: page.getByRole('link', { name: t.title }) })

  // ตัวเลือกสถานะทำแค่หน้าที่ของตัวเอง ไม่เปิด task
  await card.getByLabel(`Status of ${t.title}`).click()
  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)

  // metadata และพื้นที่ว่างของการ์ดเปิด task เดียวกับชื่อ
  await card.getByText('High', { exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`view=board&q=${s}&task=${t.id}$`))
  await expect(panel(page).getByRole('heading', { level: 2, name: t.title })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)
  const box = (await card.boundingBox())!
  await page.mouse.click(box.x + box.width - 6, box.y + box.height - 6)
  await expect(panel(page).getByRole('heading', { level: 2, name: t.title })).toBeVisible()
})

async function boardCard(page: Page, column: string, title: string) {
  return page.getByRole('region', { name: column }).getByRole('listitem').filter({ has: page.getByRole('link', { name: title }) })
}

/** Presses on a card and moves the mouse in steps, the way a person drags (the Board starts a drag after 8px). */
async function mouseDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, finish: 'drop' | 'escape' = 'drop') {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 12, from.y + 4, { steps: 3 })
  await page.mouse.move(to.x, to.y, { steps: 12 })
  if (finish === 'escape') await page.keyboard.press('Escape')
  await page.mouse.up()
}

const centre = (box: { x: number; y: number; width: number; height: number }) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })

test('dragging a card to another Board column changes its status and says so', async ({ app, owner, page }) => {
  const s = stamp()
  const t = await newTask(owner, { title: `Drag me ${s}`, status: 'ready' })
  await signIn(page, app)
  // กรองให้เหลือการ์ดของ test นี้ (server ใช้ร่วมกันหลาย test: คอลัมน์ยาวจนการ์ดหลุดจอได้)
  await page.goto(`${app.url}/tasks?view=board&q=${s}`)
  const card = await boardCard(page, 'Ready', t.title)
  const box = (await card.boundingBox())!
  // เริ่มจากพื้นที่ว่างของการ์ด (ไม่ใช่ตัวเลือกสถานะ)
  await mouseDrag(page, { x: box.x + box.width - 10, y: box.y + 8 }, centre((await page.getByRole('region', { name: 'In progress' }).boundingBox())!))
  await expect(page.getByRole('status').filter({ hasText: `Moved ${t.title} to In progress.` })).toBeVisible()
  await expect(page.getByRole('region', { name: 'In progress' }).getByRole('link', { name: t.title })).toBeVisible()
  // การลากไม่นับเป็นคลิกเปิด task
  await expect(panel(page)).toHaveCount(0)
  expect((await owner.get(`${V1}/tasks/${t.id}`)).body.task.status).toBe('in_progress')

  // ลากจากชื่องานก็ได้
  const titleBox = (await page.getByRole('region', { name: 'In progress' }).getByRole('link', { name: t.title }).boundingBox())!
  await mouseDrag(page, centre(titleBox), centre((await page.getByRole('region', { name: 'Blocked' }).boundingBox())!))
  await expect(page.getByRole('status').filter({ hasText: `Moved ${t.title} to Blocked.` })).toBeVisible()
  await expect(panel(page)).toHaveCount(0)
})

test('a drag that is cancelled, dropped on its own column or started on a control changes nothing', async ({ app, owner, page }) => {
  const s = stamp()
  const t = await newTask(owner, { title: `Stay put ${s}`, status: 'ready' })
  await signIn(page, app)
  await page.goto(`${app.url}/tasks?view=board&q=${s}`)
  let updates = 0
  page.on('request', (r) => {
    if (r.method() === 'PATCH' && r.url().includes(`/tasks/${t.id}`)) updates++
  })
  const card = await boardCard(page, 'Ready', t.title)
  const box = (await card.boundingBox())!
  const start = { x: box.x + box.width - 10, y: box.y + 8 }
  const progress = centre((await page.getByRole('region', { name: 'In progress' }).boundingBox())!)

  // การ์ดกลับที่เดิมพร้อม animation สั้น ๆ: รอให้จบก่อนลองท่าถัดไป
  const settled = () => expect(page.locator('.tasks-card-drag.is-drag-source')).toHaveCount(0)
  await mouseDrag(page, start, progress, 'escape')
  await settled()
  await mouseDrag(page, start, { x: start.x, y: start.y + 40 })
  await settled()
  // กดที่ตัวเลือกสถานะแล้วขยับ: ไม่เริ่มการลาก (ปล่อยเมาส์ที่เดิมเพื่อไม่ให้ dropdown เลือกค่าใหม่)
  const status = centre((await card.getByLabel(`Status of ${t.title}`).boundingBox())!)
  await page.mouse.move(status.x, status.y)
  await page.mouse.down()
  await page.mouse.move(status.x + 40, status.y + 30, { steps: 5 })
  await page.waitForTimeout(150)
  await settled()
  await page.mouse.move(status.x, status.y, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.press('Escape')

  await expect(page.getByRole('region', { name: 'Ready' }).getByRole('link', { name: t.title })).toBeVisible()
  await expect(panel(page)).toHaveCount(0)
  expect(updates).toBe(0)
  expect((await owner.get(`${V1}/tasks/${t.id}`)).body.task.status).toBe('ready')
})

test('dragging to the edge of the Board scrolls to columns that were off screen', async ({ app, owner, page }) => {
  const s = stamp()
  const t = await newTask(owner, { title: `Far away ${s}`, status: 'backlog' })
  await page.setViewportSize({ width: 900, height: 800 })
  await signIn(page, app)
  await page.goto(`${app.url}/tasks?view=board&q=${s}`)
  const board = page.getByRole('region', { name: 'Board columns' })
  const boardBox = (await board.boundingBox())!
  const canceled = page.getByRole('region', { name: 'Canceled' })
  expect((await canceled.boundingBox())!.x).toBeGreaterThan(boardBox.x + boardBox.width)
  const box = (await (await boardCard(page, 'Backlog', t.title)).boundingBox())!
  const from = { x: box.x + box.width - 10, y: box.y + 8 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 12, from.y + 4, { steps: 3 })
  // ค้างไว้ใกล้ขอบขวาจน Board เลื่อนเอง
  await page.mouse.move(boardBox.x + boardBox.width - 4, from.y + 40, { steps: 10 })
  await expect.poll(async () => (await canceled.boundingBox())!.x, { timeout: 10_000 }).toBeLessThan(boardBox.x + boardBox.width - 120)
  const target = (await canceled.boundingBox())!
  await page.mouse.move(Math.min(target.x + 60, boardBox.x + boardBox.width - 20), target.y + 40, { steps: 5 })
  await page.mouse.up()
  await expect(page.getByRole('status').filter({ hasText: `Moved ${t.title} to Canceled.` })).toBeVisible()
  expect((await owner.get(`${V1}/tasks/${t.id}`)).body.task.status).toBe('canceled')
})

test('a move the server rejects says so and leaves the card where the server has it', async ({ app, owner, page }) => {
  const s = stamp()
  const t = await newTask(owner, { title: `Refused ${s}`, status: 'ready' })
  await signIn(page, app)
  await page.goto(`${app.url}/tasks?view=board&q=${s}`)
  await page.route(`**/client/v1/tasks/${t.id}`, (route) =>
    route.request().method() === 'PATCH' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Server unavailable' } }) }) : route.fallback(),
  )
  const box = (await (await boardCard(page, 'Ready', t.title)).boundingBox())!
  // วางบนคอลัมน์ที่มองเห็นอยู่ (Done อยู่นอก viewport กว้าง 1280px; การลากไปขอบจนเลื่อนเองทดสอบแยกแล้ว)
  await mouseDrag(page, { x: box.x + box.width - 10, y: box.y + 8 }, centre((await page.getByRole('region', { name: 'In progress' }).boundingBox())!))
  await expect(page.getByText(`${t.title} was not moved:`)).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: `Moved ${t.title}` })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Ready' }).getByRole('link', { name: t.title })).toBeVisible()
  expect((await owner.get(`${V1}/tasks/${t.id}`)).body.task.status).toBe('ready')
  await page.unroute(`**/client/v1/tasks/${t.id}`)
})

test('@mobile a long press drags a card on touch, while a quick swipe scrolls the Board', async ({ app, owner, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'needs a touch screen')
  const s = stamp()
  const t = await newTask(owner, { title: `Touch ${s}`, status: 'ready' })
  await signIn(page, app)
  await page.goto(`${app.url}/tasks?view=board&q=${s}`)
  const cdp = await page.context().newCDPSession(page)
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: { x: number; y: number }) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] })
  const scrollTop = () => page.evaluate(() => document.scrollingElement!.scrollTop)
  const card = await boardCard(page, 'Ready', t.title)
  await card.scrollIntoViewIfNeeded()

  // ปัดขึ้นเร็ว ๆ ก่อนครบเวลากดค้าง: หน้าเลื่อน ไม่ใช่ลากการ์ด (บนมือถือคอลัมน์เรียงลงแนวตั้ง)
  const box = (await card.boundingBox())!
  const start = { x: box.x + box.width - 12, y: box.y + 10 }
  const before = await scrollTop()
  await touch('touchStart', start)
  for (let i = 1; i <= 6; i++) await touch('touchMove', { x: start.x, y: start.y - i * 25 })
  await touch('touchEnd')
  await expect.poll(scrollTop).toBeGreaterThan(before)
  await expect(page.locator('.tasks-card-drag.is-drag-source')).toHaveCount(0)
  expect((await owner.get(`${V1}/tasks/${t.id}`)).body.task.status).toBe('ready')

  // กดค้างแล้วลากลงไปที่คอลัมน์ถัดไป
  await card.scrollIntoViewIfNeeded()
  const fresh = (await card.boundingBox())!
  const from = { x: fresh.x + fresh.width - 12, y: fresh.y + 10 }
  const head = (await page.getByRole('region', { name: 'In progress' }).getByRole('heading').boundingBox())!
  const target = { x: head.x + head.width / 2, y: head.y + head.height + 8 }
  await touch('touchStart', from)
  await page.waitForTimeout(400)
  for (let i = 1; i <= 10; i++) await touch('touchMove', { x: from.x + ((target.x - from.x) * i) / 10, y: from.y + ((target.y - from.y) * i) / 10 })
  await touch('touchEnd')
  await expect(page.getByRole('status').filter({ hasText: `Moved ${t.title} to In progress.` })).toBeVisible()
  await expect(panel(page)).toHaveCount(0)
  expect((await owner.get(`${V1}/tasks/${t.id}`)).body.task.status).toBe('in_progress')
})
