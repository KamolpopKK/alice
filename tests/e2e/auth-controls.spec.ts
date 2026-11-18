import { accountButton } from './fixtures'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { startApp, type RunningApp } from '../helpers/app'
import { OWNER, bootstrapOwner } from '../helpers/client'

/** Polished controls keep every authentication contract. */
let app: RunningApp
let fresh: RunningApp
let inviteUrl: string
test.beforeAll(async () => {
  app = await startApp()
  fresh = await startApp()
  const owner = await bootstrapOwner(app)
  inviteUrl = (await owner.post('/client/v1/invites', { note: 'controls' })).body.url
})
test.afterAll(async () => {
  await app?.stop()
  await fresh?.stop()
})

async function toggleKeepsValue(page: Page, field: Locator, noun: string) {
  await field.fill('S3cret value 42!')
  const show = page.getByRole('button', { name: `Show ${noun}` })
  await expect(show).toHaveAttribute('aria-pressed', 'false')
  await expect(field).toHaveAttribute('type', 'password')
  await show.focus()
  await page.keyboard.press('Enter') // ใช้คีย์บอร์ดได้
  const hide = page.getByRole('button', { name: `Hide ${noun}` })
  await expect(hide).toHaveAttribute('aria-pressed', 'true')
  await expect(hide).toBeFocused()
  await expect(field).toHaveAttribute('type', 'text')
  await expect(field).toHaveValue('S3cret value 42!')
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: `Show ${noun}` })).toHaveAttribute('aria-pressed', 'false')
  await expect(field).toHaveAttribute('type', 'password')
  await expect(field).toHaveValue('S3cret value 42!')
}

const lum = (rgb: string) => {
  const [r, g, b] = rgb.match(/\d+/g)!.slice(0, 3).map((v) => Number(v) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

test('Sign in: labels, autocomplete, keyboard order, password reveal, busy state and direct error', async ({ page }) => {
  await page.goto(`${app.url}/login`)
  const username = page.getByLabel('Username')
  const password = page.getByLabel('Password', { exact: true })
  await expect(page.getByText('Username', { exact: true })).toBeVisible()
  await expect(page.getByText('Password', { exact: true })).toBeVisible()
  await expect(username).toHaveAttribute('autocomplete', 'username')
  await expect(password).toHaveAttribute('autocomplete', 'current-password')
  await expect(username).toBeFocused() // autofocus

  await toggleKeepsValue(page, password, 'password')

  // ลำดับ Tab: username → password → ปุ่มแสดงรหัส → ปุ่ม Sign in (ไม่มีจุด focus ของภาพตกแต่ง)
  await username.focus()
  const order: string[] = []
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab')
    order.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? (document.activeElement as HTMLElement).innerText ?? (document.activeElement as HTMLInputElement).name))
  }
  expect(order).toEqual(['', 'Show password', 'Sign in'])
  const focusOutline = await page.getByRole('button', { name: 'Sign in' }).evaluate((b) => getComputedStyle(b).outlineStyle + ' ' + getComputedStyle(b).outlineWidth)
  expect(focusOutline).toBe('solid 3px')

  // กำลังส่ง: ปุ่มปิดและข้อความเปลี่ยน; แล้ว error ตรง ๆ
  await page.route('**/client/v1/auth/login', async (route) => {
    await new Promise((r) => setTimeout(r, 600))
    await route.continue()
  })
  await username.fill('owner')
  await password.fill('definitely-wrong-1')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Signing in…' })).toBeDisabled()
  await expect(page.getByRole('alert')).toHaveText('Username or password is incorrect')
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  await expect(password).toHaveValue('definitely-wrong-1')
  await page.unroute('**/client/v1/auth/login')

  await password.fill(OWNER.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(accountButton(page)).toBeVisible()
})

test('Setup and invite keep new-password semantics, their own fields and reveal controls', async ({ page }) => {
  await page.goto(`${fresh.url}/setup`)
  const token = page.getByLabel('Bootstrap token', { exact: true })
  await expect(token).toHaveAttribute('autocomplete', 'off')
  await toggleKeepsValue(page, token, 'bootstrap token')
  await expect(page.getByLabel('Display name')).toHaveAttribute('autocomplete', 'name')
  await expect(page.getByLabel('Username')).toHaveAttribute('autocomplete', 'username')
  const pw = page.getByLabel('Password', { exact: true })
  await expect(pw).toHaveAttribute('autocomplete', 'new-password')
  await expect(pw).toHaveAttribute('minlength', '10')
  await expect(pw).toHaveAttribute('required', '')
  await toggleKeepsValue(page, pw, 'password')

  await page.goto(inviteUrl)
  const ipw = page.getByLabel('Password', { exact: true })
  await expect(ipw).toHaveAttribute('autocomplete', 'new-password')
  await toggleKeepsValue(page, ipw, 'password')
  await page.getByLabel('Display name').fill('Ivy Invitee')
  await page.getByLabel('Username').fill('ivy')
  await ipw.fill('ivy-password-123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(accountButton(page)).toBeVisible()
})

for (const scheme of ['light', 'dark'] as const) {
  test(`primary action and field borders meet contrast in every interactive state (${scheme})`, async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: scheme })
    const page = await ctx.newPage()
    await page.goto(`${app.url}/login`)
    const button = page.getByRole('button', { name: 'Sign in' })
    const colours = () => button.evaluate((b) => [getComputedStyle(b).color, getComputedStyle(b).backgroundColor])
    const [ink, rest] = await colours()
    expect(ratio(ink, rest)).toBeGreaterThanOrEqual(4.5)
    await button.hover()
    const [ink2, hover] = await colours()
    expect(ratio(ink2, hover)).toBeGreaterThanOrEqual(4.5)
    expect(hover).not.toBe(rest)
    const field = page.getByLabel('Username')
    const [border, surface] = await field.evaluate((i) => {
      const card = i.closest('section')!
      return [getComputedStyle(i).borderTopColor, getComputedStyle(card).backgroundColor]
    })
    // พื้น surface โปร่งแสงเล็กน้อย: ใช้สี rgb ของมันเป็นค่าประมาณ
    expect(ratio(border, surface)).toBeGreaterThanOrEqual(3)
    await ctx.close()
  })
}
