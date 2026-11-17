import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { FakeNativeCore } from './desktop-bridge'
import { expect, signIn, test } from './fixtures'

// Visual evidence of Task Pads for review, written to test-results/ (never committed). Runs only when asked:
//   ALICE_CAPTURE_EVIDENCE=1 npx playwright test tests/e2e/task-pad-evidence.spec.ts --project=desktop
const OUT = path.resolve(import.meta.dirname, '../../test-results/task-pads-evidence')
const V1 = '/client/v1'
test.skip(process.env.ALICE_CAPTURE_EVIDENCE !== '1', 'evidence capture is opt-in')

const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 80 })

test('capture Task Pad evidence', async ({ app, owner, browser }) => {
  test.setTimeout(120_000)
  fs.mkdirSync(OUT, { recursive: true })
  const t = (x: string) => [{ type: 'text', text: x }]
  const project = (await owner.post(`${V1}/projects`, { name: 'Website' })).body.project
  const hero = (await owner.post(`${V1}/tasks`, { title: 'Hero illustration', projectId: project.id })).body.task
  await owner.post(`${V1}/pads`, { name: 'Standup — Monday' })
  const pinned = (await owner.post(`${V1}/pads`, { name: 'Hiring loop' })).body.pad
  await owner.patch(`${V1}/pads/${pinned.id}`, { pinned: true })
  const pad = (await owner.post(`${V1}/pads`, { name: 'Design review call' })).body.pad
  const h = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'heading', content: t('Decisions') })).body.block
  const a = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'text', parentId: h.id, content: [{ type: 'text', text: 'Dana wants the empty state reviewed before ' }, { type: 'mention', taskId: hero.id }] })).body.block
  const b = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'task', parentId: h.id, afterId: a.id, title: 'Send revised mockups to Dana' })).body.block
  await owner.patch(`${V1}/pads/${pad.id}/blocks/${b.id}`, { description: 'Include the dark theme variants.' })
  const c = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'task', taskId: hero.id, parentId: h.id, afterId: b.id })).body.block
  await owner.post(`${V1}/pads/${pad.id}/blocks/${c.id}/complete`, {})
  const q = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'heading', afterId: h.id, content: t('Open questions') })).body.block
  await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'text', parentId: q.id, content: t('Do we ship the onboarding tour in this release?') })

  for (const scheme of ['light', 'dark'] as const) {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    await signIn(page, app)
    await page.goto(`${app.url}/pads/${pad.id}`)
    await expect(page.locator('input[value="Send revised mockups to Dana"]')).toBeVisible()
    await page.mouse.move(0, 0)
    await shot(page, `desktop-split-${scheme}`)
    await ctx.close()
  }

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await signIn(page, app)
  await page.goto(`${app.url}/pads/${pad.id}`)
  await page.getByRole('textbox', { name: 'New task' }).last().click()
  await page.keyboard.type('@hero')
  await expect(page.getByRole('option', { name: /Hero illustration/ })).toBeVisible()
  await shot(page, 'mention-search')
  await page.keyboard.press('Escape')
  await page.getByRole('textbox', { name: 'New task' }).last().fill('')
  await page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    const data = new DataTransfer()
    data.setData('text/plain', 'Book the usability lab\nRecruit five participants\nDraft the interview script')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await page.getByRole('dialog', { name: 'Paste multiple lines' }).getByText(/Preview of 3 tasks/).click()
  await shot(page, 'paste-dialog')
  await page.getByRole('button', { name: 'Cancel' }).click()

  // pending recovery: offline capture, reload, Not synced
  await page.route('**/client/v1/pads/**', (route) => (route.request().method() !== 'GET' ? route.abort('internetdisconnected') : route.continue()))
  await page.getByRole('textbox', { name: 'New task' }).last().click()
  await page.keyboard.type('Call the vendor about the lab booking')
  await page.keyboard.press('Enter')
  await page.reload()
  await expect(page.getByRole('status').filter({ hasText: 'Not synced' })).toBeVisible()
  await shot(page, 'pending-recovery')
  await page.unroute('**/client/v1/pads/**')
  await ctx.close()

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const phone = await mobile.newPage()
  await signIn(phone, app)
  await phone.goto(`${app.url}/pads`)
  await expect(phone.getByRole('complementary', { name: 'Task pads' })).toBeVisible()
  await shot(phone, 'mobile-list')
  await phone.getByRole('link', { name: /Design review call/ }).click()
  await expect(phone.locator('input[value="Send revised mockups to Dana"]')).toBeVisible()
  await shot(phone, 'mobile-editor')
  await mobile.close()

  // Desktop: shortcut settings and the result of the new-pad shortcut
  const desk = await browser.newContext({ viewport: { width: 1280, height: 820 } })
  const d = await desk.newPage()
  const native = await FakeNativeCore.attach(d)
  native.takenShortcuts.add('Alt+Shift+Space')
  await d.goto(app.url)
  await d.getByLabel('Profile name').fill('work')
  await d.getByLabel('Server URL').fill(app.url)
  await d.getByRole('button', { name: 'Add server' }).click()
  await d.getByRole('button', { name: 'Sign in with browser' }).click()
  await expect(d.getByLabel('Sign-in code')).toHaveText(/^[A-Z]{4}-[A-Z]{4}$/)
  await owner.post('/client/v1/device/approve', { userCode: native.pendingUserCode })
  await expect(d.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await d.goto(`${app.url}/pads`)
  await d.getByRole('button', { name: 'More pad options' }).click()
  await d.getByRole('menuitem', { name: 'Capture shortcuts…' }).click()
  await expect(d.getByRole('dialog', { name: 'Capture shortcuts' }).getByRole('alert')).toBeVisible()
  await shot(d, 'desktop-shortcut-settings')
  await d.keyboard.press('Escape')
  await d.goto(`${app.url}/projects`)
  await native.pressShortcut('new-pad')
  await expect(d.getByRole('textbox', { name: 'New task' })).toBeFocused()
  await d.keyboard.type('Captured with Option+Shift+Space')
  await shot(d, 'desktop-shortcut-new-pad')
  await desk.close()
})
