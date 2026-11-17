import fs from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { createAgent, inviteHuman, OWNER } from '../helpers/client'
import { connectMcp } from '../helpers/mcp'
import { expect, openNewPad, signIn, test } from './fixtures'

const V1 = '/client/v1'

async function audit(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(result.violations.map((v) => `${label}: ${v.id} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

async function paste(page: Page, text: string) {
  await page.evaluate((t) => {
    const el = document.activeElement as HTMLElement
    const data = new DataTransfer()
    data.setData('text/plain', t)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, text)
}

test('primary journey: private capture becomes authoritative shared work across Web, a second device, Client API and MCP', async ({ app, owner, page, browser }) => {
  test.setTimeout(120_000)
  const existing = (await owner.post(`${V1}/tasks`, { title: 'Quarterly budget review' })).body.task
  const agent = await createAgent(owner, 'Journey Agent')
  const nosy = await inviteHuman(owner, 'nosy2', 'Nosy Two')

  await signIn(page, app)
  const padId = await openNewPad(page, owner)
  await expect(page.getByRole('textbox', { name: 'New task' })).toBeFocused()
  await page.getByLabel('Pad name').fill('Customer call: Northwind')
  await page.getByLabel('Pad name').press('Enter')

  // heading + text + task + description + mention + bulk paste
  await page.getByRole('textbox', { name: 'New task' }).last().click()
  await page.keyboard.type('Decisions')
  await page.keyboard.press('ControlOrMeta+/')
  await page.getByRole('menuitem', { name: 'Turn into Heading' }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Pricing stays as quoted; see ')
  await page.keyboard.type('@Quarterly')
  await expect(page.getByRole('option', { name: /Quarterly budget review/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ControlOrMeta+/')
  await page.getByRole('menuitem', { name: 'Turn into Task' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Write a title' })).toHaveCount(1)
  await page.getByRole('textbox', { name: 'Text' }).last().type('Send revised contract')
  await page.keyboard.press('ControlOrMeta+/')
  await page.getByRole('menuitem', { name: 'Turn into Task' }).click()
  await page.keyboard.press('Tab')
  await page.keyboard.type('Include the 3-year option')
  await page.keyboard.press('ControlOrMeta+Enter')
  await paste(page, 'Book follow-up\nShare notes with legal\n')
  await page.getByRole('dialog', { name: 'Paste multiple lines' }).getByRole('button', { name: 'Create 2 tasks' }).click()

  await expect
    .poll(async () => ((await owner.get(`${V1}/pads/${padId}/blocks`)).body.items as any[]).map((b) => `${b.depth}:${b.type}:${b.task?.title ?? b.content.map((s: any) => (s.type === 'text' ? s.text : `@${s.taskId}`)).join('')}`), { timeout: 10_000 })
    .toEqual([
      '1:heading:Decisions',
      `2:text:Pricing stays as quoted; see @${existing.id} `,
      '2:task:Send revised contract',
      '2:task:Book follow-up',
      '2:task:Share notes with legal',
    ])

  // งานจริงอยู่บน Board, Client API และ MCP ทันที
  const contract = ((await owner.get(`${V1}/tasks?q=revised contract`)).body.items as any[])[0]
  expect(contract).toMatchObject({ title: 'Send revised contract', description: 'Include the 3-year option', status: 'backlog', project: { name: 'Untitled' } })
  const mcp = await connectMcp(app.url, agent.token)
  try {
    expect(JSON.stringify(await mcp.ok('list_tasks', {}))).toContain('Book follow-up')
    await mcp.ok('update_task', { id: contract.id, status: 'ready' })
  } finally {
    await mcp.close()
  }
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Tasks' }).click()
  await expect(page.getByRole('link', { name: /Share notes with legal/ }).first()).toBeVisible()
  await page.goBack()

  // completion from the Pad; agent change visible in the Pad
  await page.getByRole('checkbox', { name: 'Complete: Book follow-up' }).click()
  await expect.poll(async () => ((await owner.get(`${V1}/tasks?q=Book follow-up`)).body.items as any[])[0].status).toBe('done')

  // second device of the same human sees the same Pad live
  const ctx = await browser.newContext()
  const other = await ctx.newPage()
  await signIn(other, app, OWNER.username, OWNER.password)
  await other.goto(`${app.url}/pads/${padId}`)
  await expect(other.locator('input[value="Send revised contract"]')).toBeVisible()
  await page.locator('input[value="Share notes with legal"]').fill('Share notes with legal and finance')
  await page.locator('input[value="Share notes with legal and finance"]').press('Tab')
  await expect(other.locator('input[value="Share notes with legal and finance"]')).toBeVisible({ timeout: 10_000 })
  await ctx.close()

  // owner search, then private export
  await page.getByRole('searchbox', { name: 'Search pads' }).fill('quoted')
  await expect(page.getByRole('button', { name: /Customer call: Northwind/ })).toContainText('quoted')
  await page.getByRole('searchbox', { name: 'Search pads' }).fill('')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'More pad options' }).click()
  await page.getByRole('menuitem', { name: 'Export my pads' }).click()
  const file = await (await download).path()
  const exported = JSON.parse(fs.readFileSync(file!, 'utf8'))
  const pad = exported.pads.find((p: any) => p.id === padId)
  expect(pad.name).toBe('Customer call: Northwind')
  expect(pad.blocks.filter((b: any) => b.taskId).length).toBe(3)
  expect(JSON.stringify(exported)).not.toContain('Include the 3-year option') // task records are referenced, not copied

  // privacy: another human and the agent cannot see any of it
  expect((await nosy.get(`${V1}/pads/${padId}`)).status).toBe(404)
  expect((await nosy.get(`${V1}/pad-search?q=quoted`)).body.items).toEqual([])
  expect(JSON.stringify((await nosy.get(`${V1}/search?q=quoted`)).body.items)).toBe('[]')
  await audit(page, 'journey end state')
})

test.describe('Task Pads accessibility, reflow, motion and compatibility', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`core Task Pad surfaces pass WCAG 2.2 AA automated checks (${scheme})`, async ({ app, owner, browser }) => {
      const existing = (await owner.post(`${V1}/tasks`, { title: `Mentionable ${scheme}` })).body.task
      const pad = (await owner.post(`${V1}/pads`, { name: `A11y ${scheme}` })).body.pad
      const h = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'heading', content: [{ type: 'text', text: 'Section' }] })).body.block
      await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'text', parentId: h.id, content: [{ type: 'text', text: 'See ' }, { type: 'mention', taskId: existing.id }] })
      const t = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'task', parentId: h.id, title: 'Accessible task' })).body.block
      await owner.patch(`${V1}/pads/${pad.id}/blocks/${t.id}`, { description: 'Some context' })
      const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 860 } })
      const page = await ctx.newPage()
      await signIn(page, app)
      await page.goto(`${app.url}/pads/${pad.id}`)
      await expect(page.locator('input[value="Accessible task"]')).toBeVisible()
      await audit(page, 'editor')
      await page.getByRole('textbox', { name: 'New task' }).last().click()
      await page.keyboard.type('@Mention')
      await expect(page.getByRole('listbox')).toBeVisible()
      await audit(page, 'mention picker')
      await page.keyboard.press('Escape')
      await page.locator('input[value="Accessible task"]').focus()
      await page.keyboard.press('ControlOrMeta+/')
      await expect(page.getByRole('menu')).toBeVisible()
      await audit(page, 'block menu')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Open task details: Accessible task' }).click()
      await expect(page.getByRole('dialog', { name: 'Task details' })).toBeVisible()
      await audit(page, 'side peek')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'More pad options' }).click()
      await page.getByRole('menuitem', { name: 'Capture shortcuts…' }).click()
      await audit(page, 'shortcut settings')
      await ctx.close()
    })
  }

  test('reflows at 320 CSS px (400% zoom) without horizontal scrolling and respects reduced motion', async ({ app, owner, browser }) => {
    const pad = (await owner.post(`${V1}/pads`, { name: 'A very long pad name that must wrap instead of scrolling sideways on tiny screens' })).body.pad
    const h = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'heading', content: [{ type: 'text', text: 'Nested section' }] })).body.block
    const h2 = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'heading', parentId: h.id, content: [{ type: 'text', text: 'Deeper' }] })).body.block
    const h3 = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'text', parentId: h2.id, content: [{ type: 'text', text: 'Third level with a fairly long sentence that wraps' }] })).body.block
    await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'task', parentId: h3.id, title: 'Fourth level task with a long title that must wrap nicely' })
    const ctx = await browser.newContext({ viewport: { width: 320, height: 640 }, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await signIn(page, app)
    await page.goto(`${app.url}/pads/${pad.id}`)
    await expect(page.locator('input[value^="Fourth level task"]')).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await page.getByRole('button', { name: /Open task details: Fourth level/ }).click()
    const animation = await page.locator('dialog.side-peek').evaluate((el) => getComputedStyle(el).animationName)
    expect(animation).toBe('none')
    await ctx.close()
  })

  test('an older server without the task-pads capability hides the surface instead of failing', async ({ app, owner, page }) => {
    expect(owner).toBeTruthy()
    await page.route('**/client/v1/info', async (route) => {
      const res = await route.fetch()
      const body = await res.json()
      body.capabilities = body.capabilities.filter((c: string) => c !== 'task-pads')
      await route.fulfill({ response: res, json: body })
    })
    await signIn(page, app)
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Tasks' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Task Pads' })).toHaveCount(0)
    await page.goto(`${app.url}/pads`)
    await expect(page.getByText('does not offer Task Pads yet')).toBeVisible()
    await page.keyboard.press('Alt+Shift+KeyN')
    await page.waitForTimeout(300)
    await expect(page.getByText('does not offer Task Pads yet')).toBeVisible()
  })
})
