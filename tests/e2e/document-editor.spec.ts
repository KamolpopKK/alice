import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, signIn, test } from './fixtures'

/** Rich-text document editing: formatting, Markdown preservation, raw blocks, safe paste and fallback. */
const editor = (page: Page) => page.getByRole('textbox', { name: 'Body', exact: true })
const tool = (page: Page, name: string) => page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name, exact: true })

async function editDocument(page: Page, appUrl: string, id: string) {
  await page.goto(`${appUrl}/documents/${id}`)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(editor(page)).toBeVisible()
}

test('people format a new document in rich text and it is saved as Markdown', async ({ app, owner, page }) => {
  await signIn(page, app)
  await page.goto(`${app.url}/documents?new=1`)
  const form = page.getByRole('form', { name: 'New document' })
  await form.getByLabel('Document title').fill('Rich formatting')
  const body = editor(page)
  await body.click()
  await tool(page, 'Heading 2').click()
  await page.keyboard.type('Launch plan')
  await page.keyboard.press('Enter')
  await tool(page, 'Bold').click()
  await page.keyboard.type('Owner')
  await tool(page, 'Bold').click()
  await page.keyboard.type(' is ภาษาไทย 🎉')
  await page.keyboard.press('Enter')
  await tool(page, 'Checklist').click()
  await page.keyboard.type('DNS ready')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Read the docs')
  await page.keyboard.down('Shift')
  for (let i = 0; i < 'Read the docs'.length; i++) await page.keyboard.press('ArrowLeft')
  await page.keyboard.up('Shift')
  await tool(page, 'Link').click()
  await page.getByLabel('Link address').fill('https://example.com/docs')
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(editor(page)).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await tool(page, 'Bulleted list').click()
  await page.keyboard.type('first point')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await tool(page, 'Code block').click()
  await page.keyboard.type('npm test')
  await expect(tool(page, 'Code block')).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Create document' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Rich formatting' })).toBeVisible()
  const id = page.url().split('/').pop()!
  const saved = (await owner.get(`/client/v1/documents/${id}`)).body.document.body as string
  expect(saved).toContain('## Launch plan')
  expect(saved).toContain('**Owner** is ภาษาไทย 🎉')
  expect(saved).toContain('- [ ] DNS ready')
  expect(saved).toContain('[Read the docs](https://example.com/docs)')
  expect(saved).toContain('- first point')
  expect(saved).toContain('```\nnpm test\n```')
})

