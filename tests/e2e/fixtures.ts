import { test as base, expect, type Page } from '@playwright/test'
import { startApp, type RunningApp } from '../helpers/app'
import { HttpClient, OWNER, bootstrapOwner } from '../helpers/client'

export { expect }

interface Fixtures {
  app: RunningApp
  owner: HttpClient
}

/** One fresh Alice server (and owner account) per test file worker. */
export const test = base.extend<{}, Fixtures>({
  app: [
    async ({}, use) => {
      // server นี้ถูกใช้ร่วมกันหลาย spec ใน worker เดียว: เพิ่มเพดาน login ต่อนาที
      // (การจำกัด login พิสูจน์แยกไว้ใน tests/system/security.test.ts ด้วยค่า default)
      const app = await startApp({ env: { ALICE_AUTH_RATE_LIMIT: '1000' } })
      await use(app)
      await app.stop()
    },
    { scope: 'worker' },
  ],
  owner: [
    async ({ app }, use) => {
      await use(await bootstrapOwner(app))
    },
    { scope: 'worker' },
  ],
})

export async function signIn(page: Page, app: RunningApp, username = OWNER.username, password = OWNER.password) {
  await page.goto(`${app.url}/login`)
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
}

/**
 * Opens Task Pads from the main navigation and creates a new pad; returns its id. `/pads` may first
 * redirect to the latest pad that another test on this worker's server created, so it waits for the
 * page to settle and then for a pad id that did not exist before.
 */
export async function openNewPad(page: Page, owner: HttpClient): Promise<string> {
  const known = new Set(((await owner.get('/client/v1/pads?archived=all&limit=200')).body.items as Array<{ id: string }>).map((p) => p.id))
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Task Pads' }).click()
  await expect(page).toHaveURL(/\/pads(\/pad_[0-9a-z]+)?$/)
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'New Pad' }).first().click()
  let id: string | undefined
  await expect
    .poll(() => {
      id = /\/pads\/(pad_[0-9a-z]+)/.exec(page.url())?.[1]
      return Boolean(id && !known.has(id))
    })
    .toBe(true)
  return id!
}
