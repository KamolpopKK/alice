import AxeBuilder from '@axe-core/playwright'
import { inviteHuman } from '../helpers/client'
import { expect, signIn, test } from './fixtures'

/** The application shell: destinations, legacy routes, responsive navigation, New, palette, theme. */

const names = async (page: import('@playwright/test').Page, nav: string) =>
  (await page.getByRole('navigation', { name: nav }).getByRole('link').allInnerTexts()).map((t) => t.trim())

test('the sidebar has exactly six primary and three secondary destinations, the same for owners and members', async ({ app, owner, page, browser }) => {
  await signIn(page, app)
  expect(await names(page, 'Main')).toEqual(['Home', 'Task Pads', 'Tasks', 'Projects', 'Documents', 'Search'])
  expect(await names(page, 'More')).toEqual(['Agents', 'Activity', 'Settings'])
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Tasks' }).click()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page')

  // member: ปลายทางหลักเหมือนกัน แต่ใน Settings ไม่มีหน้าดูแลระบบ
  const username = `shell${Date.now().toString(36)}`
  await inviteHuman(owner, username, 'Shell Member')
  const ctx = await browser.newContext()
  const member = await ctx.newPage()
  await signIn(member, app, username, `${username}-password-123`)
  expect(await names(member, 'Main')).toEqual(['Home', 'Task Pads', 'Tasks', 'Projects', 'Documents', 'Search'])
  await member.getByRole('navigation', { name: 'More' }).getByRole('link', { name: 'Settings' }).click()
  await expect(member.getByRole('link', { name: 'Devices and sessions' })).toBeVisible()
  await expect(member.getByRole('link', { name: 'Workspace admin' })).toHaveCount(0)
  await ctx.close()
  await page.getByRole('navigation', { name: 'More' }).getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('link', { name: 'Workspace admin' })).toBeVisible()
})

test('old Board, List and My Tasks links open the matching Tasks view and keep their filters', async ({ app, owner, page }) => {
  void owner
  await signIn(page, app)
  await page.goto(`${app.url}/list?priority=urgent`)
  await expect(page).toHaveURL(/\/tasks\?priority=urgent&view=list$/)
  await expect(page.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: 'Filters, 1 active' }).click()
  await expect(page.getByLabel('Priority')).toHaveValue('urgent')
  await page.keyboard.press('Escape')
  await page.goto(`${app.url}/my-tasks`)
  await expect(page).toHaveURL(/\/tasks\?view=my-work$/)
  await expect(page.getByRole('radio', { name: 'My Work' })).toHaveAttribute('aria-checked', 'true')
  // ลิงก์ Board เดิมที่มี filter (/?…) ยังเปิด Board; / เปล่า ๆ คือ Home
  await page.goto(`${app.url}/?priority=low`)
  await expect(page).toHaveURL(/\/tasks\?priority=low&view=board$/)
  await expect(page.getByRole('radio', { name: 'Board' })).toHaveAttribute('aria-checked', 'true')
  // ปุ่ม Back ของ browser ไม่วนกลับไปที่ redirect
  await page.getByRole('radio', { name: 'List' }).click()
  await expect(page).toHaveURL(/view=list/)
  await page.goBack()
  await expect(page).toHaveURL(/view=board/)
})

