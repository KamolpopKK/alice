import { expect, signIn, test } from './fixtures'

test('the dashboard talks only to Client API v1 and resumes its live stream', async ({ app, owner, page }) => {
  const legacy: string[] = []
  const client: string[] = []
  page.on('request', (req) => {
    const path = new URL(req.url()).pathname
    if (path.startsWith('/api/')) legacy.push(`${req.method()} ${path}`)
    if (path.startsWith('/client/v1/')) client.push(`${req.method()} ${path}`)
  })
  await signIn(page, app)
  await page.goto(`${app.url}/tasks/new`)
  await page.getByLabel('Title').fill('Transport check')
  await page.getByRole('button', { name: 'Create task' }).click()
  await expect(page.getByRole('heading', { name: 'Transport check' })).toBeVisible()
  await page.getByLabel('Status').selectOption('ready')
  await expect(page.getByText('changed status from Backlog to Ready')).toBeVisible()

  // การแก้จากที่อื่นมาถึงผ่าน /client/v1/events
  const taskId = new URL(page.url()).pathname.split('/').pop()!
  await owner.patch(`/client/v1/tasks/${taskId}`, { title: 'Transport check (renamed elsewhere)' })
  await expect(page.getByRole('heading', { name: 'Transport check (renamed elsewhere)' })).toBeVisible()

  expect(legacy).toEqual([])
  expect(client).toContain('GET /client/v1/events')
  expect(client).toContain('POST /client/v1/tasks')
})
