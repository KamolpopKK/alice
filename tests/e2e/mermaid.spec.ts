import AxeBuilder from '@axe-core/playwright'
import fs from 'node:fs'
import path from 'node:path'
import { expect, signIn, test } from './fixtures'

const EVIDENCE = path.resolve('.alice-test/document-reading')

const fence = (source: string) => `\`\`\`mermaid\n${source}\n\`\`\``
const flow = 'flowchart LR\n  A[Browser] --> B[API]'

test('Mermaid renders four diagram types, isolates errors and follows the theme @mobile', async ({ app, owner, page }) => {
  const body = [
    '**Readable content**', fence(flow),
    fence('sequenceDiagram\n  Browser->>API: Request\n  API-->>Browser: Response'),
    fence('stateDiagram-v2\n  [*] --> Ready\n  Ready --> Done'),
    fence('erDiagram\n  TASK ||--o{ COMMENT : has'),
    fence('this is invalid mermaid'),
    '```js\nconst unchanged = true\n```',
  ].join('\n\n')
  const doc = (await owner.post('/api/documents', { title: 'Mermaid coverage', body })).body.document
  await signIn(page, app)
  await page.goto(`${app.url}/documents/${doc.id}`)
  const images = page.locator('.document-body .mermaid-diagram img')
  await expect(images).toHaveCount(4)
  for (const image of await images.all()) {
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0)
    expect(await image.evaluate((node: HTMLImageElement) => node.getBoundingClientRect().width <= node.naturalWidth + 1)).toBe(true)
  }
  await expect(page.getByText(/Unable to render Mermaid diagram/)).toBeVisible()
  await expect(page.locator('.document-body strong')).toHaveText('Readable content')
  await expect(page.locator('code.language-js')).toHaveText('const unchanged = true\n')
  const light = await images.first().getAttribute('src')
  await page.evaluate(() => localStorage.setItem('alice.ui.theme', 'dark'))
  await page.reload()
  await expect(images).toHaveCount(4)
  await expect(images.first()).not.toHaveAttribute('src', light!)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('mermaid-dark.png'), fullPage: true })
  expect((await owner.get(`/api/documents/${doc.id}`)).body.document.body).toBe(body)

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('radio', { name: 'Markdown' }).click()
  const editor = page.getByLabel('Body', { exact: true })
  await editor.fill(fence('flowchart LR\n  X[Latest] --> Y[Preview]'))
  await page.locator('.preview > summary').click()
  const preview = page.locator('.preview .mermaid-diagram img')
  await expect(preview).toHaveCount(1)
  await editor.fill(fence('flowchart LR\n  X[FinalEdit] --> Y[Preview]'))
  await expect.poll(async () => decodeURIComponent((await preview.getAttribute('src')) ?? '').includes('FinalEdit')).toBe(true)
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.getByRole('button', { name: 'History' }).click()
  await page.getByRole('button', { name: 'Revision 1', exact: true }).click()
  await expect(page.locator('.revision-preview .mermaid-diagram img')).toHaveCount(4)
})

test('shared Mermaid renderer covers task, comments and project and blocks active content @mobile', async ({ app, owner, page }) => {
  const project = (await owner.post('/api/projects', { name: 'Diagram project', description: fence(flow) })).body.project
  const description = [
    fence(flow),
    fence('%%{init: {"securityLevel":"loose", "htmlLabels":true}}%%\nflowchart LR\n  A["<img src=x onerror=alert(1)>"] --> B[Safe]\n  click B "javascript:alert(1)"'),
    fence('flowchart LR\n  X@{ img: "https://example.invalid/private-content" }'),
    fence('flowchart LR\n  A --> B\n  style A fill:url(https://example.invalid/private-content)'),
  ].join('\n\n')
  const task = (await owner.post('/api/tasks', { title: 'Diagram task', description, projectId: project.id })).body.task
  const dialogs: string[] = []
  const external: string[] = []
  page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss() })
  page.on('request', (request) => { if (request.url().includes('example.invalid')) external.push(request.url()) })
  await signIn(page, app)
  await page.goto(`${app.url}/tasks/${task.id}`)
  await expect(page.locator('.mermaid-diagram img')).toHaveCount(2)
  await expect(page.getByText(/Unable to render Mermaid diagram/)).toHaveCount(2)
  await page.getByLabel('Add a comment').fill(fence('flowchart LR\n  Comment --> Diagram'))
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(page.locator('.comment .mermaid-diagram img')).toHaveCount(1)
  expect(dialogs).toEqual([])
  expect(external).toEqual([])
  expect(await page.locator('.mermaid-diagram script, .mermaid-diagram iframe, .mermaid-diagram a').count()).toBe(0)
  await page.goto(`${app.url}/projects/${project.id}`)
  await expect(page.locator('.mermaid-diagram img')).toHaveCount(1)
})