test('a collapsed sidebar stays collapsed after reload on this device only', async ({ app, owner, page, browser }) => {
  void owner
  await page.setViewportSize({ width: 1280, height: 800 })
  await signIn(page, app)
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
  // ชื่อปลายทางยังเป็นชื่อที่เข้าถึงได้แม้มองเห็นแค่ไอคอน
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Projects' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
  const other = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const second = await other.newPage()
  await signIn(second, app)
  await expect(second.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible()
  await other.close()
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
})

test('phones get a top bar and a navigation sheet that returns focus to the new page', async ({ app, owner, page }) => {
  void owner
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, app)
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Open navigation' }).click()
  const sheet = page.getByRole('dialog', { name: 'Navigation' })
  await expect(sheet.getByRole('navigation', { name: 'Main' })).toBeVisible()
  // เปลี่ยนหน้าในแอป ไม่ใช่โหลดหน้าใหม่ทั้งหน้า (ค่าบน window ต้องยังอยู่)
  await page.evaluate(() => ((window as unknown as { __sameDocument: boolean }).__sameDocument = true))
  await sheet.getByRole('link', { name: 'Projects' }).click()
  await expect(sheet).toBeHidden()
  expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true)
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible()
  await expect(page.locator('#main')).toBeFocused()
  // Escape ปิด sheet แล้วโฟกัสกลับปุ่มเมนู
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('tablets show an icon rail that expands into an overlay', async ({ app, owner, page }) => {
  void owner
  await page.setViewportSize({ width: 820, height: 1180 })
  await signIn(page, app)
  await expect(page.locator('.shell--rail')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Documents' })).toBeVisible()
  await page.getByRole('button', { name: 'Expand navigation' }).click()
  await expect(page.getByRole('dialog', { name: 'Navigation' }).getByText('Documents')).toBeVisible()
  await page.keyboard.press('Escape')
})

test('New creates a task, project or document in two interactions from any page', async ({ app, owner, page }) => {
  void owner
  await signIn(page, app)
  await page.goto(`${app.url}/activity`)
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Task' }).click()
  await expect(page).toHaveURL(/\/tasks\/new$/)
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Project' }).click()
  await expect(page.getByLabel('Project name')).toBeFocused()
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Document' }).click()
  await expect(page.getByLabel('Document title')).toBeFocused()
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Pad' }).click()
  await expect(page).toHaveURL(/\/pads\/pad_/)
})

test('the command palette finds pages, tasks and commands by keyboard and restores focus', async ({ app, owner, page }) => {
  await owner.post('/client/v1/tasks', { title: 'Palette findable task' })
  await signIn(page, app)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Search' }).focus()
  await page.keyboard.press('ControlOrMeta+k')
  const input = page.getByRole('combobox', { name: 'Search tasks, pages and commands' })
  await expect(input).toBeFocused()
  await page.keyboard.type('proj')
  await expect(page.getByRole('option', { name: 'Projects, Go to' })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Search' })).toBeFocused()

  await page.keyboard.press('ControlOrMeta+k')
  await page.keyboard.type('Palette findable')
  await expect(page.getByRole('option', { name: 'Palette findable task, Tasks' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Palette findable task' })).toBeVisible()

  await page.keyboard.press('ControlOrMeta+k')
  await page.keyboard.type('dark theme')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.keyboard.press('ControlOrMeta+k')
  await page.keyboard.type('system theme')
  await page.keyboard.press('Enter')
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/)
})

test('the theme chosen in Settings applies at once, survives reload and System follows the device', async ({ app, owner, page }) => {
  void owner
  await page.emulateMedia({ colorScheme: 'light' })
  await signIn(page, app)
  await page.goto(`${app.url}/settings`)
  await page.getByRole('radio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  const dark = await bg()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await bg()).toBe(dark)
  await page.getByRole('radio', { name: 'System' }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/)
  expect(await bg()).not.toBe(dark)
})

for (const scheme of ['light', 'dark'] as const) {
  test(`the shell passes axe and reflows at 320 px (${scheme})`, async ({ app, owner, page }) => {
    void owner
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
    await signIn(page, app)
    for (const path of ['/tasks?view=board', '/settings', '/projects']) {
      await page.goto(`${app.url}${path}`)
      await page.locator('#main h1').first().waitFor()
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).include('.shell-sidebar').analyze()
      expect(results.violations.map((v) => v.id), path).toEqual([])
    }
    await page.setViewportSize({ width: 320, height: 640 })
    for (const path of ['/tasks?view=board', '/settings']) {
      await page.goto(`${app.url}${path}`)
      await page.locator('#main h1').first().waitFor()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true)
      const top = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).include('.shell-topbar').analyze()
      expect(top.violations.map((v) => v.id), path).toEqual([])
    }
  })
}
