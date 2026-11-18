import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { agentSetupGuide } from '../../src/shared/agent-guide'
import { startApp, type RunningApp } from '../helpers/app'
import { OWNER, bootstrapOwner, inviteHuman } from '../helpers/client'

/** The For agent page. */
let app: RunningApp
test.beforeAll(async () => {
  app = await startApp()
  await inviteHuman(await bootstrapOwner(app), 'member', 'Mia Member')
})
test.afterAll(async () => app?.stop())

async function openAs(browser: Browser, who: 'owner' | 'member', options: Parameters<Browser['newContext']>[0] = {}): Promise<Page> {
  const ctx = await browser.newContext(options)
  const page = await ctx.newPage()
  await page.goto(`${app.url}/login`)
  await page.getByLabel('Username').fill(who === 'owner' ? OWNER.username : 'member')
  await page.getByLabel('Password', { exact: true }).fill(who === 'owner' ? OWNER.password : 'member-password-123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  // จอแคบ: เมนูอยู่ใน sheet ที่เปิดจากแถบด้านบน
  await page.getByRole('button', { name: /^Account: / }).first().waitFor()
  if (await page.getByRole('button', { name: 'Open navigation' }).isVisible()) await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('navigation', { name: 'More' }).getByRole('link', { name: 'Agents' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Agents' })).toBeVisible()
  return page
}

test('owner and member both reach the page; token guidance differs by role', async ({ browser }) => {
  const owner = await openAs(browser, 'owner')
  await expect(owner.getByRole('link', { name: 'Settings › Administration' })).toHaveAttribute('href', '/settings/admin')
  await expect(owner.getByText('Ask the workspace owner')).toHaveCount(0)

  const member = await openAs(browser, 'member')
  await expect(member.getByText('Ask the workspace owner to create an agent and give you its token.')).toBeVisible()
  await expect(member.getByRole('link', { name: 'Settings › Administration' })).toHaveCount(0)
  await expect(member.getByText(/tools version \d+\.\d+\.\d+/)).toBeVisible()
  await expect(member.getByText('Tool downloads are not available')).toHaveCount(0)
})

test('tabs switch the prompt and steps; commands use this server and the keyboard works', async ({ browser }) => {
  const page = await openAs(browser, 'owner')
  const claude = page.getByRole('tab', { name: 'Claude Code' })
  const codex = page.getByRole('tab', { name: 'Codex' })
  await expect(claude).toHaveAttribute('aria-selected', 'true')
  const prompt = page.getByLabel('Setup prompt for Claude Code')
  await expect(prompt).toContainText(`${app.url}/downloads/alice.js`)
  await expect(prompt).toContainText(`claude mcp add --scope user -e ALICE_URL=${app.url} -e ALICE_TOKEN_FILE=$HOME/.config/alice/token --transport stdio alice -- alice-mcp-stdio`)
  await expect(page.getByRole('heading', { name: 'Connect Claude Code to Alice MCP' })).toBeVisible()

  await claude.focus()
  await page.keyboard.press('ArrowRight')
  await expect(codex).toBeFocused()
  await expect(codex).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('Setup prompt for Codex')).toContainText(`alice mcp-config --client codex --url ${app.url}`)
  await expect(page.getByRole('heading', { name: 'Connect Codex to Alice MCP' })).toBeVisible()
  await expect(page.getByText('claude mcp add')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('alice_at_')
})

test('the update section gives a per-client update prompt and steps', async ({ browser }) => {
  const page = await openAs(browser, 'member', { permissions: ['clipboard-read', 'clipboard-write'] })
  const section = page.getByRole('region', { name: 'Keep it up to date' })
  await expect(section).toContainText(/This server ships version \d+\.\d+\.\d+/)
  await expect(section.getByRole('heading', { name: 'Reinstall the skills' })).toBeVisible()
  await expect(page.getByLabel('Update prompt for Claude Code')).toContainText('Update the Alice tools and skills for Claude Code')
  await section.getByRole('button', { name: 'Copy' }).first().click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(agentSetupGuide('claude-code', app.url).update.prompt)
  await page.getByRole('tab', { name: 'Codex' }).click()
  await expect(page.getByLabel('Update prompt for Codex')).toContainText('install-skill --client codex')
})

test('Copy puts the exact prompt on the clipboard and announces it', async ({ browser }) => {
  const page = await openAs(browser, 'owner', { permissions: ['clipboard-read', 'clipboard-write'] })
  await page.getByRole('button', { name: 'Copy prompt' }).click()
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Copied to clipboard.' })).toBeVisible()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toBe(agentSetupGuide('claude-code', app.url).prompt)
})

test('a refused clipboard leaves the text selectable and says so', async ({ browser }) => {
  const ctx = await browser.newContext()
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } })
  })
  const page = await ctx.newPage()
  await page.goto(`${app.url}/login`)
  await page.getByLabel('Username').fill(OWNER.username)
  await page.getByLabel('Password', { exact: true }).fill(OWNER.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('navigation', { name: 'More' }).getByRole('link', { name: 'Agents' }).click()
  await page.getByRole('button', { name: 'Copy prompt' }).click()
  await expect(page.getByText('Copy failed — select the text manually.')).toBeVisible()
  const block = page.getByLabel('Setup prompt for Claude Code')
  await expect(block).toHaveCSS('user-select', 'auto')
})

for (const scheme of ['light', 'dark'] as const) {
  test(`passes axe WCAG 2.2 AA in ${scheme} mode`, async ({ browser }) => {
    const page = await openAs(browser, 'member', { colorScheme: scheme })
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([])
  })
}

for (const width of [390, 320]) {
  test(`no horizontal overflow at ${width} CSS pixels`, async ({ browser }) => {
    const page = await openAs(browser, 'owner', { viewport: { width, height: 844 } })
    for (const tab of ['Claude Code', 'Codex']) {
      await page.getByRole('tab', { name: tab }).click()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)
    }
  })
}