const bigFlow = () => ['flowchart TB', ...Array.from({ length: 99 }, (_, i) => `  N${i}[Node ${i}] --> N${i + 1}[Node ${i + 1}]`)].join('\n')

async function settle(page: import('@playwright/test').Page, theme: string) {
  await page.evaluate(async (t) => {
    document.documentElement.setAttribute('data-theme', t)
    await new Promise(requestAnimationFrame)
    await Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {})))
  }, theme)
}

test('the expanded diagram viewer fits, zooms and pans the rendered image without rendering again @mobile', async ({ app, owner, page }, info) => {
  const body = ['Before the diagrams.', fence(flow), fence(bigFlow()), fence('this is invalid mermaid'), 'After the diagrams.'].join('\n\n')
  const doc = (await owner.post('/api/documents', { title: 'Diagram viewer', body })).body.document
  await signIn(page, app)
  await page.goto(`${app.url}/documents/${doc.id}`)
  const inline = page.locator('.document-body .mermaid-diagram img')
  await expect(inline).toHaveCount(2)
  // เฉพาะ diagram ที่ render สำเร็จมีปุ่มขยาย; diagram ที่ผิดยังแสดง error และ source
  const expand = page.locator('.document-body').getByRole('button', { name: 'Expand diagram', exact: true })
  await expect(expand).toHaveCount(2)
  await expect(page.getByText(/Unable to render Mermaid diagram/)).toBeVisible()
  await expect(page.locator('.document-body').getByText('After the diagrams.')).toBeVisible()

  // นับการ render ใหม่: MermaidDiagram ตั้ง aria-busy ทุกครั้งที่ render
  await page.evaluate(() => {
    const w = window as unknown as { __renders: number }
    w.__renders = 0
    new MutationObserver((records) => { for (const r of records) if ((r.target as Element).getAttribute('aria-busy') === 'true') w.__renders++ })
      .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-busy'] })
  })
  const src = await inline.nth(1).getAttribute('src')
  await expect.poll(() => inline.nth(1).evaluate((n: HTMLImageElement) => n.naturalHeight)).toBeGreaterThan(0)
  await expand.nth(1).click()
  const viewer = page.getByRole('dialog', { name: 'Diagram', exact: true })
  const viewport = viewer.getByRole('region', { name: 'Diagram, scroll to move around' })
  const image = viewport.getByRole('img', { name: 'Mermaid diagram' })
  const zoom = viewer.getByRole('status', { name: 'Zoom level' })
  await expect(image).toHaveAttribute('src', src!)
  await expect(viewer.getByRole('button', { name: 'Fit to view' })).toHaveAttribute('aria-pressed', 'true')

  const fits = () => viewport.evaluate((v) => {
    const img = v.querySelector('img')!
    return img.getBoundingClientRect().width <= v.clientWidth + 1 && img.getBoundingClientRect().height <= v.clientHeight + 1 && v.scrollWidth <= v.clientWidth + 1 && v.scrollHeight <= v.clientHeight + 1
  })
  await expect.poll(fits).toBe(true)
  const fitText = await zoom.textContent()
  expect(Number(fitText!.replace('%', ''))).toBeLessThan(100)

  // ซูมด้วยปุ่มและคีย์บอร์ด (เฉพาะเมื่อ focus อยู่ใน viewer)
  await viewer.getByRole('button', { name: 'Zoom in' }).click()
  await viewer.getByRole('button', { name: 'Zoom in' }).click()
  await expect(zoom).not.toHaveText(fitText!)
  await expect(viewer.getByRole('button', { name: 'Fit to view' })).toHaveAttribute('aria-pressed', 'false')
  await viewport.focus()
  const zoomed = await zoom.textContent()
  await page.keyboard.press('+')
  await expect(zoom).not.toHaveText(zoomed!)
  await page.keyboard.press('-')
  await expect(zoom).toHaveText(zoomed!)
  // เลื่อนสำรวจด้วยคีย์บอร์ดเมื่อภาพใหญ่กว่าพื้นที่
  for (let i = 0; i < 8; i++) await page.keyboard.press('+')
  await expect.poll(() => viewport.evaluate((v) => v.scrollHeight > v.clientHeight)).toBe(true)
  const top = await viewport.evaluate((v) => v.scrollTop)
  await page.keyboard.press('PageDown')
  await expect.poll(() => viewport.evaluate((v) => v.scrollTop)).toBeGreaterThan(top)
  // ซูมมีขอบเขต
  for (let i = 0; i < 20; i++) await page.keyboard.press('+')
  await expect(zoom).toHaveText('400%')
  await expect(viewer.getByRole('button', { name: 'Zoom in' })).toBeDisabled()

  // ปรับขนาดหน้าต่าง: โหมดซูมเองไม่ถูก reset; โหมด Fit คำนวณใหม่
  const viewportSize = page.viewportSize()!
  await page.setViewportSize({ width: viewportSize.width - 100, height: viewportSize.height - 100 })
  await expect(zoom).toHaveText('400%')
  await page.keyboard.press('0')
  await expect(viewer.getByRole('button', { name: 'Fit to view' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(fits).toBe(true)
  const smallerWidth = await image.evaluate((n) => n.getBoundingClientRect().width)
  await page.setViewportSize(viewportSize)
  await expect.poll(() => image.evaluate((n) => n.getBoundingClientRect().width)).toBeGreaterThan(smallerWidth)
  await expect.poll(fits).toBe(true)

  expect(await page.evaluate(() => (window as unknown as { __renders: number }).__renders)).toBe(0)
  await expect(image).toHaveAttribute('src', src!)
  fs.mkdirSync(EVIDENCE, { recursive: true })
  await page.screenshot({ path: `${EVIDENCE}/mermaid-viewer-${info.project.name}.png` })
  for (const theme of ['light', 'dark']) {
    await settle(page, theme)
    const axe = await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
  }

  await page.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
  await expect(expand.nth(1)).toBeFocused()
  expect((await owner.get(`/api/documents/${doc.id}`)).body.document.body).toBe(body)
})

test('the diagram viewer nests above the focus reader and the editor preview', async ({ app, owner, page }) => {
  const doc = (await owner.post('/api/documents', { title: 'Nested viewer', body: `Intro.\n\n${fence(flow)}` })).body.document
  await signIn(page, app)
  await page.goto(`${app.url}/documents/${doc.id}`)
  await page.getByRole('button', { name: 'Focus reader', exact: true }).click()
  const reader = page.getByRole('dialog', { name: 'Nested viewer', exact: true })
  const expand = reader.getByRole('button', { name: 'Expand diagram', exact: true })
  await expand.click()
  const viewer = page.getByRole('dialog', { name: 'Diagram', exact: true })
  await expect(viewer.getByRole('button', { name: 'Close' })).toBeFocused()
  await page.evaluate(() => new Promise(requestAnimationFrame))
  await page.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
  await expect(reader).toBeVisible()
  await expect(expand).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(reader).toHaveCount(0)

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const preview = page.locator('.doc-code-preview')
  await preview.getByRole('button', { name: 'Expand diagram', exact: true }).click()
  await expect(viewer).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
  await expect(page.locator('.doc-editor-content[contenteditable="true"]')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await owner.get(`/api/documents/${doc.id}`)).body.document.revision).toBe(doc.revision)
})
