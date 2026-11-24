import AxeBuilder from '@axe-core/playwright'
import { createAgent } from '../helpers/client'
import { connectMcp } from '../helpers/mcp'
import { test, expect, signIn } from './fixtures'

test('curate topic descriptions with keyboard, archive and live remote updates @mobile', async ({ app, owner, page }) => {
  const project = (await owner.post('/api/projects', { name: 'Knowledge UI' })).body.project
  await signIn(page, app)
  await page.goto(`${app.url}/projects/${project.id}?tab=knowledge`)
  await expect(page.getByText('No knowledge topics yet', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Topic name', exact: true }).fill('Accounts')
  await page.getByRole('textbox', { name: 'Topic description', exact: true }).fill('Start with the account overview.')
  await page.getByRole('button', { name: 'Create topic', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit topic Accounts', exact: true }).click()
  await page.getByRole('textbox', { name: 'Topic name', exact: true }).fill('Accounts revised')
  await page.getByRole('button', { name: 'Cancel editing' }).click()
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible()
  const topic = (await owner.get(`/client/v1/projects/${project.id}/knowledge/topics`)).body.items[0]
  const mcp = await connectMcp(app.url, (await createAgent(owner, 'Topic editor')).token)
  try {
    await mcp.ok('update_knowledge_topic', { id: topic.id, description: 'Updated through MCP.', expectedRevision: topic.revision, mutationId: crypto.randomUUID() })
    await expect(page.getByText('Updated through MCP.', { exact: true })).toBeVisible()
  } finally { await mcp.close() }
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async (t) => {
      document.documentElement.setAttribute('data-theme', t)
      await new Promise(requestAnimationFrame)
      await Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => { })))
    }, theme)
    const axe = await new AxeBuilder({ page }).include('#main').analyze()
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
  }
  await page.getByRole('button', { name: 'Archive topic Accounts', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeHidden()
  await page.getByRole('button', { name: 'Show archived topics' }).click()
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Restore topic Accounts', exact: true }).click()
  await page.getByRole('button', { name: 'Show active topics' }).click()
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible()
})

test('knowledge entry is hidden on a server without the capability', async ({ app, owner, page }) => {
  const project = (await owner.post('/api/projects', { name: 'Older server' })).body.project
  await page.route('**/client/v1/info', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    body.capabilities = body.capabilities.filter((c: string) => c !== 'project-knowledge')
    await route.fulfill({ response, json: body })
  })
  await signIn(page, app)
  await page.goto(`${app.url}/projects/${project.id}`)
  await expect(page.getByRole('tab', { name: 'Documents', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Knowledge', exact: true })).toHaveCount(0)
})

test('topic failures can be retried without reporting an unconfirmed save', async ({ app, owner, page }) => {
  const project = (await owner.post('/api/projects', { name: 'Retry topics' })).body.project
  let failRead = true
  let failSave = true
  await page.route(`**/projects/${project.id}/knowledge/topics**`, async (route) => {
    if ((route.request().method() === 'GET' && failRead) || (route.request().method() === 'POST' && failSave)) {
      await route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR', message: 'Fixture unavailable' } } })
    } else await route.continue()
  })
  await signIn(page, app)
  await page.goto(`${app.url}/projects/${project.id}?tab=knowledge`)
  await expect(page.getByText('Topics could not be loaded', { exact: true })).toBeVisible()
  failRead = false
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByText('No knowledge topics yet', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Topic name', exact: true }).fill('Retried topic')
  await page.getByRole('button', { name: 'Create topic', exact: true }).click()
  await expect(page.getByText('Topic change was not confirmed', { exact: true })).toBeVisible()
  expect((await owner.get(`/client/v1/projects/${project.id}/knowledge/topics`)).body.items).toEqual([])
  failSave = false
  await page.getByRole('button', { name: 'Create topic', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Retried topic', exact: true })).toBeVisible()
  expect((await owner.get(`/client/v1/projects/${project.id}/knowledge/topics`)).body.items).toHaveLength(1)
})

test('reading lists share existing documents, support keyboard order and recover errors @mobile', async ({ app, owner, page }) => {
  const project = (await owner.post('/api/projects', { name: 'Curated reading UI' })).body.project
  const source = (await owner.post('/api/projects', { name: 'Source project' })).body.project
  const docs = []
  for (const title of ['Overview', 'Detailed design']) {
    const d = (await owner.post('/api/documents', { title, body: 'Shared source.' })).body.document
    await owner.post(`/api/documents/${d.id}/links`, { projectId: source.id })
    docs.push(d)
  }
  const topic = (await owner.post(`/client/v1/projects/${project.id}/knowledge/topics`, { name: 'Reading', description: 'Read the overview first.', mutationId: crypto.randomUUID() })).body.topic
  let failRead = true
  let failSave = true
  await page.route(`**/knowledge/topics/${topic.id}/documents**`, async (route) => {
    if ((route.request().method() === 'GET' && failRead) || (route.request().method() === 'PUT' && failSave)) await route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR', message: 'Fixture unavailable' } } })
    else await route.continue()
  })
  await signIn(page, app)
  await page.goto(`${app.url}/projects/${project.id}?tab=knowledge`)
  await page.getByRole('button', { name: 'Show reading list for Reading', exact: true }).click()
  const list = page.getByRole('region', { name: 'Reading list Reading', exact: true })
  await expect(list.getByText('Reading list could not be loaded', { exact: true })).toBeVisible()
  failRead = false
  await list.getByRole('button', { name: 'Reload reading list', exact: true }).click()
  await expect(list.getByText('No reading documents yet', { exact: true })).toBeVisible()
  await list.getByLabel('Existing document', { exact: true }).selectOption(docs[0].id)
  await list.getByRole('button', { name: 'Add document to topic', exact: true }).click()
  await expect(list.getByText('Reading list change was not confirmed', { exact: true })).toBeVisible()
  failSave = false
  await list.getByRole('button', { name: 'Add document to topic', exact: true }).click()
  await expect(list.getByRole('link', { name: 'Overview', exact: true })).toBeVisible()
  await list.getByRole('textbox', { name: 'Find existing document', exact: true }).fill('Detailed')
  await list.getByRole('button', { name: 'Search documents', exact: true }).click()
  await list.getByLabel('Existing document', { exact: true }).selectOption(docs[1].id)
  await list.getByRole('button', { name: 'Add document to topic', exact: true }).click()
  await expect(list.getByRole('link', { name: 'Detailed design', exact: true })).toBeVisible()
  await list.getByRole('button', { name: 'Move Detailed design up', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(list.locator('ol > li').first()).toContainText('Detailed design')
  await expect(list.locator('ol > li').first()).toContainText('Linked projects: Source project')
  await list.getByRole('button', { name: 'Remove Overview from topic', exact: true }).click()
  await expect(list.getByRole('link', { name: 'Overview', exact: true })).toHaveCount(0)
  expect((await owner.get(`/api/documents/${docs[0].id}`)).body.document).toMatchObject({ body: 'Shared source.', archivedAt: null, status: 'unreviewed', links: { projects: [{ id: source.id }] } })
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async (t) => {
      document.documentElement.setAttribute('data-theme', t)
      await new Promise(requestAnimationFrame)
      await Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => { })))
    }, theme)
    const axe = await new AxeBuilder({ page }).include('#main').analyze()
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
  }
  await owner.post(`/api/documents/${docs[1].id}/archive`)
  await expect(list.getByText(/Archived document/)).toBeVisible()
  const current = (await owner.get(`/client/v1/knowledge/topics/${topic.id}`)).body.topic
  await owner.post(`/client/v1/knowledge/topics/${topic.id}/archive`, { expectedRevision: current.revision, mutationId: crypto.randomUUID() })
  await page.getByRole('button', { name: 'Show archived topics', exact: true }).click()
  await page.getByRole('button', { name: 'Show reading list for Reading', exact: true }).click()
  await expect(list.getByRole('link', { name: 'Detailed design', exact: true })).toBeVisible()
  await expect(list.getByRole('button', { name: 'Add document to topic', exact: true })).toHaveCount(0)
})
