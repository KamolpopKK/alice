import { createAgent } from '../helpers/client'
import { connectMcp } from '../helpers/mcp'
import { expect, goTo, signIn, test } from './fixtures'

test('document created in the browser, edited and linked by an agent, restored in the browser @mobile', async ({ app, owner, page }) => {
  const agent = await createAgent(owner, 'Doc Writer')
  const task = (await owner.post('/api/tasks', { title: 'Prepare launch checklist' })).body.task
  await signIn(page, app)

  await goTo(page, 'Documents')
  await page.getByRole('button', { name: 'New document' }).click()
  await page.getByLabel('Document title').fill('Launch checklist')
  await page.getByLabel('Body (Markdown)').fill('- [ ] DNS\n- [ ] Backups')
  await page.getByRole('button', { name: 'Create document' }).click()
  await expect(page.getByRole('heading', { name: 'Launch checklist' })).toBeVisible()
  await expect(page.getByText('Revision 1')).toBeVisible()
  const docId = page.url().split('/').pop()!

  // agent แก้และลิงก์เอกสารผ่าน MCP ขณะหน้าเปิดอยู่ — หน้าเว็บต้องอัปเดตเองผ่าน SSE
  const mcp = await connectMcp(app.url, agent.token)
  await mcp.ok('update_document', { id: docId, body: '- [x] DNS\n- [ ] Backups\n- [ ] Status page' })
  await mcp.ok('link_document', { id: docId, taskId: task.id })
  await mcp.close()
  await expect(page.getByText('Status page')).toBeVisible()
  await expect(page.getByText('Revision 2')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Prepare launch checklist' })).toBeVisible()

  await page.getByRole('button', { name: 'History' }).click()
  await page.getByRole('button', { name: 'Restore revision 1' }).click()
  await expect(page.getByText('Revision 3')).toBeVisible()
  await expect(page.getByText('Status page')).toHaveCount(0)

  // ลิงก์โผล่ในหน้า task ด้วย
  await page.getByRole('link', { name: 'Prepare launch checklist' }).click()
  await expect(page.getByRole('region', { name: 'Documents' }).getByRole('link', { name: 'Launch checklist' })).toBeVisible()
  await page.getByRole('button', { name: 'Unlink Launch checklist' }).click()
  await expect(page.getByText('No linked documents.')).toBeVisible()
})
