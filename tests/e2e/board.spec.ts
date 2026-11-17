import { agentClient, createAgent } from '../helpers/client'
import { expect, signIn, test } from './fixtures'

test('board shows work by status and updates live after an agent mutation', async ({ app, owner, page }) => {
  const agent = await createAgent(owner, 'Live Agent')
  const project = (await owner.post('/api/projects', { name: 'Realtime' })).body.project
  const task = (await owner.post('/api/tasks', { title: 'Wire up websockets', projectId: project.id, status: 'ready' })).body.task

  await signIn(page, app)
  const ready = page.getByRole('region', { name: 'Ready' })
  await expect(ready.getByRole('link', { name: 'Wire up websockets' })).toBeVisible()
  await expect(page.locator('.live-live')).toBeAttached()

  // agent เปลี่ยนสถานะผ่าน API — หน้าบอร์ดที่เปิดอยู่ต้องย้ายการ์ดเองโดยไม่ reload
  await agentClient(app, agent).patch(`/api/tasks/${task.id}`, { status: 'in_progress', assigneeId: agent.id })
  const inProgress = page.getByRole('region', { name: 'In progress' })
  await expect(inProgress.getByRole('link', { name: 'Wire up websockets' })).toBeVisible()
  await expect(inProgress.getByText('Live Agent')).toBeVisible()
  await expect(ready.getByRole('link', { name: 'Wire up websockets' })).toHaveCount(0)

  // เปลี่ยนสถานะจากการ์ดด้วย keyboard-accessible select
  await inProgress.getByLabel('Status of Wire up websockets').selectOption('blocked')
  await expect(page.getByRole('region', { name: 'Blocked' }).getByRole('link', { name: 'Wire up websockets' })).toBeVisible()
})

test('list filters, my tasks, search and activity views', async ({ app, owner, page }) => {
  const me = (await owner.get('/api/auth/me')).body.actor
  await owner.post('/api/tasks', { title: 'Filterable alpha', priority: 'urgent', assigneeId: me.id, labels: ['ops'] })
  await owner.post('/api/tasks', { title: 'Filterable beta', priority: 'low' })
  await signIn(page, app)

  await page.getByRole('link', { name: 'List' }).click()
  await page.getByLabel('Priority').selectOption('urgent')
  await expect(page.getByRole('link', { name: 'Filterable alpha' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Filterable beta' })).toHaveCount(0)
  await expect(page).toHaveURL(/priority=urgent/)

  await page.getByRole('link', { name: 'My tasks' }).click()
  await expect(page.getByRole('link', { name: 'Filterable alpha' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Filterable beta' })).toHaveCount(0)

  await page.getByRole('link', { name: 'Search' }).click()
  await page.getByLabel('Search tasks, documents and comments').fill('filterable beta')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.locator('.results').getByRole('link', { name: 'Filterable beta' })).toBeVisible()
  await expect(page.locator('mark').first()).toBeVisible()

  await page.getByRole('link', { name: 'Activity' }).click()
  await expect(page.getByText('created task “Filterable beta”')).toBeVisible()
})

test('mobile: inspect a task and change its status @mobile', async ({ app, owner, page }) => {
  const task = (await owner.post('/api/tasks', { title: 'Phone-sized work', status: 'ready' })).body.task
  await signIn(page, app)
  await page.getByRole('link', { name: 'Phone-sized work' }).click()
  await expect(page.getByRole('heading', { name: 'Phone-sized work' })).toBeVisible()
  await page.getByLabel('Status').selectOption('done')
  await expect(page.getByText('changed status from Ready to Done')).toBeVisible()
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
  expect((await owner.get(`/api/tasks/${task.id}`)).body.task.status).toBe('done')
})

test('keyboard-only: create a task and change status without a pointer', async ({ app, owner: _owner, page }) => {
  await signIn(page, app)
  await page.goto(`${app.url}/tasks/new`)
  await expect(page.getByLabel('Title')).toBeFocused()
  await page.keyboard.type('Keyboard task')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Keyboard task' })).toBeVisible()
  const status = page.getByLabel('Status')
  await status.focus()
  // type-ahead ของ native select ใช้ได้ทุก platform (ลูกศรบน macOS จะเปิด popup แทน)
  await page.keyboard.press('r') // Backlog -> Ready
  await expect(page.getByText('changed status from Backlog to Ready')).toBeVisible()
})
