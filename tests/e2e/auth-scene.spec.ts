import { expect, test, type Page } from '@playwright/test'
import { startApp, type RunningApp } from '../helpers/app'
import { bootstrapOwner } from '../helpers/client'

/** Sign in, Setup and Accept Invite (valid and invalid) share one workspace-peek scene. */
let app: RunningApp
let fresh: RunningApp
let inviteUrl: string

test.beforeAll(async () => {
  app = await startApp()
  fresh = await startApp()
  const owner = await bootstrapOwner(app)
  inviteUrl = (await owner.post('/client/v1/invites', { note: 'scene' })).body.url
})
test.afterAll(async () => {
  await app?.stop()
  await fresh?.stop()
})

const STATES = () =>
  [
    ['sign in', `${app.url}/login`, 'Sign in', true],
    ['setup', `${fresh.url}/setup`, 'Set up Alice', true],
    ['valid invite', inviteUrl, 'Join Alice', true],
    ['invalid invite', `${app.url}/invite/not-a-token`, 'Invite unavailable', false],
  ] as const

async function geometry(page: Page) {
  return page.evaluate(() => {
    const surface = document.querySelector('main section[aria-labelledby]')!.getBoundingClientRect()
    const peek = document.querySelector('main img.mascot')?.getBoundingClientRect() ?? null
    return { surface: { x: surface.x, right: surface.right, width: surface.width, top: surface.top, bottom: surface.bottom }, peek: peek && { x: peek.x, right: peek.right, top: peek.top, bottom: peek.bottom, width: peek.width }, vw: window.innerWidth }
  })
}

for (const scheme of ['light', 'dark'] as const) {
  test(`every auth state shares the compact scene with Alice at the form edge (${scheme})`, async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    for (const [name, url, heading, greets] of STATES()) {
      await page.goto(url)
      const surface = page.getByRole('region', { name: heading })
      await expect(surface.getByRole('heading', { level: 1, name: heading })).toBeVisible()
      // ทุกข้อความที่อ่านได้อยู่ในฟอร์ม: พื้นหลังไม่มีข้อมูลหรือปุ่ม
      const mainText = await page.locator('main').innerText()
      expect(mainText.trim(), name).toBe((await surface.innerText()).trim())
      expect(await page.locator('main a, main button, main input').evaluateAll((els) => els.every((e) => e.closest('section')))).toBe(true)

      const g = await geometry(page)
      expect(g.surface.width, name).toBeLessThanOrEqual(440)
      expect(g.surface.width, name).toBeGreaterThanOrEqual(360)
      if (greets) {
        expect(g.peek, name).not.toBeNull()
        // ฟอร์มค่อนซ้ายของกลางจอ, Alice ทับขอบขวาของฟอร์มพอดี และไม่ล้นบน/ล่าง
        expect((g.surface.x + g.surface.right) / 2, name).toBeLessThan(g.vw / 2)
        expect(g.peek!.x, name).toBeLessThan(g.surface.right)
        expect(g.peek!.right, name).toBeGreaterThan(g.surface.right + 100)
        expect(g.peek!.top, name).toBeGreaterThanOrEqual(g.surface.top - 1)
        expect(g.peek!.bottom, name).toBeLessThanOrEqual(g.surface.bottom)
      } else {
        expect(g.peek, name).toBeNull()
        await expect(page.locator('.alice-says')).toHaveCount(0)
      }
      // ตกแต่งล้วน: ไม่อยู่ใน accessibility tree, ไม่มี animation, มีขนาดจริงจองพื้นที่ไว้
      const art = page.locator('main img.mascot')
      if (greets) {
        expect(await art.getAttribute('aria-hidden')).toBe('true')
        expect(await art.getAttribute('alt')).toBe('')
        expect(Number(await art.getAttribute('width'))).toBeGreaterThan(0)
        expect(Number(await art.getAttribute('height'))).toBeGreaterThan(0)
        expect(await art.evaluate((i) => getComputedStyle(i).animationName)).toBe('none')
      }
      await expect(page.getByRole('img')).toHaveCount(1) // โลโก้ "Alice" เท่านั้น
    }
    await ctx.close()
  })
}

test('narrow screens and zoom drop the scenery first, keep one column and never overflow', async ({ browser }) => {
  for (const width of [320, 390, 640, 720, 1440]) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 } })
    const page = await ctx.newPage()
    for (const [name, url] of STATES()) {
      await page.goto(url)
      await page.waitForTimeout(150)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} @${width}`).toBe(true)
      const submit = page.locator('main button[type="submit"]')
      if (await submit.count()) {
        const box = await submit.boundingBox()
        expect(box!.x + box!.width, `${name} @${width}`).toBeLessThanOrEqual(width)
      }
      if (width <= 720) {
        const bg = await page.locator('main').evaluate((m) => getComputedStyle(m).backgroundImage)
        expect(bg, `${name} @${width}`).toBe('none')
        const g = await geometry(page)
        if (g.peek) {
          // ศีรษะเล็ก ๆ อยู่ในความกว้างของฟอร์ม ไม่ดันอะไรออกไป
          expect(g.peek.width).toBeLessThanOrEqual(100)
          expect(g.peek.right).toBeLessThanOrEqual(g.surface.right)
        }
      }
    }
    await ctx.close()
  }
})

test('the scene stays local: no remote image, font or analytics requests', async ({ page }) => {
  const external: string[] = []
  page.on('request', (r) => {
    const u = r.url()
    if (!u.startsWith(app.url) && !u.startsWith(fresh.url) && !u.startsWith('data:')) external.push(u)
  })
  for (const [, url] of STATES()) {
    await page.goto(url)
    await page.waitForLoadState('networkidle')
  }
  expect(external).toEqual([])
})
