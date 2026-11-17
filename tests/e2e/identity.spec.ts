import { test as base, expect } from '@playwright/test'
import { startApp, type RunningApp } from '../helpers/app'

// spec นี้ต้องการ server ที่ยังไม่ bootstrap จึงไม่ใช้ fixture owner
const test = base.extend<{}, { app: RunningApp }>({
  app: [
    async ({}, use) => {
      const app = await startApp()
      await use(app)
      await app.stop()
    },
    { scope: 'worker' },
  ],
})

test('owner sets up Alice, invites a teammate and creates an agent token', async ({ app, browser }) => {
  const page = await browser.newPage()
  await page.goto(app.url)
  await expect(page).toHaveURL(/\/setup$/)
  await page.getByLabel('Bootstrap token', { exact: true }).fill(app.env.ALICE_BOOTSTRAP_TOKEN)
  await page.getByLabel('Display name').fill('Olivia Owner')
  await page.getByLabel('Username').fill('olivia')
  await page.getByLabel('Password', { exact: true }).fill('olivia-password-1')
  await page.getByRole('button', { name: 'Create owner account' }).click()
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible()

  await page.getByRole('link', { name: 'Admin' }).click()
  await page.getByRole('button', { name: 'Create invite link' }).click()
  const inviteUrl = (await page.getByTestId('secret-value').textContent())!.trim()
  expect(inviteUrl).toContain('/invite/')
  await page.getByRole('button', { name: 'Done' }).click()

  await page.getByLabel('Agent name').fill('Codex Backend')
  await page.getByRole('button', { name: 'Create agent' }).click()
  const token = (await page.getByTestId('secret-value').textContent())!.trim()
  expect(token).toMatch(/^alice_at_/)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('secret-value')).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('Codex Backend')).toBeVisible()
  await expect(page.locator('body')).not.toContainText(token)

  // คนที่ถูกเชิญเปิดลิงก์ใน browser context แยก
  const guest = await browser.newContext()
  const guestPage = await guest.newPage()
  await guestPage.goto(inviteUrl)
  await guestPage.getByLabel('Display name').fill('Bob Builder')
  await guestPage.getByLabel('Username').fill('bob')
  await guestPage.getByLabel('Password', { exact: true }).fill('bob-password-12')
  await guestPage.getByRole('button', { name: 'Create account' }).click()
  await expect(guestPage.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await expect(guestPage.getByRole('link', { name: 'Admin' })).toHaveCount(0)

  await guestPage.getByRole('button', { name: 'Sign out' }).click()
  await expect(guestPage).toHaveURL(/\/login$/)

  // ลิงก์เชิญใช้ซ้ำไม่ได้
  await guestPage.goto(inviteUrl)
  await expect(guestPage.getByRole('heading', { name: 'Invite unavailable' })).toBeVisible()
})
