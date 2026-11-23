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
      await Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {})))
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
