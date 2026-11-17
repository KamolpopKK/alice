import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { inviteHuman } from '../helpers/client'
import { expect, openNewPad, signIn, test } from './fixtures'

const V1 = '/client/v1'
const text = (t: string) => [{ type: 'text', text: t }]

async function audit(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(result.violations.map((v) => `${label}: ${v.id} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Task pads' })

test('New Pad opens a localized date-and-time pad ready for capture, and pads can be renamed, pinned, archived and deleted', async ({ app, owner, page }) => {
  expect(owner).toBeTruthy()
  await signIn(page, app)
  await openNewPad(page, owner)
  // ชื่อเริ่มต้นตาม locale และ time zone ของเบราว์เซอร์ (ยอมให้นาทีเปลี่ยนระหว่างทดสอบ)
  const expected = await page.evaluate(() => {
    const f = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    return [f.format(new Date()), f.format(new Date(Date.now() - 60_000))]
  })
  const name = await page.getByLabel('Pad name').inputValue()
  expect(expected).toContain(name)
  // ไม่มี naming dialog และพร้อมพิมพ์ทันที
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'New task' })).toBeFocused()

  // Pad ชื่อซ้ำได้
  const firstUrl = page.url()
  // server ถูกใช้ร่วมกับ spec อื่นใน worker เดียวกัน: นับเพิ่มจากจำนวนเดิม
  const sameName = sidebar(page).getByRole('link', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
  const before = await sameName.count()
  await sidebar(page).getByRole('button', { name: 'New Pad' }).click()
  await expect(page).not.toHaveURL(firstUrl)
  await expect(sameName).toHaveCount(before + 1)

  // rename
  await page.getByLabel('Pad name').fill('Weekly sync')
  await page.getByLabel('Pad name').press('Enter')
  await expect(sidebar(page).getByRole('link', { name: /Weekly sync/ })).toBeVisible()

  // pin: ขึ้นไปอยู่ในกลุ่ม Pinned
  await page.getByRole('button', { name: 'Pin pad' }).click()
  await expect(page.getByRole('button', { name: 'Unpin pad' })).toHaveAttribute('aria-pressed', 'true')
  await expect(sidebar(page).getByRole('region', { name: 'Pinned' }).getByRole('link', { name: /Weekly sync/ })).toBeVisible()

  // archive ผ่านเมนู → หายจาก sidebar, เปิดได้จาก overflow
  await page.getByRole('button', { name: 'Pad actions' }).click()
  await page.getByRole('menuitem', { name: 'Archive pad' }).click()
  await expect(sidebar(page).getByRole('link', { name: /Weekly sync/ })).toHaveCount(0)
  await sidebar(page).getByRole('button', { name: 'More pad options' }).click()
  await page.getByRole('menuitem', { name: 'Archived pads' }).click()
  const archivedDialog = page.getByRole('dialog', { name: 'Archived pads' })
  await expect(archivedDialog.getByRole('strong').filter({ hasText: 'Weekly sync' })).toBeVisible()
  await audit(page, 'archived pads dialog')
  await archivedDialog.getByRole('button', { name: 'Restore Weekly sync' }).click()
  await expect(archivedDialog.getByText('No archived pads.')).toBeVisible()
  await archivedDialog.getByRole('button', { name: 'Close' }).click()
  await expect(sidebar(page).getByRole('link', { name: /Weekly sync/ })).toBeVisible()

  // ลบถาวรต้องยืนยัน
  await sidebar(page).getByRole('link', { name: /Weekly sync/ }).click()
  await page.getByRole('button', { name: 'Pad actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete pad permanently…' }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete pad permanently?' })
  await expect(confirm).toContainText('Tasks created from it stay on the Board')
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await audit(page, 'delete confirmation')
  await confirm.getByRole('button', { name: 'Delete pad permanently' }).click()
  await expect(sidebar(page).getByRole('link', { name: /Weekly sync/ })).toHaveCount(0)
})

test('pinned pads come first, recent pads sort by update, and defaults apply only to future tasks', async ({ app, owner, page }) => {
  const older = (await owner.post(`${V1}/pads`, { name: 'Older pad' })).body.pad
  const newer = (await owner.post(`${V1}/pads`, { name: 'Newer pad' })).body.pad
  const pinned = (await owner.post(`${V1}/pads`, { name: 'Pinned pad' })).body.pad
  await owner.patch(`${V1}/pads/${pinned.id}`, { pinned: true })
  await owner.post(`${V1}/pads/${older.id}/blocks`, { type: 'text', content: text('fresh edit') })
  const project = (await owner.post(`${V1}/projects`, { name: 'Defaults project' })).body.project
  const before = (await owner.post(`${V1}/pads/${newer.id}/blocks`, { type: 'task', title: 'Before default' })).body.block.task

  await signIn(page, app)
  await page.goto(`${app.url}/pads/${newer.id}`)
  const recent = sidebar(page).getByRole('region', { name: 'Recent' }).getByRole('link')
  await expect(sidebar(page).getByRole('region', { name: 'Pinned' }).getByRole('link').first()).toContainText('Pinned pad')
  const names = await recent.allInnerTexts()
  // Newer pad ได้ task ล่าสุด จึงอยู่บนสุดของ Recent แม้ Older pad จะถูกแก้หลังสร้าง
  expect(names.findIndex((n) => n.includes('Newer pad'))).toBeLessThan(names.findIndex((n) => n.includes('Older pad')))
  expect(names.some((n) => n.includes('Pinned pad'))).toBe(false)
  await expect(sidebar(page).getByRole('link', { name: /Newer pad/ })).toHaveAttribute('aria-current', 'page')

  await page.getByLabel('Default project for new tasks').selectOption({ label: 'Defaults project' })
  await page.getByLabel('Default status for new tasks').selectOption({ label: 'Ready' })
  await expect.poll(async () => (await owner.get(`${V1}/pads/${newer.id}`)).body.pad.defaults.status).toBe('ready')
  const captureLine = page.getByRole('textbox', { name: 'New task' }).last()
  await captureLine.fill('After default')
  await captureLine.press('Enter')
  await expect(page.locator('input[value="After default"]')).toBeVisible()
  await expect.poll(async () => (await owner.get(`${V1}/tasks?limit=200`)).body.items.some((t: any) => t.title === 'After default')).toBe(true)
  const tasks = (await owner.get(`${V1}/tasks?limit=200`)).body.items
  expect(tasks.find((t: any) => t.title === 'After default')).toMatchObject({ project: { id: project.id }, status: 'ready' })
  expect(tasks.find((t: any) => t.id === before.id)).toMatchObject({ status: 'backlog', project: { name: 'Untitled' } })
  await audit(page, 'pad with defaults')
})

test('search finds content beyond the loaded window and opens, expands, scrolls to and focuses it', async ({ app, owner, page }) => {
  const pad = (await owner.post(`${V1}/pads`, { name: 'Huge call' })).body.pad
  const section = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'heading', content: text('Archive of chatter') })).body.block
  let prev: string | null = null
  for (let i = 0; i < 260; i++) {
    const res: any = await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'text', content: text(i === 255 ? 'the marmalade clause' : `chatter ${i}`), parentId: section.id, afterId: prev })
    prev = res.body.block.id
  }
  await owner.patch(`${V1}/pads/${pad.id}/blocks/${section.id}`, { collapsed: true })
  const other = (await owner.post(`${V1}/pads`, { name: 'Elsewhere' })).body.pad

  await signIn(page, app)
  await page.goto(`${app.url}/pads/${other.id}`)
  await sidebar(page).getByRole('searchbox', { name: 'Search pads' }).fill('marmalade')
  const result = sidebar(page).getByRole('button', { name: /Huge call/ })
  await expect(result).toContainText('marmalade')
  await result.click()
  await expect(page).toHaveURL(new RegExp(`/pads/${pad.id}`))
  const target = page.getByRole('textbox', { name: 'Text' }).filter({ hasText: 'the marmalade clause' })
  await expect(target).toBeFocused()
  await expect(target).toBeInViewport()
})

test('task blocks and mentions open Task Detail in a side peek; focus returns on close', async ({ app, owner, page }) => {
  const pad = (await owner.post(`${V1}/pads`, { name: 'Peek pad' })).body.pad
  const taskBlock = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'task', title: 'Peekable task' })).body.block
  const other = (await owner.post(`${V1}/tasks`, { title: 'Mentioned elsewhere' })).body.task
  await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'text', afterId: taskBlock.id, content: [{ type: 'text', text: 'see ' }, { type: 'mention', taskId: other.id }] })
  await signIn(page, app)
  await page.goto(`${app.url}/pads/${pad.id}`)
  const trigger = page.getByRole('button', { name: 'Open task details: Peekable task' })
  await trigger.click()
  const peek = page.getByRole('dialog', { name: 'Task details' })
  await expect(peek.getByRole('heading', { name: 'Peekable task' })).toBeVisible()
  await expect(peek.getByLabel('Status')).toHaveValue('backlog')
  await audit(page, 'side peek')
  await peek.getByLabel('Status').selectOption('ready')
  await expect.poll(async () => (await owner.get(`${V1}/tasks/${taskBlock.task.id}`)).body.task.status).toBe('ready')
  await page.keyboard.press('Escape')
  await expect(peek).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await page.locator('[data-mention]', { hasText: '@Mentioned elsewhere' }).click()
  await expect(page.getByRole('dialog', { name: 'Task details' }).getByRole('heading', { name: 'Mentioned elsewhere' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('another human cannot discover a private pad through the route', async ({ app, owner, browser }) => {
  const pad = (await owner.post(`${V1}/pads`, { name: 'Owner secret plans' })).body.pad
  await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'text', content: text('do not leak this sentence') })
  await inviteHuman(owner, 'nosy', 'Nosy Neighbour')
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await signIn(page, app, 'nosy', 'nosy-password-123')
  await page.goto(`${app.url}/pads/${pad.id}`)
  await expect(page.getByRole('heading', { name: 'Pad not found' })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('Owner secret plans')
  await expect(page.locator('body')).not.toContainText('do not leak')
  await sidebar(page).getByRole('searchbox', { name: 'Search pads' }).fill('leak')
  await expect(sidebar(page).getByText('No matches in your pads.')).toBeVisible()
  await ctx.close()
})

test('narrow screens use separate list and editor screens with Back @mobile', async ({ app, owner, page }) => {
  const pad = (await owner.post(`${V1}/pads`, { name: 'Phone pad' })).body.pad
  await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'task', title: 'Call the plumber' })
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, app)
  await page.goto(`${app.url}/pads`)
  await expect(sidebar(page)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Pad editor' })).toHaveCount(0)
  await sidebar(page).getByRole('link', { name: /Phone pad/ }).click()
  await expect(sidebar(page)).toHaveCount(0)
  await expect(page.locator('input[value="Call the plumber"]')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await page.getByRole('link', { name: 'Back to pads' }).click()
  await expect(sidebar(page)).toBeVisible()
  await audit(page, 'mobile list')
})
