import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { startApp } from '../helpers/app'
import { OWNER, bootstrapOwner } from '../helpers/client'

/** WCAG 2.2 AA audit (axe) of every branded surface, in both colour schemes. */
async function audit(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const violations = result.violations.map((v) => `${label}: ${v.id} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
  expect(violations).toEqual([])
}

for (const scheme of ['light', 'dark'] as const) {
  test(`branded surfaces pass an automated WCAG 2.2 AA audit (${scheme})`, async ({ browser }) => {
    test.setTimeout(90_000)
    const app = await startApp()
    try {
      const owner = await bootstrapOwner(app)
      const invite = (await owner.post('/client/v1/invites', { note: 'a11y' })).body.url as string
      const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1440, height: 900 } })
      const page = await ctx.newPage()
      await page.goto(`${app.url}/login`)
      await audit(page, 'login')
      await page.goto(invite)
      await expect(page.getByRole('heading', { name: 'Join Alice' })).toBeVisible()
      await audit(page, 'invite')
      await page.goto(`${app.url}/invite/not-a-token`)
      await expect(page.getByRole('heading', { name: 'Invite unavailable' })).toBeVisible()
      await audit(page, 'invalid invite')
      // สถานะที่มีการโต้ตอบ: รหัสผ่านถูกเปิดดู และมี error ตรง ๆ
      await page.goto(`${app.url}/login`)
      await page.getByLabel('Password', { exact: true }).fill('x')
      await page.getByRole('button', { name: 'Show password' }).click()
      await page.getByLabel('Username').fill('nobody')
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page.getByRole('alert')).toBeVisible()
      await audit(page, 'login with revealed password and error')
      // setup ต้องเป็น server ที่ยังไม่ bootstrap
      const fresh = await startApp()
      try {
        await page.goto(`${fresh.url}/setup`)
        await expect(page.getByRole('heading', { name: 'Set up Alice' })).toBeVisible()
        await audit(page, 'setup')
      } finally {
        await fresh.stop()
      }
      await page.goto(`${app.url}/login`)
      await page.getByLabel('Username').fill(OWNER.username)
      await page.getByLabel('Password', { exact: true }).fill(OWNER.password)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
      for (const path of ['/', '/my-tasks', '/projects', '/documents', '/no/such/page']) {
        await page.goto(`${app.url}${path}`)
        await page.waitForLoadState('networkidle')
        await audit(page, path)
      }
      await ctx.close()
    } finally {
      await app.stop()
    }
  })
}

test('keyboard order runs skip link → brand → navigation → user controls, with visible focus', async ({ page }) => {
  const app = await startApp()
  try {
    await bootstrapOwner(app)
    await page.goto(`${app.url}/login`)
    await page.getByLabel('Username').fill(OWNER.username)
    await page.getByLabel('Password', { exact: true }).fill(OWNER.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
    await page.goto(`${app.url}/my-tasks`)
    await expect(page.getByRole('heading', { name: 'Nothing assigned to you' })).toBeVisible()
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    const order: string[] = []
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab')
      order.push(await page.evaluate(() => (document.activeElement as HTMLElement).innerText.trim() || (document.activeElement as HTMLElement).getAttribute('aria-label') || ''))
    }
    expect(order).toEqual(['Skip to content', 'Alice', 'Board', 'List'])
    // focus บนโลโก้มองเห็นได้
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Shift+Tab')
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle)
    expect(outline).not.toBe('none')
    // ภาพ mascot ไม่เป็น tab stop และไม่มี animation
    expect(await page.locator('img.mascot').evaluateAll((imgs) => imgs.map((i) => (i as HTMLElement).tabIndex))).toEqual([-1])
    expect(await page.locator('img.mascot').evaluate((i) => getComputedStyle(i).animationName)).toBe('none')
  } finally {
    await app.stop()
  }
})

test('content survives 200% and 400% zoom (reflow at 640 and 320 CSS px)', async ({ page }) => {
  const app = await startApp()
  try {
    await bootstrapOwner(app)
    for (const width of [640, 320]) {
      await page.setViewportSize({ width, height: 900 / (1280 / width) })
      await page.goto(`${app.url}/login`)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    }
  } finally {
    await app.stop()
  }
})