test('untouched Markdown, raw blocks and Mermaid survive rich editing and switching modes', async ({ app, owner, page }) => {
  const original = [
    '# Title',
    'Intro paragraph.',
    '<div align="center"><img src="x" onerror="window.__pwned = 1"></div>',
    '<!-- reviewer note -->',
    '| A | B |\n|:--|--:|\n| 1 | 2 |',
    '```mermaid\nflowchart LR\n  A[Draft] --> B[Saved]\n```',
    'See [the spec][spec].',
    '[spec]: https://example.com/spec',
  ].join('\n\n') + '\n'
  const doc = (await owner.post('/client/v1/documents', { title: 'Mixed content', body: original })).body.document
  await signIn(page, app)
  await editDocument(page, app.url, doc.id)

  // raw blocks: แสดงเป็นข้อความ ไม่มี element จาก HTML ใน source และ toolbar แก้ไม่ได้
  const raw = page.locator('.doc-raw-block')
  await expect(raw).toHaveCount(4)
  await expect(raw.first()).toContainText('<div align="center"><img src="x" onerror="window.__pwned = 1"></div>')
  await expect(page.locator('.doc-editor-content img[src="x"]')).toHaveCount(0)
  expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined()
  await raw.nth(1).locator('pre').click()
  await expect(tool(page, 'Bold')).toBeDisabled()
  await expect(tool(page, 'Heading 2')).toBeDisabled()

  // Mermaid ยังเป็น code block และมี preview
  await expect(page.getByLabel('Diagram preview').locator('img')).toHaveCount(1)

  // แก้ย่อหน้าเดียว: ส่วนอื่นเหมือนเดิมทุกตัวอักษร
  await page.locator('.doc-editor-content p', { hasText: 'Intro paragraph.' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Edited.')
  await page.getByRole('radio', { name: 'Markdown' }).click()
  const expected = original.replace('Intro paragraph.', 'Intro paragraph. Edited.')
  await expect(page.getByLabel('Body', { exact: true })).toHaveValue(expected)
  await page.getByRole('radio', { name: 'Rich text' }).click()
  await expect(page.locator('.doc-raw-block')).toHaveCount(4)
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect.poll(async () => (await owner.get(`/client/v1/documents/${doc.id}`)).body.document.body).toBe(expected)

  // "Edit in Markdown" เปิดโหมด source
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('button', { name: 'Edit in Markdown' }).first().click()
  await expect(page.getByRole('radio', { name: 'Markdown' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByLabel('Body', { exact: true })).toHaveValue(expected)
})

test('pasted or typed active content cannot run and unsafe links are refused', async ({ app, owner, page }) => {
  const doc = (await owner.post('/client/v1/documents', { title: 'Paste target', body: 'Start\n' })).body.document
  let dialogs = 0
  page.on('dialog', (d) => {
    dialogs++
    void d.dismiss()
  })
  await signIn(page, app)
  await editDocument(page, app.url, doc.id)
  await page.locator('.doc-editor-content p').click()
  await page.keyboard.press('End')
  await editor(page).evaluate((el) => {
    const data = new DataTransfer()
    data.setData('text/html', '<p><a href="javascript:window.__pwned=1">bad link</a> <img src="x" onerror="window.__pwned=2"><script>window.__pwned=3</script><b onclick="window.__pwned=4">bold</b> <a href="https://example.com/ok">good link</a></p>')
    data.setData('text/plain', 'bad link bold good link')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await expect(page.locator('.doc-editor-content')).toContainText('good link')
  await expect(page.locator('.doc-editor-content a[href^="javascript"]')).toHaveCount(0)
  await expect(page.locator('.doc-editor-content img, .doc-editor-content script, .doc-editor-content [onclick]')).toHaveCount(0)
  await page.locator('.doc-editor-content a', { hasText: 'good link' }).click()
  await page.locator('.doc-editor-content a', { hasText: 'bad link' }).count()

  await tool(page, 'Link').click()
  await page.getByLabel('Link address').fill('javascript:alert(1)')
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByText('Use a web address (https://…), a mailto: link or a path.')).toBeVisible()
  await page.getByRole('group', { name: 'Link' }).getByRole('button', { name: 'Cancel' }).click()

  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect.poll(async () => (await owner.get(`/client/v1/documents/${doc.id}`)).body.document.body).toContain('[good link](https://example.com/ok)')
  const saved = (await owner.get(`/client/v1/documents/${doc.id}`)).body.document.body as string
  expect(saved).not.toMatch(/javascript:|onerror|<script/i)
  expect(dialogs).toBe(0)
  expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined()
})

test('if the rich editor cannot load, the Markdown source still works', async ({ app, owner, page }) => {
  const doc = (await owner.post('/client/v1/documents', { title: 'Fallback', body: 'Keep me\n' })).body.document
  await page.route(/RichDocumentEditor-[\w-]+\.js$/, (route) => route.abort())
  await signIn(page, app)
  await page.goto(`${app.url}/documents/${doc.id}`)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.getByText('The rich text editor could not load. You can keep editing the Markdown source.')).toBeVisible()
  const source = page.getByLabel('Body', { exact: true })
  await expect(source).toHaveValue('Keep me\n')
  await source.fill('Keep me\n\nAdded in source.\n')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect.poll(async () => (await owner.get(`/client/v1/documents/${doc.id}`)).body.document.body).toBe('Keep me\n\nAdded in source.\n')
})

for (const theme of ['light', 'dark'] as const) {
  test(`the document editor passes axe, works by keyboard and fits 320 px (${theme})`, async ({ app, owner, page }) => {
    const doc = (await owner.post('/client/v1/documents', { title: `Axe ${theme}`, body: '# Heading\n\n<!-- raw -->\n\n- [ ] item\n\n| a | b |\n|---|---|\n| 1 | 2 |\n' })).body.document
    await page.addInitScript((t) => localStorage.setItem('alice.ui.theme', t), theme)
    await signIn(page, app)
    await editDocument(page, app.url, doc.id)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).include('#main').analyze()
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])

    // คีย์บอร์ด: โฟกัสเข้า editor, ใช้ปุ่มลัด แล้วไปที่ toolbar ได้
    await editor(page).focus()
    await page.keyboard.press('End')
    await page.keyboard.press('ControlOrMeta+b')
    await page.keyboard.type('x')
    await expect(page.locator('.doc-editor-content strong', { hasText: 'x' })).toHaveCount(1)
    await tool(page, 'Italic').focus()
    await expect(tool(page, 'Italic')).toBeFocused()

    await page.setViewportSize({ width: 320, height: 800 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
