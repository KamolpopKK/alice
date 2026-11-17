import { accountButton } from './fixtures'
import { startApp } from '../helpers/app'
import { bootstrapOwner, OWNER } from '../helpers/client'
import { expect, test } from '@playwright/test'

/** A fresh workspace so the page-level empty states are really empty. */
test('approved page-level states show Alice with the exact line; inline empties stay text-only', async ({ page }) => {
  const app = await startApp()
  try {
    const owner = await bootstrapOwner(app)
    await page.goto(`${app.url}/login`)
    await page.getByLabel('Username').fill(OWNER.username)
    await page.getByLabel('Password', { exact: true }).fill(OWNER.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(accountButton(page)).toBeVisible()

    const states = [
      ['/my-tasks', 'Nothing assigned to you', 'All tidy. Nothing needs your attention right now.', 'alice-mascot-neutral'],
      ['/projects', 'Your projects will appear here', 'No projects yet. Start one, and I’ll help keep things organized.', 'alice-mascot-curious'],
      ['/documents', 'Reference documents live here', 'No documents yet. Add one when you’re ready.', 'alice-mascot-focused'],
    ] as const
    for (const [path, heading, line, art] of states) {
      await page.goto(`${app.url}${path}`)
      const region = page.getByRole('region', { name: heading })
      await expect(region.getByRole('heading', { name: heading })).toBeVisible()
      await expect(region.getByText(line, { exact: true })).toBeVisible()
      const img = region.locator('img.mascot')
      expect(await img.getAttribute('src')).toContain(art)
      expect(await img.getAttribute('alt')).toBe('')
      expect(await img.getAttribute('aria-hidden')).toBe('true')
      expect(Number(await img.getAttribute('width'))).toBeGreaterThan(0)
      expect(Number(await img.getAttribute('height'))).toBeGreaterThan(0)
    }
    // ปุ่มสร้างหลักยังเด่นกว่าภาพ
    await page.goto(`${app.url}/projects`)
    await expect(page.getByRole('button', { name: 'New project' })).toBeVisible()

    // inline empty (ค้นหาไม่เจอ, คอลัมน์ board ว่าง) ยังเป็นข้อความอย่างเดียว
    await page.goto(`${app.url}/documents?q=zzzz-nothing`)
    await expect(page.getByText('No documents found.')).toBeVisible()
    await expect(page.locator('img.mascot')).toHaveCount(0)
    await page.goto(`${app.url}/tasks?view=board`)
    await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible()
    await expect(page.locator('img.mascot')).toHaveCount(0)

    // มีงานแล้ว → ไม่แสดง Alice
    const task = (await owner.post('/client/v1/tasks', { title: 'Mine now', assigneeId: (await owner.get('/client/v1/auth/me')).body.actor.id })).body.task
    await page.goto(`${app.url}/my-tasks`)
    await expect(page.getByText(task.title)).toBeVisible()
    await expect(page.locator('img.mascot')).toHaveCount(0)

    await page.setViewportSize({ width: 320, height: 568 })
    for (const [path] of states) {
      await page.goto(`${app.url}${path}`)
      await page.waitForTimeout(200)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
  } finally {
    await app.stop()
  }
})

test('the signed-in 404 is concerned, factual and leads back Home', async ({ page }) => {
  const app = await startApp()
  try {
    await bootstrapOwner(app)
    await page.goto(`${app.url}/login`)
    await page.getByLabel('Username').fill(OWNER.username)
    await page.getByLabel('Password', { exact: true }).fill(OWNER.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(accountButton(page)).toBeVisible()
    await page.goto(`${app.url}/no/such/page`)
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
    await expect(page.getByText('I couldn’t find that page. Let’s head back somewhere familiar.', { exact: true })).toBeVisible()
    expect(await page.locator('img.mascot').getAttribute('src')).toContain('alice-mascot-concerned')
    await page.getByRole('link', { name: 'Back to Home' }).click()
    await expect(page.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening), / })).toBeVisible()

  } finally {
    await app.stop()
  }
})

test('a page whose data cannot load offers a calm retry, and validation errors stay plain', async ({ page }) => {
  test.setTimeout(60_000)
  const app = await startApp()
  try {
    const owner = await bootstrapOwner(app)
    const task = (await owner.post('/client/v1/tasks', { title: 'Comes back after retry' })).body.task
    await page.goto(`${app.url}/login`)
    await page.getByLabel('Username').fill(OWNER.username)
    await page.getByLabel('Password', { exact: true }).fill(OWNER.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(accountButton(page)).toBeVisible()

    await page.route(`**/client/v1/tasks/${task.id}`, (r) => r.abort())
    await page.goto(`${app.url}/tasks/${task.id}`)
    await expect(page.getByRole('heading', { name: 'This page didn’t load' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Something slipped out of place. Let’s try that again.', { exact: true })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('Could not reach the server')
    await page.unroute(`**/client/v1/tasks/${task.id}`)
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('heading', { name: 'Comes back after retry' })).toBeVisible()

    // งานที่ไม่มีอยู่ = ข้อความตรง ๆ ไม่ใช่ Alice
    await page.goto(`${app.url}/tasks/tsk_doesnotexist00000000`)
    await expect(page.getByRole('alert')).toContainText('not found')
    await expect(page.locator('img.mascot')).toHaveCount(0)
    // validation error ในฟอร์มยังเป็นข้อความตรง ๆ
    await page.goto(`${app.url}/projects`)
    await page.getByRole('button', { name: 'New project' }).click()
    await page.getByLabel('Project name').fill(' ')
    await page.getByRole('button', { name: 'Create project' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('alert').locator('img')).toHaveCount(0)
  } finally {
    await app.stop()
  }
})
