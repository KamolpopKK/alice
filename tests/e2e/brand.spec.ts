import { expect, test } from './fixtures'

test('favicon, Apple touch icon, manifest and metadata resolve from the production build', async ({ app, page, request }) => {
  await page.goto(`${app.url}/login`)
  const head = await page.evaluate(() => ({
    description: document.querySelector('meta[name="description"]')?.getAttribute('content'),
    themes: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('media')),
    icons: [...document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]')].map((l) => (l as HTMLLinkElement).href),
    title: document.title,
  }))
  expect(head.title).toBe('Alice')
  expect(head.description).toContain('humans and AI agents')
  expect(head.themes).toEqual(['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)'])
  for (const href of head.icons) {
    const res = await request.get(href)
    expect(res.status(), href).toBe(200)
  }
  const manifest = await (await request.get(`${app.url}/manifest.webmanifest`)).json()
  expect(manifest).toMatchObject({ name: 'Alice', short_name: 'Alice' })
  for (const icon of manifest.icons) expect((await request.get(`${app.url}${icon.src}`)).status()).toBe(200)
  const assets = await (await request.get(`${app.url}/brand/brand-assets.json`)).json()
  for (const a of Object.values(assets.assets) as Array<{ path: string }>) expect((await request.get(`${app.url}${a.path}`)).status(), a.path).toBe(200)
  // ไม่มี request ออกนอกเครื่อง (font/analytics/รูป remote)
  const external: string[] = []
  page.on('request', (r) => {
    if (!r.url().startsWith(app.url) && !r.url().startsWith('data:')) external.push(r.url())
  })
  await page.reload()
  expect(external).toEqual([])
})

const COPY = {
  login: 'Welcome back. Everything’s ready for you.',
  setup: 'Let’s get your workspace in order.',
  invite: 'Welcome in. Let’s get you settled.',
}

async function noOverflow(page: import('@playwright/test').Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

test('sign-in, setup and invite greet with the approved line, one logo name and a decorative mascot', async ({ app, owner, page }) => {
  const { startApp } = await import('../helpers/app')
  const fresh = await startApp()
  try {
    await page.goto(`${fresh.url}/setup`)
    await expect(page.getByRole('heading', { name: 'Set up Alice' })).toBeVisible()
    await expect(page.getByText(COPY.setup, { exact: true })).toBeVisible()
  } finally {
    await fresh.stop()
  }

  await page.goto(`${app.url}/login`)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByText(COPY.login, { exact: true })).toBeVisible()
  // ชื่อ Alice ถูกประกาศครั้งเดียว และ mascot ไม่อยู่ใน accessibility tree
  await expect(page.getByRole('img')).toHaveCount(1)
  await expect(page.getByRole('img', { name: 'Alice' })).toBeVisible()
  expect(await page.locator('img.mascot').getAttribute('alt')).toBe('')
  // ข้อผิดพลาดยังตรงไปตรงมา ไม่มีคำพูดของ Alice
  await page.getByLabel('Username').fill('nobody')
  await page.getByLabel('Password', { exact: true }).fill('wrong-password-1')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toHaveText('Username or password is incorrect')

  const invite = (await owner.post('/api/invites', { note: 'brand' })).body.url as string
  await page.goto(invite)
  await expect(page.getByText(COPY.invite, { exact: true })).toBeVisible()
  await page.goto(`${app.url}/invite/not-a-real-token`)
  await expect(page.getByRole('heading', { name: 'Invite unavailable' })).toBeVisible()
  await expect(page.locator('.alice-says')).toHaveCount(0)
  await expect(page.locator('img.mascot')).toHaveCount(0)
})

test('the sidebar shows mark + wordmark when wide and the phone top bar the mark alone, always named Alice', async ({ app, owner, page }) => {
  void owner // server ใหม่ของ worker อาจยังไม่มี owner ให้ sign in
  const { signIn } = await import('./fixtures')
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page, app)
  const brand = page.getByRole('link', { name: 'Alice', exact: true })
  await expect(brand).toBeVisible()
  await expect(page.locator('.brand-wordmark')).toBeVisible()
  const mark = await page.locator('.brand-mark').boundingBox()
  expect(mark!.height).toBeGreaterThanOrEqual(28)
  expect(mark!.height).toBeLessThanOrEqual(32)

  for (const width of [720, 390, 320]) {
    await page.setViewportSize({ width, height: 800 })
    const height = await page.locator('.shell-topbar').evaluate((el) => el.getBoundingClientRect().height)
    expect(height).toBeLessThanOrEqual(56)
    await expect(page.locator('.shell-topbar .brand-wordmark')).toHaveCSS('position', 'absolute')
    await expect(brand).toHaveAccessibleName('Alice')
    await noOverflow(page)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${app.url}/projects`)
  await brand.focus()
  await expect(brand).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening), / })).toBeVisible()
})

test('dark mode swaps the logo variant without filtering the mascot', async ({ app, browser }) => {
  for (const scheme of ['light', 'dark'] as const) {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    await page.goto(`${app.url}/login`)
    const logo = page.getByRole('img', { name: 'Alice' })
    await expect(logo).toBeVisible()
    await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.currentSrc)).toContain(`alice-logo-horizontal-${scheme}.svg`)
    expect(await page.locator('img.mascot').evaluate((img) => getComputedStyle(img).filter)).toBe('none')
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 800 })
      await noOverflow(page)
    }
    await ctx.close()
  }
})
