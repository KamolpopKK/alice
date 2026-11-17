import AxeBuilder from '@axe-core/playwright'
import { agentClient, createAgent } from '../helpers/client'
import { expect, signIn, test } from './fixtures'

/** Home: a curated action surface built from real data, with one deterministic Alice summary. */
const V1 = '/client/v1'
const HOME_HEADING = /^Good (morning|afternoon|evening), /

test('Home summarises my real work, links each section to its source and shows agent activity', async ({ app, owner, page }) => {
  const me = (await owner.get(`${V1}/auth/me`)).body.actor
  const stamp = Date.now().toString(36)
  await owner.post(`${V1}/tasks`, { title: `Home in progress ${stamp}`, status: 'in_progress', assigneeId: me.id })
  await owner.post(`${V1}/tasks`, { title: `Home blocked ${stamp}`, status: 'blocked', assigneeId: me.id })
  const agent = await createAgent(owner, `Home Agent ${stamp}`)
  const done = (await owner.post(`${V1}/tasks`, { title: `Agent work ${stamp}`, status: 'ready' })).body.task
  await agentClient(app, agent).post(`/api/tasks/${done.id}/claim`, {})

  await signIn(page, app)
  await expect(page.getByRole('heading', { level: 1, name: HOME_HEADING })).toBeVisible()
  // ประโยคเดียว จากตัวเลขจริง: มีงานที่ถูก block ก่อนเสมอ
  await expect(page.getByRole('region', { name: 'Alice’s summary' })).toContainText(/of your tasks (is|are) blocked\./)
  const blocked = page.getByRole('region', { name: /Blocked/ })
  await expect(blocked.getByRole('link', { name: `Home blocked ${stamp}` })).toBeVisible()
  await expect(page.getByRole('region', { name: /In progress/ }).getByRole('link', { name: `Home in progress ${stamp}` })).toBeVisible()
  const agents = page.getByRole('region', { name: 'Recent agent activity' })
  await expect(agents).toContainText(`Home Agent ${stamp}`)

  await page.getByRole('link', { name: 'All my work' }).click()
  await expect(page).toHaveURL(/\/tasks\?view=my-work$/)
  await page.goBack()
  await blocked.getByRole('link', { name: `Home blocked ${stamp}` }).click()
  await expect(page.getByRole('heading', { name: `Home blocked ${stamp}` })).toBeVisible()
})

test('the summary can be hidden and stays hidden on this device', async ({ app, owner, page }) => {
  void owner
  await signIn(page, app)
  const summary = page.getByRole('region', { name: 'Alice’s summary' })
  await expect(summary).toBeVisible()
  await expect(summary.locator('img.mascot')).toHaveCount(1)
  await page.getByRole('button', { name: 'Hide Alice’s summary' }).click()
  await expect(summary).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: HOME_HEADING })).toBeVisible()
  await expect(summary).toHaveCount(0)
  await page.getByRole('button', { name: 'Show Alice’s summary' }).click()
  await expect(summary).toBeVisible()
})

test('Continue your pad opens the most recently updated pad, and quick create works from Home', async ({ app, owner, page }) => {
  const pad = (await owner.post(`${V1}/pads`, { name: `Home pad ${Date.now().toString(36)}` })).body.pad
  await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'text', content: [{ type: 'text', text: 'touch' }] })
  await signIn(page, app)
  await page.getByRole('link', { name: `Continue ${pad.name}` }).click()
  await expect(page).toHaveURL(new RegExp(`/pads/${pad.id}$`))
  await page.goto(app.url)
  await page.getByRole('region', { name: 'Quick create' }).getByRole('button', { name: 'New task' }).click()
  await expect(page).toHaveURL(/\/tasks\/new$/)
})

for (const scheme of ['light', 'dark'] as const) {
  test(`Home passes axe and reflows at 320 px (${scheme})`, async ({ app, owner, page }) => {
    void owner
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
    await signIn(page, app)
    await expect(page.getByRole('region', { name: 'Recent agent activity' })).toBeVisible()
    await page.locator('.ui-skeleton').first().waitFor({ state: 'detached' }).catch(() => undefined)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).include('#main').analyze()
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
    await page.setViewportSize({ width: 320, height: 700 })
    // shell สลับเป็นแถบด้านบนหลัง media query เปลี่ยน: รอให้ layout นิ่งก่อนวัด
    await expect(page.locator('.shell-topbar')).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}
