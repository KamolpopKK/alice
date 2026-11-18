import AxeBuilder from '@axe-core/playwright'
import { agentClient, createAgent, deviceLogin, inviteHuman } from '../helpers/client'
import { expect, signIn, test } from './fixtures'

/** Agents, Activity and Settings: role-aware categories, confirmations, attribution and privacy. */
const V1 = '/client/v1'
const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)

test('Settings shows the categories each role may use, and phones get list then detail with Back', async ({ app, owner, page, browser }) => {
  await signIn(page, app)
  await page.goto(`${app.url}/settings`)
  const nav = page.getByRole('navigation', { name: 'Settings categories' })
  expect((await nav.getByRole('link').allInnerTexts()).map((t) => t.trim())).toEqual(['General', 'Appearance', 'Agents & CLI', 'Devices & Sessions', 'Backup & Recovery', 'Advanced', 'Administration'])
  await expect(nav.getByRole('link', { name: 'General' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('Workspace owner')).toBeVisible()
  await nav.getByRole('link', { name: 'Advanced' }).click()
  await expect(page.getByText(/v1 \(oldest supported v1\)/)).toBeVisible()

  const username = `set${stamp()}`
  await inviteHuman(owner, username, 'Settings Member')
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const member = await ctx.newPage()
  await signIn(member, app, username, `${username}-password-123`)
  await member.goto(`${app.url}/settings`)
  const list = member.getByRole('navigation', { name: 'Settings categories' })
  await expect(list.getByRole('link', { name: /Administration/ })).toHaveCount(0)
  await list.getByRole('link', { name: /Devices & Sessions/ }).click()
  await expect(member.getByRole('heading', { name: 'Devices & Sessions' })).toBeVisible()
  await expect(list).toHaveCount(0)
  await member.getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(member.getByRole('navigation', { name: 'Settings categories' })).toBeVisible()
  // ไม่มีสิทธิ์: server ปฏิเสธ แม้จะเรียกตรง
  const forbidden = await member.evaluate(async () => (await fetch('/client/v1/agents')).status)
  expect(forbidden).toBe(403)
  await ctx.close()
})

test('revoking a token and deactivating an agent ask first; secrets are shown once only', async ({ app, owner, page }) => {
  const name = `Confirm Bot ${stamp()}`
  await signIn(page, app)
  await page.goto(`${app.url}/settings/admin`)
  await page.getByLabel('Agent name').fill(name)
  await page.getByRole('button', { name: 'Create agent' }).click()
  const token = (await page.getByTestId('secret-value').textContent())!.trim()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.locator('body')).not.toContainText(token)

  await page.getByRole('button', { name: `Revoke default of ${name}` }).click()
  const dialog = page.getByRole('dialog', { name: 'Revoke this token?' })
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  const agentId = ((await owner.get(`${V1}/agents`)).body.items as Array<{ id: string; displayName: string; tokens: Array<{ revokedAt: string | null }> }>).find((a) => a.displayName === name)!
  expect(agentId.tokens[0].revokedAt).toBeNull()

  await page.locator('li.settings-agent', { hasText: name }).getByRole('button', { name: 'Deactivate' }).click()
  await page.getByRole('dialog', { name: `Deactivate ${name}?` }).getByRole('button', { name: 'Deactivate agent' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('li.settings-agent', { hasText: name }).getByText('deactivated', { exact: true })).toBeVisible()
  const res = await agentClient(app, { id: agentId.id, token, tokenId: '' }).get('/api/tasks')
  expect(res.status).toBe(401)
})

test('Activity tells people and agents apart, filters by who and what, and links to the change', async ({ app, owner, page }) => {
  const name = `Activity Bot ${stamp()}`
  const agent = await createAgent(owner, name)
  const task = (await owner.post(`${V1}/tasks`, { title: `Watched ${stamp()}`, status: 'ready' })).body.task
  await agentClient(app, agent).patch(`/api/tasks/${task.id}`, { status: 'in_progress' })
  await signIn(page, app)
  await page.goto(`${app.url}/agents`)
  await page.getByRole('link', { name: `Activity of ${name}` }).click()
  await expect(page).toHaveURL(new RegExp(`actorId=${agent.id}`))
  const item = page.getByRole('listitem').filter({ hasText: name }).first()
  await expect(item.getByText('Agent', { exact: true })).toBeVisible()
  await expect(item).toContainText('changed status from Ready to In progress')
  await expect(page.getByRole('listitem').filter({ hasText: 'Olivia Owner' })).toHaveCount(0)
  await page.getByLabel('What').selectOption('document')
  await expect(page.getByText('No activity matches')).toBeVisible()
  await page.getByLabel('What').selectOption('task')
  await page.getByRole('link', { name: 'Open task' }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: task.title })).toBeVisible()
})

for (const scheme of ['light', 'dark'] as const) {
  test(`Agents, Activity and every Settings category pass axe and reflow at 320 px (${scheme})`, async ({ app, owner, page }) => {
    await createAgent(owner, `Axe Agent ${stamp()}`)
    // ตารางที่มีข้อมูลจริง (session ที่ชื่ออุปกรณ์ยาว) ต้องเลื่อนในกรอบของตัวเอง ไม่ดันหน้ากว้าง
    await deviceLogin(app, owner, { deviceName: `a-very-long-device-name-for-the-build-box-${stamp()}` })
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
    await signIn(page, app)
    const paths = ['/agents', '/activity', ...['general', 'appearance', 'agents', 'devices', 'backup', 'advanced', 'admin'].map((s) => `/settings/${s}`), '/device']
    for (const path of paths) {
      await page.goto(`${app.url}${path}`)
      await expect(page.locator('#main h1, #main h2').first()).toBeVisible()
      await page.locator('.ui-skeleton').first().waitFor({ state: 'detached' }).catch(() => undefined)
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).include('#main').analyze()
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), path).toEqual([])
    }
    await page.setViewportSize({ width: 320, height: 700 })
    for (const path of paths) {
      await page.goto(`${app.url}${path}`)
      await expect(page.locator('#main h1, #main h2').first()).toBeVisible()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), { message: path }).toBe(true)
    }
  })
}
