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

test('filters, search and sort are shared across views, and saved views restore them on this device', async ({ app, owner, page }) => {
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
