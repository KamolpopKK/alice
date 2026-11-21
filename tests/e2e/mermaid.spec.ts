import { expect, signIn, test } from './fixtures'

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
  const editor = page.getByLabel('Body (Markdown)')
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
