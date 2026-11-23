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
  if (await backlinks.getByRole('button', { name: 'More backlinks', exact: true }).count()) await backlinks.getByRole('button', { name: 'More backlinks', exact: true }).click()
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
