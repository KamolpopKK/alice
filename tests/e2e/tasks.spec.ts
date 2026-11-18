import { expect, signIn, test } from './fixtures'

test('member creates a task, edits fields and sees attributed activity @mobile', async ({ app, owner, page }) => {
  await owner.post('/api/projects', { name: 'Mobile app' })
  await signIn(page, app)
  await page.goto(`${app.url}/tasks/new`)
  await page.getByLabel('Title').fill('Design onboarding')
  await page.getByLabel('Description (Markdown)').fill('Three screens, **max**.')
  await page.getByLabel('Project').selectOption({ label: 'Mobile app' })
  await page.getByLabel('Priority').selectOption('high')
  await page.getByRole('button', { name: 'Create task' }).click()

  await expect(page.getByRole('heading', { name: 'Design onboarding' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Mobile app' })).toBeVisible()

  await page.getByLabel('Status').selectOption('in_progress')
  await expect(page.getByText('changed status from Backlog to In progress')).toBeVisible()

  await page.getByRole('button', { name: 'Edit' }).click()
  await page.getByLabel('Title').fill('Design onboarding flow')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: 'Design onboarding flow' })).toBeVisible()

  await page.getByLabel('Status').selectOption('done')
  await expect(page.getByText('Completed', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Archive' }).click()
  await expect(page.getByText('This task is archived')).toBeVisible()
  await expect(page.getByLabel('Status')).toBeDisabled()
  await page.getByRole('button', { name: 'Restore' }).click()
  await expect(page.getByLabel('Status')).toBeEnabled()
})

test('humans comment, see agent completion summaries live, and complete without a summary', async ({ app, owner, page }) => {
  const { createAgent } = await import('../helpers/client')
  const { connectMcp } = await import('../helpers/mcp')
  const agent = await createAgent(owner, 'Summary Bot')
  const task = (await owner.post('/api/tasks', { title: 'Translate FAQ', status: 'ready' })).body.task
  await signIn(page, app)
  await page.goto(`${app.url}/tasks/${task.id}`)
  await page.getByLabel('Add a comment').fill('Please keep it under **200 words**.')
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(page.locator('.comment strong', { hasText: '200 words' })).toBeVisible()

  const mcp = await connectMcp(app.url, agent.token)
  await mcp.ok('claim_task', { id: task.id })
  await mcp.ok('complete_task', { id: task.id, summary: 'Translated to Thai and English.' })
  await mcp.close()
  await expect(page.getByText('completion summary')).toBeVisible()
  await expect(page.getByText('Translated to Thai and English.')).toBeVisible()
  await expect(page.getByLabel('Status')).toHaveValue('done')

  const other = (await owner.post('/api/tasks', { title: 'Quick manual fix' })).body.task
  await page.goto(`${app.url}/tasks/${other.id}`)
  await page.getByRole('button', { name: 'Complete task…' }).click()
  await page.getByRole('button', { name: 'Mark done' }).click()
  await expect(page.getByLabel('Status')).toHaveValue('done')
  await expect(page.getByText('No comments yet.')).toBeVisible()
})

test('decompose work and add blockers from task detail', async ({ app, owner, page }) => {
  const epic = (await owner.post('/api/tasks', { title: 'Payments epic' })).body.task
  await owner.post('/api/tasks', { title: 'Choose payment provider' })
  await signIn(page, app)
  await page.goto(`${app.url}/tasks/${epic.id}`)
  await page.getByRole('link', { name: 'Add subtask' }).click()
  await page.getByLabel('Title').fill('Card checkout')
  await page.getByRole('button', { name: 'Create task' }).click()
  await expect(page.getByRole('heading', { name: 'Card checkout' })).toBeVisible()
  const rel = page.getByRole('region', { name: 'Relationships' })
  await expect(rel.getByRole('link', { name: 'Payments epic' })).toBeVisible()

  await rel.getByRole('button', { name: 'Add blocker' }).click()
  await rel.getByLabel('Blocking task').fill('provider')
  await rel.getByRole('button', { name: 'Choose Choose payment provider' }).click()
  await expect(rel.getByRole('link', { name: 'Choose payment provider' })).toBeVisible()

  // cycle: ให้ epic เป็นลูกของ subtask ตัวเอง → ต้องเห็น error
  await page.getByRole('link', { name: 'Payments epic' }).click()
  await page.getByRole('region', { name: 'Relationships' }).getByRole('button', { name: 'Set parent' }).click()
  await page.getByLabel('Parent task').fill('checkout')
  await page.getByRole('button', { name: 'Choose Card checkout' }).click()
  await expect(page.getByRole('alert')).toContainText('cycle')
  // แถวแสดงสถานะ blocked; จำนวน subtask อยู่ใน Task Detail
  await page.goto(`${app.url}/list`)
  await expect(page.getByText('Blocked by 1')).toBeVisible()
})
