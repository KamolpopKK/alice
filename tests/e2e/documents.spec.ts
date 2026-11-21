import AxeBuilder from '@axe-core/playwright'
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
  await page.getByRole('textbox', { name: 'Tags' }).fill('launch, operations')
  await page.getByRole('textbox', { name: 'Search keywords' }).fill('release checklist, go-live')
  await page.getByLabel('Knowledge status').selectOption('draft')
  await page.getByLabel('Knowledge owner').selectOption({ label: 'Doc Writer' })
  await page.getByRole('button', { name: 'Create document' }).click()
  await expect(page.getByRole('heading', { name: 'Launch checklist' })).toBeVisible()
  await expect(page.getByText('Revision 1')).toBeVisible()
  await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Doc Writer').first()).toBeVisible()
  await expect(page.getByText('Search keywords: go-live, release checklist')).toBeVisible()
  const docId = page.url().split('/').pop()!

  // agent แก้และลิงก์เอกสารผ่าน MCP ขณะหน้าเปิดอยู่ — หน้าเว็บต้องอัปเดตเองผ่าน SSE
  const mcp = await connectMcp(app.url, agent.token)
  await mcp.ok('update_document', { id: docId, body: '- [x] DNS\n- [ ] Backups\n- [ ] Status page' })
  await mcp.ok('link_document', { id: docId, taskId: task.id })
  await expect(page.getByText('Status page')).toBeVisible()
  await expect(page.getByText('Revision 2')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Prepare launch checklist' })).toBeVisible()

  // review ใช้ revision ที่มองเห็น: แทรกการแก้จาก agent ก่อน request ถึง server เพื่อพิสูจน์ conflict recovery
  let injected = false
  await page.route('**/client/v1/documents/*/review', async (route) => {
    if (!injected && route.request().method() === 'POST') {
      injected = true
      await mcp.ok('update_document', { id: docId, body: '- [x] DNS\n- [ ] Backups\n- [ ] Status page\n- [ ] Conflict injected' })
    }
    await route.continue()
  })
  await page.getByRole('button', { name: 'Review and mark current' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText(/changed before the review was saved/i)).toBeVisible()
  await expect(page.getByText('Revision 3')).toBeVisible()
  await page.unroute('**/client/v1/documents/*/review')
  await page.getByRole('button', { name: 'Review and mark current' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Current', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/Revision 3, .* by/)).toBeVisible()
  await page.getByRole('button', { name: 'Clear review' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert').filter({ hasText: 'This document is unreviewed' })).toBeVisible()

  await page.getByRole('button', { name: 'Edit' }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('textbox', { name: 'Tags' }).fill('launch, production')
  await page.getByRole('textbox', { name: 'Search keywords' }).fill('release checklist, deployment')
  await page.getByLabel('Knowledge status').selectOption('draft')
  await page.getByRole('button', { name: 'Save changes' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Revision 3')).toBeVisible()
  await expect(page.getByText('production', { exact: true })).toBeVisible()

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).include('#main').analyze()
  expect(axe.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([])
  await mcp.close()

  await page.getByRole('button', { name: 'History' }).click()
  await page.getByRole('button', { name: 'Restore revision 1' }).click()
  await expect(page.getByText('Revision 4')).toBeVisible()
  await expect(page.getByText('Status page')).toHaveCount(0)

  // ลิงก์โผล่ในหน้า task ด้วย
  await page.getByRole('link', { name: 'Prepare launch checklist' }).click()
  await expect(page.getByRole('region', { name: 'Documents' }).getByRole('link', { name: 'Launch checklist' })).toBeVisible()
  await page.getByRole('button', { name: 'Unlink Launch checklist' }).click()
  await expect(page.getByText('No linked documents.')).toBeVisible()
})
