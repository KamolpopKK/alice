import AxeBuilder from '@axe-core/playwright'
import { test, expect, signIn } from './fixtures'

test('knowledge search finds cross-project sources, filters, paginates and explains lexical matches @mobile', async ({ app, owner, page }) => {
  const project = (await owner.post('/api/projects', { name: 'Knowledge search UI' })).body.project
  const source = (await owner.post('/api/projects', { name: 'Source team' })).body.project
  const curated = (await owner.post('/api/documents', { title: 'Shared account guide', body: 'Account configuration.', searchKeywords: ['credential rotation'] })).body.document
  await owner.post(`/api/documents/${curated.id}/links`, { projectId: source.id })
  const topic = (await owner.post(`/client/v1/projects/${project.id}/knowledge/topics`, { name: 'Accounts', description: 'Start with the guide.', mutationId: crypto.randomUUID() })).body.topic
  await owner.put(`/client/v1/knowledge/topics/${topic.id}/documents/${curated.id}`, { expectedRevision: 1, mutationId: crypto.randomUUID() })
  for (let i = 0; i < 21; i++) {
    const d = (await owner.post('/api/documents', { title: `Linked reference ${i}`, body: 'Project source.' })).body.document
    await owner.post(`/api/documents/${d.id}/links`, { projectId: project.id })
  }
  let failRead = true
  await page.route('**/client/v1/documents?**', async (route) => {
    if (new URL(route.request().url()).searchParams.has('knowledgeProjectId') && failRead) await route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR', message: 'Search fixture unavailable' } } })
    else await route.continue()
  })
  await signIn(page, app)
  await page.goto(`${app.url}/projects/${project.id}?tab=knowledge`)
  const search = page.getByRole('region', { name: 'Search project knowledge', exact: true })
  await expect(search.getByText('Knowledge search could not be loaded', { exact: true })).toBeVisible()
  failRead = false
  await search.getByRole('button', { name: 'Retry knowledge search', exact: true }).click()
  await expect(search.locator('ul > li')).toHaveCount(20)
  await search.getByRole('button', { name: 'More knowledge results', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(search.locator('ul > li')).toHaveCount(22)
  await search.getByRole('searchbox', { name: 'Search project knowledge', exact: true }).fill('credential')
  await search.getByRole('button', { name: 'Find knowledge', exact: true }).click()
  await expect(search.locator('ul > li')).toHaveCount(1)
  await expect(search).toContainText('Matched keyword: credential rotation')
  await expect(search).toContainText('Linked projects: Source team')
  await expect(search).toContainText('Topics: Accounts')
  await search.getByLabel('Knowledge topic', { exact: true }).selectOption(topic.id)
  await search.getByRole('checkbox', { name: 'Curated documents only', exact: true }).check()
  await expect(search.getByRole('link', { name: 'Shared account guide', exact: true })).toBeVisible()
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async (t) => {
      document.documentElement.setAttribute('data-theme', t)
      await new Promise(requestAnimationFrame)
      await Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => { })))
    }, theme)
    const axe = await new AxeBuilder({ page }).include('#main').analyze()
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
  }
  await search.getByRole('searchbox', { name: 'Search project knowledge', exact: true }).fill('notmatchinganything')
  await search.getByRole('button', { name: 'Find knowledge', exact: true }).click()
  await expect(search.getByText('No matching documents in this scope', { exact: true })).toBeVisible()
  await expect(search).toContainText('Relevant knowledge may use different wording.')
  await search.getByRole('link', { name: 'Browse all Documents', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible()
})
