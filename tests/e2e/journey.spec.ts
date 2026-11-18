import { createAgent } from '../helpers/client'
import { connectMcp } from '../helpers/mcp'
import { expect, signIn, test } from './fixtures'

test('human and agent operate on one authoritative board @mobile', async ({ app, owner, page }) => {
  const agent = await createAgent(owner, 'Journey Agent')
  await signIn(page, app)

  // human: project + task + document in the browser
  await page.goto(`${app.url}/projects`)
  await page.getByRole('button', { name: 'New project' }).click()
  await page.getByLabel('Project name').fill('Customer portal')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.getByRole('link', { name: 'New task', exact: true }).click()
  await page.getByLabel('Title').fill('Add password reset')
  await page.getByLabel('Status').selectOption('ready')
  await page.getByRole('button', { name: 'Create task' }).click()
  await expect(page.getByRole('heading', { name: 'Add password reset' })).toBeVisible()
  const taskId = page.url().split('/').pop()!
  const docs = page.getByRole('region', { name: 'Documents' })
  await docs.getByRole('button', { name: 'New document' }).click()
  await page.getByLabel('Document title').fill('Reset flow spec')
  await page.getByLabel('Body (Markdown)').fill('Email a one-time link valid for 30 minutes.')
  await page.getByRole('button', { name: 'Create document' }).click()
  await expect(docs.getByRole('link', { name: 'Reset flow spec' })).toBeVisible()

  // agent: claim → context → comment → edit doc → complete (หน้าเว็บเปิดค้างไว้ตลอด)
  const mcp = await connectMcp(app.url, agent.token)
  const ready = await mcp.ok('list_tasks', { status: ['ready'], assigneeId: ['none'] })
  expect(ready.items.map((t: any) => t.id)).toContain(taskId)
  await mcp.ok('claim_task', { id: taskId })
  await expect(page.getByLabel('Status')).toHaveValue('in_progress')
  await expect(page.getByLabel('Assignee')).toHaveValue(agent.id)

  const context = await mcp.ok('get_task_context', { id: taskId })
  expect(context.project.name).toBe('Customer portal')
  const docId = context.documents.items[0].id
  expect(context.documents.items[0].body).toContain('30 minutes')

  await mcp.ok('add_comment', { taskId, body: 'Starting with the email template.' })
  await expect(page.getByText('Starting with the email template.')).toBeVisible()

  await mcp.ok('update_document', { id: docId, body: 'Email a one-time link valid for 15 minutes.' })
  await mcp.ok('complete_task', { id: taskId, summary: 'Reset flow shipped; link lifetime reduced to 15 minutes.' })
  await mcp.close()

  await expect(page.getByLabel('Status')).toHaveValue('done')
  await expect(page.getByText('Reset flow shipped; link lifetime reduced to 15 minutes.')).toBeVisible()
  const activity = page.getByRole('region', { name: 'Activity' })
  await expect(activity.getByText('Journey Agent').first()).toBeVisible()
  await expect(activity.getByText(/claimed the task/)).toBeVisible()
  await expect(activity.getByText(/completed the task/)).toBeVisible()

  // document reflects the agent edit with attribution
  await docs.getByRole('link', { name: 'Reset flow spec' }).click()
  await expect(page.getByText('15 minutes')).toBeVisible()
  await expect(page.getByText(/Revision 2 · updated/)).toContainText('Journey Agent')

  // the board shows the finished card with the agent assignee
  await page.goto(`${app.url}/tasks?view=board`)
  const doneColumn = page.getByRole('region', { name: 'Done' })
  await expect(doneColumn.getByRole('link', { name: 'Add password reset' })).toBeVisible()
  await expect(doneColumn.getByText('Journey Agent')).toBeVisible()
})
