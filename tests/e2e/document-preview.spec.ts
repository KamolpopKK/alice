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
