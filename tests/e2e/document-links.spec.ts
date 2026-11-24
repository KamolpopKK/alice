import { FakeNativeCore } from './desktop-bridge'
import { accountButton } from './fixtures'
import AxeBuilder from '@axe-core/playwright'
import { test, expect, signIn } from './fixtures'

test('backlinks show provenance, paginate with keyboard and refresh after source changes @mobile', async ({ app, owner, page }) => {
  const target = (await owner.post('/api/documents', { title: 'Referenced target', body: 'Stable target body.' })).body.document
  const sources = []
  for (let i = 0; i < 11; i++) sources.push((await owner.post('/api/documents', { title: `Reference source ${i}`, body: `[target](/documents/${target.id})` })).body.document)
  const both = sources[0]
  await owner.post(`/api/documents/${both.id}/relations`, { targetId: target.id, type: 'references' })
  const project = (await owner.post('/api/projects', { name: 'Topic project' })).body.project
  const topic = (await owner.post(`/client/v1/projects/${project.id}/knowledge/topics`, { name: 'Overview reading', mutationId: crypto.randomUUID() })).body.topic
  await owner.put(`/client/v1/knowledge/topics/${topic.id}/documents/${target.id}`, { expectedRevision: 1, mutationId: crypto.randomUUID() })
  let failRead = true
  await page.route(`**/documents/${target.id}/backlinks**`, async (route) => {
    if (failRead) await route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR', message: 'Backlink fixture failure' } } })
    else await route.continue()
  })
  await signIn(page, app)
  await page.goto(`${app.url}/documents/${target.id}`)
  const backlinks = page.getByRole('region', { name: 'Document backlinks', exact: true })
  await expect(backlinks.getByText('Backlinks could not be loaded', { exact: true })).toBeVisible()
  failRead = false
  await backlinks.getByRole('button', { name: 'Retry backlinks', exact: true }).click()
  await expect(backlinks.locator('li')).toHaveCount(10)
  await backlinks.getByRole('button', { name: 'More backlinks', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(backlinks.locator('li')).toHaveCount(11)
  const item = backlinks.locator('li').filter({ has: page.getByRole('link', { name: both.title, exact: true }) })
  await expect(item).toContainText('Link in content · Manual reference')
  await expect(page.getByRole('region', { name: 'Topic memberships', exact: true })).toContainText('Topic project / Overview reading')
  await owner.patch(`/api/documents/${both.id}`, { body: 'No inline link anymore.', title: 'Renamed reference source' })
  await expect(item).toHaveCount(0)
  const renamed = backlinks.locator('li').filter({ has: page.getByRole('link', { name: 'Renamed reference source', exact: true }) })
  await expect(renamed).toContainText('Manual reference')
  await expect(renamed).not.toContainText('Link in content')
  await owner.post(`/api/documents/${both.id}/archive`)
  await expect(renamed).toHaveCount(0)
  await backlinks.getByRole('button', { name: 'Include archived sources', exact: true }).click()
  await expect(backlinks.locator('li')).toHaveCount(10)
  await expect(backlinks.getByRole('button', { name: 'More backlinks', exact: true })).toBeVisible()
  await backlinks.getByRole('button', { name: 'More backlinks', exact: true }).click()
  await expect(renamed).toContainText('Archived source')
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async (t) => {
      document.documentElement.setAttribute('data-theme', t)
      await new Promise(requestAnimationFrame)
      await Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => { })))
    }, theme)
    const axe = await new AxeBuilder({ page }).include('#main').analyze()
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
  }
  await page.goto(`${app.url}/documents/${target.id}`)
  await expect(page.getByRole('heading', { name: 'Referenced target', exact: true })).toBeVisible()
})

