import type { Page } from '@playwright/test'
import { expect, signIn, test } from './fixtures'

/**
 * Alice Desktop freezes Object.prototype before any page script runs (`freezePrototype` in tauri.conf.json).
 * A library that assigns `valueOf`, `toString` or `toJSON` on its own prototypes then throws at load and the
 * whole window stays blank, which an ordinary browser never shows. This runs the main screens the same way.
 */
const V1 = '/client/v1'
const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript({ content: 'Object.freeze(Object.prototype)' })
})

test('the Board loads and a card can be dragged with a frozen prototype', async ({ app, owner, page }) => {
  const errors = collectErrors(page)
  const label = `frozen${stamp()}`
  const task = (await owner.post(`${V1}/tasks`, { title: `${label} card`, status: 'ready' })).body.task
  await signIn(page, app)
  await page.goto(`${app.url}/tasks?view=board&q=${label}`)
  const card = page.locator('.tasks-card-drag', { hasText: task.title })
  await expect(card).toBeVisible()
  const from = (await card.boundingBox())!
  const to = (await page.getByRole('region', { name: 'In progress' }).boundingBox())!
  await page.mouse.move(from.x + from.width - 10, from.y + 8)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width + 4, from.y + 12, { steps: 3 })
  await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 12 })
  await page.mouse.up()
  await expect(page.getByRole('status').filter({ hasText: `Moved ${task.title} to In progress.` })).toBeVisible()
  expect(errors).toEqual([])
})

// gantt ใช้ dayjs กับ plugin (duration, customParseFormat, ...) ซึ่งตั้ง valueOf/toString/toJSON บน prototype ของตัวเอง
test('Mermaid diagrams render with a frozen prototype', async ({ app, owner, page }) => {
  const errors = collectErrors(page)
  const fence = (source: string) => `\`\`\`mermaid\n${source}\n\`\`\``
  const body = [
    fence('flowchart LR\n  A[Draft] --> B[Done]'),
    fence('sequenceDiagram\n  Browser->>API: Request'),
    fence('gantt\n  dateFormat YYYY-MM-DD\n  section Work\n  Build :a1, 2026-01-01, 3d\n  Ship :after a1, 2d'),
  ].join('\n\n')
  const doc = (await owner.post(`${V1}/documents`, { title: `Frozen diagrams ${stamp()}`, body })).body.document
  await signIn(page, app)
  await page.goto(`${app.url}/documents/${doc.id}`)
  const images = page.locator('.document-body .mermaid-diagram img')
  await expect(images).toHaveCount(3)
  for (const image of await images.all()) {
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0)
  }
  await expect(page.getByText(/Unable to render Mermaid diagram/)).toHaveCount(0)
  expect(errors).toEqual([])
})

test('documents open, edit and switch modes with a frozen prototype', async ({ app, owner, page }) => {
  const errors = collectErrors(page)
  const body = '# Frozen\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [ ] todo\n\n```ts\nconst x = 1\n```\n'
  const doc = (await owner.post(`${V1}/documents`, { title: `Frozen ${stamp()}`, body })).body.document
  await signIn(page, app)
  await page.goto(`${app.url}/documents/${doc.id}`)
  await expect(page.locator('.document-body table')).toBeVisible()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.locator('.doc-editor-content[contenteditable="true"]')).toBeVisible()
  await page.getByRole('radio', { name: 'Markdown' }).click()
  await expect(page.getByLabel('Body', { exact: true })).toHaveValue(body)
  await page.goto(`${app.url}/documents/new`)
  await expect(page.getByLabel('Document title')).toBeVisible()
  expect(errors).toEqual([])
})
