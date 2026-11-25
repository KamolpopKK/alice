import AxeBuilder from '@axe-core/playwright'
import { FakeNativeCore } from './desktop-bridge'
import { test, expect, signIn, accountButton } from './fixtures'

const dialog = (page: import('@playwright/test').Page) => page.getByRole('dialog', { name: 'Document preview', exact: true })

test('shared preview is bounded, keyboard/touch accessible and opens the same original from all entry points @mobile', async ({ app, owner, page }, info) => {
  const target = (await owner.post('/api/documents', { title: 'Preview target', body: 'Bounded source text. '.repeat(300) })).body.document
  const source = (await owner.post('/api/documents', { title: 'Reference source', body: `[Original](/documents/${target.id})\n\n[Missing](/documents/doc_unavailable_preview)` })).body.document
  const project = (await owner.post('/api/projects', { name: 'Preview project' })).body.project
  const topic = (await owner.post(`/client/v1/projects/${project.id}/knowledge/topics`, { name: 'Preview reading', mutationId: crypto.randomUUID() })).body.topic
  await owner.put(`/client/v1/knowledge/topics/${topic.id}/documents/${target.id}`, { expectedRevision: 1, mutationId: crypto.randomUUID() })
  await signIn(page, app)
  await page.goto(`${app.url}/documents/${source.id}`)
  const trigger = page.getByRole('button', { name: 'Preview Original', exact: true })
  if (info.project.name === 'mobile') await trigger.tap()
  else {
    await trigger.focus()
    await page.keyboard.press('Enter')
  }
  const preview = dialog(page)
  await expect(preview.getByRole('heading', { name: 'Preview target', exact: true })).toBeVisible()
  await expect(preview).toContainText('Revision 1')
  await expect(preview).toContainText('This document is unreviewed.')
  expect((await preview.getByLabel('Document content preview').textContent())!.length).toBe(2000)
  await expect(preview.getByRole('link', { name: 'Open document', exact: true })).toHaveAttribute('href', `/documents/${target.id}`)
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async (t) => {
      document.documentElement.setAttribute('data-theme', t)
      await new Promise(requestAnimationFrame)
      await Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => { })))
    }, theme)
    const axe = await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
  }
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await page.getByRole('button', { name: 'Preview Missing', exact: true }).click()
  await expect(preview).toContainText('Document unavailable')
  await expect(preview.getByLabel('Document content preview')).toHaveCount(0)
  await preview.getByRole('button', { name: 'Close preview', exact: true }).click()
  await page.goto(`${app.url}/projects/${project.id}?tab=knowledge`)
  const search = page.getByRole('region', { name: 'Search project knowledge', exact: true })
  await search.getByRole('button', { name: 'Preview Preview target', exact: true }).click()
  await expect(preview.getByRole('heading', { name: 'Preview target', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Show reading list for Preview reading', exact: true }).click()
  await page.getByRole('region', { name: 'Reading list Preview reading', exact: true }).getByRole('button', { name: 'Preview Preview target', exact: true }).click()
  await expect(preview.getByRole('link', { name: 'Open document', exact: true })).toHaveAttribute('href', `/documents/${target.id}`)
  await preview.getByRole('link', { name: 'Open document', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Preview target', exact: true })).toBeVisible()
  const backlinks = page.getByRole('region', { name: 'Document backlinks', exact: true })
  await backlinks.getByRole('button', { name: 'Preview Reference source', exact: true }).click()
  await expect(preview.getByRole('heading', { name: 'Reference source', exact: true })).toBeVisible()
  await preview.getByRole('link', { name: 'Open document', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Reference source', exact: true })).toBeVisible()
})

test('refresh/error/archive states suppress cached content and display the actual review revision @mobile', async ({ app, owner, page }) => {
  const target = (await owner.post('/api/documents', { title: 'Changing preview', body: 'Old preview body.' })).body.document
  const source = (await owner.post('/api/documents', { title: 'Changing source', body: `[Changing target](/documents/${target.id})` })).body.document
  let hold = false
  let fail = false
  const waiting: (() => void)[] = []
  await page.route(`**/documents/${target.id}/preview`, async (route) => {
    if (hold) await new Promise<void>((resolve) => waiting.push(resolve))
    if (fail) await route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR', message: 'Preview fixture unavailable' } } })
    else await route.continue()
  })
  await signIn(page, app)
  await page.goto(`${app.url}/documents/${source.id}`)
  const trigger = page.getByRole('button', { name: 'Preview Changing target', exact: true })
  const preview = dialog(page)
  await trigger.click()
  await expect(preview.getByLabel('Document content preview')).toHaveText('Old preview body.')
  hold = true
  await owner.patch(`/api/documents/${target.id}`, { body: 'New preview body.' })
  await expect.poll(() => waiting.length).toBeGreaterThan(0)
  await expect(preview).toContainText('Loading current document preview')
  await expect(preview.getByLabel('Document content preview')).toHaveCount(0)
  hold = false
  waiting.splice(0).forEach((resolve) => resolve())
  await expect(preview.getByLabel('Document content preview')).toHaveText('New preview body.')
  await expect(preview).toContainText('Revision 2')
  await owner.post(`/api/documents/${target.id}/review`, { expectedRevision: 2 })
  await expect(preview).toContainText('Reviewed revision: 2')
  await expect(preview).not.toContainText('This document is unreviewed.')
  fail = true
  await owner.patch(`/api/documents/${target.id}`, { body: 'Latest preview body.' })
  await expect(preview).toContainText('Preview could not be loaded')
  await expect(preview.getByLabel('Document content preview')).toHaveCount(0)
  fail = false
  await preview.getByRole('button', { name: 'Retry preview', exact: true }).click()
  await expect(preview.getByLabel('Document content preview')).toHaveText('Latest preview body.')
  await expect(preview).toContainText('Revision 3')
  await expect(preview).toContainText('This document is unreviewed.')
  await owner.post(`/api/documents/${target.id}/archive`)
  await expect(preview).toContainText('Document archived')
  await expect(preview.getByLabel('Document content preview')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await owner.post(`/api/documents/${target.id}/restore`)
  hold = true
  await trigger.click()
  await expect.poll(() => waiting.length).toBeGreaterThan(0)
  await expect(preview.getByLabel('Document content preview')).toHaveCount(0)
  hold = false
  waiting.splice(0).forEach((resolve) => resolve())
  await expect(preview.getByLabel('Document content preview')).toHaveText('Latest preview body.')
})

test('preview content stays plain text and unsupported servers keep ordinary links', async ({ app, owner, page }) => {
  const target = (await owner.post('/api/documents', { title: 'Plain preview', body: '![remote](https://example.com/preview-image)\n<script>window.previewExecuted = true</script>' })).body.document
  const source = (await owner.post('/api/documents', { title: 'Plain source', body: `[Plain target](/documents/${target.id})` })).body.document
  const external: string[] = []
  page.on('request', (r) => { if (r.url().startsWith('https://example.com/')) external.push(r.url()) })
  await signIn(page, app)
  await page.goto(`${app.url}/documents/${source.id}`)
  await page.getByRole('button', { name: 'Preview Plain target', exact: true }).click()
  await expect(dialog(page).getByLabel('Document content preview')).toContainText('<script>')
  expect(external).toEqual([])
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).previewExecuted)).toBeUndefined()
  await page.route('**/client/v1/info', async (route) => {
    const response = await route.fetch(), body = await response.json()
    body.capabilities = body.capabilities.filter((c: string) => c !== 'project-knowledge')
    await route.fulfill({ response, json: body })
  })
  await page.reload()
  await expect(page.getByRole('button', { name: 'Preview Plain target', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Plain target', exact: true })).toBeVisible()
})

test('Desktop preview uses the active profile and opens internally with focus/Escape support', async ({ app, owner, page }) => {
  const native = await FakeNativeCore.attach(page)
  const target = (await owner.post('/api/documents', { title: 'Native preview target', body: 'Native bounded source.' })).body.document
  const source = (await owner.post('/api/documents', { title: 'Native preview source', body: `[Native target](/documents/${target.id})` })).body.document
  await page.goto(app.url)
  await page.getByLabel('Profile name').fill('work')
  await page.getByLabel('Server URL').fill(app.url)
  await page.getByRole('button', { name: 'Add server' }).click()
  await page.getByRole('button', { name: 'Sign in with browser' }).click()
  await expect(page.getByLabel('Sign-in code')).toBeVisible()
  await owner.post('/client/v1/device/approve', { userCode: native.pendingUserCode })
  await expect(accountButton(page)).toBeVisible()
  await page.goto(`${app.url}/documents/${source.id}`)
  const trigger = page.getByRole('button', { name: 'Preview Native target', exact: true })
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(dialog(page).getByLabel('Document content preview')).toHaveText('Native bounded source.')
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await trigger.click()
  const opened = native.opened.length
  await dialog(page).getByRole('link', { name: 'Open document', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Native preview target', exact: true })).toBeVisible()
  expect(native.active).toBe('work')
  expect(native.opened).toHaveLength(opened)
})

const fence = (source: string) => `\`\`\`mermaid\n${source}\n\`\`\``

function expandedBody() {
  const filler = Array.from({ length: 40 }, (_, i) => `Filler paragraph ${i + 1}. ${'Plenty of reading text. '.repeat(20)}`).join('\n\n')
  return [
    '# Expanded target',
    'Opening paragraph.',
    '| Column A | Column B | Column C |\n| --- | --- | --- |\n| a1 | b1 | c1 |',
    fence('flowchart LR\n  Start --> Finish'),
    filler,
    '## Late section',
    'This section sits far down the document.',
  ].join('\n\n')
}

test('Expand to read loads the full current document only on request, in place, and closes one layer at a time @mobile', async ({ app, owner, page }, info) => {
  const target = (await owner.post('/api/documents', { title: 'Expanded target', body: expandedBody() })).body.document
  const source = (await owner.post('/api/documents', { title: 'Expand source', body: `See [the late section](/documents/${target.id}#late-section).` })).body.document
  const before = (await owner.get(`/api/documents/${target.id}`)).body.document
  const content: string[] = []
  const writes: string[] = []
  page.on('request', (r) => {
    if (r.url().includes(`/documents/${target.id}/content`)) content.push(r.url())
    if (r.method() !== 'GET' && r.url().includes('/documents')) writes.push(`${r.method()} ${r.url()}`)
  })
  // บีบหน้าต่างให้เล็กลง เพื่อพิสูจน์ว่าอ่านต่อจนครบที่ revision เดิมก่อนแสดง
  await page.route(`**/documents/${target.id}/content?**`, async (route) => {
    const url = new URL(route.request().url())
    url.searchParams.set('maxChars', '4000')
    await route.continue({ url: url.toString() })
  })
  await signIn(page, app)
  await page.goto(`${app.url}/documents/${source.id}`)
  const pageUrl = page.url()
  const trigger = page.getByRole('button', { name: 'Preview the late section', exact: true })
  await trigger.click()
  const preview = dialog(page)
  await expect(preview.getByLabel('Document content preview')).toBeVisible()
  expect(content).toEqual([])

  const expand = preview.getByRole('button', { name: 'Expand to read', exact: true })
  await expand.click()
  const reader = page.getByRole('dialog', { name: 'Expanded target', exact: true })
  await expect(reader.getByRole('heading', { name: 'Late section', exact: true })).toBeInViewport()
  await expect(reader).toContainText(`Saved document · Unreviewed · Revision ${target.revision} · Reviewed revision: Not reviewed`)
  await expect(reader).toContainText('This document is unreviewed.')
  await expect(reader.getByRole('region', { name: 'Table, scrolls sideways when wide' })).toBeVisible()
  await expect(reader.locator('.mermaid-diagram img')).toHaveCount(1)
  expect(content.length).toBeGreaterThan(1)
  for (const [i, url] of content.entries()) {
    const params = new URL(url).searchParams
    expect(params.get('expectedRevision')).toBe(String(target.revision))
    if (i === 0) expect(params.get('offset')).toBe('0')
  }
  expect(page.url()).toBe(pageUrl)

  // preview → reader → diagram: Escape ปิดทีละชั้นและคืน focus
  const diagramButton = reader.getByRole('button', { name: 'Expand diagram', exact: true })
  await diagramButton.click()
  const viewer = page.getByRole('dialog', { name: 'Diagram', exact: true })
  await expect(viewer.getByRole('button', { name: 'Close' })).toBeFocused()
  await page.evaluate(() => new Promise(requestAnimationFrame))
  await page.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
  await expect(diagramButton).toBeFocused()
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async (t) => {
      document.documentElement.setAttribute('data-theme', t)
      await new Promise(requestAnimationFrame)
      await Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => { })))
    }, theme)
    const axe = await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
  }
  await page.screenshot({ path: `.alice-test/document-reading/expanded-preview-${info.project.name}.png` })
  await page.keyboard.press('Escape')
  await expect(reader).toHaveCount(0)
  await expect(preview).toBeVisible()
  await expect(expand).toBeFocused()
  await page.evaluate(() => new Promise(requestAnimationFrame))
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
  await expect(trigger).toBeFocused()
  expect(page.url()).toBe(pageUrl)
  expect(writes).toEqual([])
  const after = (await owner.get(`/api/documents/${target.id}`)).body.document
  for (const key of ['body', 'revision', 'status', 'reviewedRevision', 'relations', 'updatedAt'] as const) expect(after[key]).toEqual(before[key])
})

test('every preview entry point offers Expand to read, and links inside leave through the router', async ({ app, owner, page }) => {
  const other = (await owner.post('/api/documents', { title: 'Further reading', body: 'Further body.' })).body.document
  const target = (await owner.post('/api/documents', { title: 'Shared target', body: `Shared body with [further reading](/documents/${other.id}).` })).body.document
  await owner.post('/api/documents', { title: 'Backlink source', body: `[Shared target](/documents/${target.id})` })
  const project = (await owner.post('/api/projects', { name: 'Expand project' })).body.project
  await owner.post(`/api/documents/${target.id}/link`, { projectId: project.id })
  const topic = (await owner.post(`/client/v1/projects/${project.id}/knowledge/topics`, { name: 'Expand reading', mutationId: crypto.randomUUID() })).body.topic
  await owner.put(`/client/v1/knowledge/topics/${topic.id}/documents/${target.id}`, { expectedRevision: 1, mutationId: crypto.randomUUID() })
  await signIn(page, app)
  const preview = dialog(page)
  const reader = page.getByRole('dialog', { name: 'Shared target', exact: true })
  const expandFrom = async (trigger: import('@playwright/test').Locator) => {
    await trigger.click()
    await preview.getByRole('button', { name: 'Expand to read', exact: true }).click()
    await expect(reader).toContainText('Shared body with')
    await page.keyboard.press('Escape')
    await expect(reader).toHaveCount(0)
    await page.evaluate(() => new Promise(requestAnimationFrame))
    await page.keyboard.press('Escape')
    await expect(preview).toHaveCount(0)
  }
  await page.goto(`${app.url}/projects/${project.id}?tab=knowledge`)
  await expandFrom(page.getByRole('region', { name: 'Search project knowledge', exact: true }).getByRole('button', { name: 'Preview Shared target', exact: true }))
  await page.getByRole('button', { name: 'Show reading list for Expand reading', exact: true }).click()
  await expandFrom(page.getByRole('region', { name: 'Reading list Expand reading', exact: true }).getByRole('button', { name: 'Preview Shared target', exact: true }))
  await page.goto(`${app.url}/documents/${other.id}`)
  await page.getByRole('region', { name: 'Document backlinks', exact: true }).getByRole('button', { name: 'Preview Shared target', exact: true }).click()
  await preview.getByRole('button', { name: 'Expand to read', exact: true }).click()
  await reader.getByRole('link', { name: 'further reading', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Further reading', level: 1 })).toBeVisible()
})

test('expanded reading never shows a stale, mixed or archived body and discards late results @mobile', async ({ app, owner, page }) => {
  const target = (await owner.post('/api/documents', { title: 'Lifecycle target', body: 'First full body.' })).body.document
  const source = (await owner.post('/api/documents', { title: 'Lifecycle source', body: `[Lifecycle target](/documents/${target.id})\n\n[Missing](/documents/doc_missing_expand)` })).body.document
  let mode: 'pass' | 'fail' | 'hold' | 'edit' | 'archive' = 'pass'
  const waiting: (() => void)[] = []
  await page.route(`**/documents/${target.id}/content?**`, async (route) => {
    if (mode === 'fail') return route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR', message: 'Content fixture unavailable' } } })
    if (mode === 'hold') await new Promise<void>((resolve) => waiting.push(resolve))
    if (mode === 'edit') { mode = 'pass'; await owner.patch(`/api/documents/${target.id}`, { body: 'Edited between reads.' }) }
    if (mode === 'archive') { mode = 'pass'; await owner.post(`/api/documents/${target.id}/archive`) }
    await route.continue()
  })
  await signIn(page, app)
  await page.goto(`${app.url}/documents/${source.id}`)
  const preview = dialog(page)
  const reader = page.getByRole('dialog', { name: 'Lifecycle target', exact: true })
  const body = reader.locator('.document-reader-body')

  // ไม่มีปุ่มขยายสำหรับเอกสารที่หาไม่พบ
  await page.getByRole('button', { name: 'Preview Missing', exact: true }).click()
  await expect(preview).toContainText('Document unavailable')
  await expect(preview.getByRole('button', { name: 'Expand to read' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Preview Lifecycle target', exact: true }).click()
  // เอกสารเปลี่ยนระหว่างอ่าน: CONFLICT ไม่ประกอบเนื้อหาข้าม revision แล้วโหลดฉบับล่าสุดเมื่อกด
  mode = 'edit'
  await preview.getByRole('button', { name: 'Expand to read', exact: true }).click()
  await expect(reader).toContainText('This document changed while loading')
  await expect(body).toHaveCount(0)
  await reader.getByRole('button', { name: 'Load latest', exact: true }).click()
  await expect(body).toHaveText('Edited between reads.')
  await expect(reader).toContainText('Revision 2')

  // invalidation ระหว่างเปิด: ซ่อนผลเก่าระหว่างตรวจใหม่
  mode = 'hold'
  await owner.patch(`/api/documents/${target.id}`, { body: 'Third full body.' })
  await expect.poll(() => waiting.length).toBeGreaterThan(0)
  await expect(reader).toContainText('Loading the full current document')
  await expect(body).toHaveCount(0)
  mode = 'pass'
  waiting.splice(0).forEach((resolve) => resolve())
  await expect(body).toHaveText('Third full body.')
  await expect(reader).toContainText('Revision 3')

  // error แล้ว retry
  mode = 'fail'
  await owner.patch(`/api/documents/${target.id}`, { body: 'Fourth full body.' })
  await expect(reader).toContainText('The full document could not be loaded')
  await expect(body).toHaveCount(0)
  mode = 'pass'
  await reader.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(body).toHaveText('Fourth full body.')

  // ผลที่กลับมาหลังปิดถูกทิ้ง; เปิดใหม่อ่านฉบับปัจจุบัน
  await page.keyboard.press('Escape')
  await expect(reader).toHaveCount(0)
  mode = 'hold'
  await preview.getByRole('button', { name: 'Expand to read', exact: true }).click()
  await expect.poll(() => waiting.length).toBeGreaterThan(0)
  await page.keyboard.press('Escape')
  await expect(reader).toHaveCount(0)
  await owner.patch(`/api/documents/${target.id}`, { body: 'Fifth full body.' })
  mode = 'pass'
  waiting.splice(0).forEach((resolve) => resolve())
  await page.waitForTimeout(200)
  await expect(reader).toHaveCount(0)
  await expect(preview).toBeVisible()
  await expect(preview.getByLabel('Document content preview')).toHaveText('Fifth full body.')
  await preview.getByRole('button', { name: 'Expand to read', exact: true }).click()
  await expect(body).toHaveText('Fifth full body.')
  await page.keyboard.press('Escape')

  // ถูก archive ระหว่างตรวจสถานะกับอ่านเนื้อหา: ไม่แสดง body
  await expect(reader).toHaveCount(0)
  mode = 'archive'
  await preview.getByRole('button', { name: 'Expand to read', exact: true }).click()
  await expect(reader).toContainText('Document archived')
  await expect(body).toHaveCount(0)
  await expect(reader).not.toContainText('Fifth full body.')
})

test('expanded reading renders through the safe Markdown renderer', async ({ app, owner, page }) => {
  const target = (await owner.post('/api/documents', { title: 'Hostile expanded', body: '![remote](https://example.com/expanded-image)\n\n<script>window.expandedExecuted = true</script>\n\n[js](javascript:alert(1))\n\nSafe text.' })).body.document
  const source = (await owner.post('/api/documents', { title: 'Hostile source', body: `[Hostile target](/documents/${target.id})` })).body.document
  await signIn(page, app)
  await page.goto(`${app.url}/documents/${source.id}`)
  await page.getByRole('button', { name: 'Preview Hostile target', exact: true }).click()
  await dialog(page).getByRole('button', { name: 'Expand to read', exact: true }).click()
  const reader = page.getByRole('dialog', { name: 'Hostile expanded', exact: true })
  await expect(reader).toContainText('Safe text.')
  await expect(reader.locator('script')).toHaveCount(0)
  expect(await reader.getByRole('link', { name: 'js' }).getAttribute('href')).not.toContain('javascript:')
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).expandedExecuted)).toBeUndefined()
})