test('document picker preserves labels and routes canonical links and fragments in the active app @mobile', async ({ app, owner, page }) => {
  const target = (await owner.post('/api/documents', { title: 'Link target', body: '# Overview\n\n## รายละเอียด\nEvidence.' })).body.document
  const source = (await owner.post('/api/documents', { title: 'Picker source', body: 'My label' })).body.document
  await signIn(page, app)
  await page.goto(`${app.url}/documents/${source.id}/edit`)
  const editor = page.getByRole('textbox', { name: 'Body', exact: true })
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.getByRole('button', { name: 'Link', exact: true }).click()
  const picker = page.getByRole('region', { name: 'Choose document link', exact: true })
  await picker.getByRole('searchbox', { name: 'Find document to link', exact: true }).fill('Link target')
  await picker.getByRole('button', { name: 'Search link targets', exact: true }).click()
  await picker.getByLabel('Document to link', { exact: true }).selectOption(target.id)
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async (t) => {
      document.documentElement.setAttribute('data-theme', t)
      await new Promise(requestAnimationFrame)
      await Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {})))
    }, theme)
    const axe = await new AxeBuilder({ page }).include('#main').analyze()
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  await picker.getByRole('button', { name: 'Insert document link', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(editor).toBeFocused()
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Picker source', exact: true })).toBeVisible()
  let saved = (await owner.get(`/api/documents/${source.id}`)).body.document
  expect(saved.body).toContain(`[My label](/documents/${target.id})`)
  saved = (await owner.patch(`/api/documents/${source.id}`, { body: saved.body + `\n\n[Thai section](/documents/${target.id}#รายละเอียด)\n\n[External](https://example.com)` })).body.document
  await owner.patch(`/api/documents/${target.id}`, { title: 'Renamed link target' })
  await expect(page.getByRole('link', { name: 'My label', exact: true })).not.toHaveAttribute('target', '_blank')
  await page.getByRole('link', { name: 'My label', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Renamed link target', exact: true })).toBeVisible()
  await page.goto(`${app.url}/documents/${source.id}`)
  await page.getByRole('link', { name: 'Thai section', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'รายละเอียด', exact: true })).toHaveAttribute('id', 'รายละเอียด')
  expect(decodeURIComponent(new URL(page.url()).hash)).toBe('#รายละเอียด')
  await page.goto(`${app.url}/documents/${source.id}`)
  await expect(page.getByRole('link', { name: 'External', exact: true })).toHaveAttribute('target', '_blank')
  expect((await owner.get(`/api/documents/${source.id}`)).body.document.body).toBe(saved.body)
})

test('link picker handles errors, empty search, insertion at a cursor and cancel with old-server fallback', async ({ app, owner, page }) => {
  const target = (await owner.post('/api/documents', { title: 'Cursor target', body: 'Source' })).body.document
  const source = (await owner.post('/api/documents', { title: 'Cursor source', body: 'Read: ' })).body.document
  let fail = true
  await page.route('**/client/v1/documents?**', async (route) => {
    if (fail) await route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR', message: 'Fixture unavailable' } } })
    else await route.continue()
  })
  await signIn(page, app)
  await page.goto(`${app.url}/documents/${source.id}/edit`)
  const editor = page.getByRole('textbox', { name: 'Body', exact: true })
  await editor.click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.getByRole('button', { name: 'Link', exact: true }).click()
  await expect(page.getByText('Link targets could not be loaded', { exact: true })).toBeVisible()
  fail = false
  await page.getByRole('button', { name: 'Retry link targets', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Find document to link', exact: true }).fill('nonmatchingtarget')
  await page.getByRole('button', { name: 'Search link targets', exact: true }).click()
  await expect(page.getByText('No matching link targets', { exact: true })).toBeVisible()
  await page.getByRole('group', { name: 'Link', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(editor).toBeFocused()
  await page.getByRole('button', { name: 'Link', exact: true }).click()
  await page.getByLabel('Link address').press('Escape')
  await expect(editor).toBeFocused()
  await page.getByRole('button', { name: 'Link', exact: true }).click()
  await page.getByLabel('Document to link', { exact: true }).selectOption(target.id)
  await page.getByRole('button', { name: 'Insert document link', exact: true }).click()
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Cursor source', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Cursor target', exact: true })).toBeVisible()
  expect((await owner.get(`/api/documents/${source.id}`)).body.document.body).toContain(`[Cursor target](/documents/${target.id})`)
  await page.route('**/client/v1/info', async (route) => {
    const response = await route.fetch(), body = await response.json()
    body.capabilities = body.capabilities.filter((c: string) => c !== 'project-knowledge')
    await route.fulfill({ response, json: body })
  })
  await page.reload()
  await page.goto(`${app.url}/documents/${source.id}/edit`)
  await page.getByRole('button', { name: 'Link', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Choose document link', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Link address')).toBeVisible()
})

test('canonical links stay in the active Desktop profile while external links use its opener', async ({ app, owner, page }) => {
  const native = await FakeNativeCore.attach(page)
  const target = (await owner.post('/api/documents', { title: 'Desktop link target', body: '# Destination' })).body.document
  const source = (await owner.post('/api/documents', { title: 'Desktop link source', body: `[Internal](/documents/${target.id}#destination)\n\n[External link](https://example.com/reference)` })).body.document
  await page.goto(app.url)
  await page.getByLabel('Profile name').fill('work')
  await page.getByLabel('Server URL').fill(app.url)
  await page.getByRole('button', { name: 'Add server' }).click()
  await page.getByRole('button', { name: 'Sign in with browser' }).click()
  await expect(page.getByLabel('Sign-in code')).toBeVisible()
  await owner.post('/client/v1/device/approve', { userCode: native.pendingUserCode })
  await expect(accountButton(page)).toBeVisible()
  await page.goto(`${app.url}/documents/${source.id}`)
  const opened = native.opened.length
  await page.getByRole('link', { name: 'Internal', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Desktop link target', exact: true })).toBeVisible()
  expect(native.active).toBe('work')
  expect(native.opened).toHaveLength(opened)
  expect(new URL(page.url()).hash).toBe('#destination')
  await page.goto(`${app.url}/documents/${source.id}`)
  await page.getByRole('link', { name: 'External link', exact: true }).click()
  await expect.poll(() => native.opened).toContain('https://example.com/reference')
})
