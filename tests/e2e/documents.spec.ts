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
  const createForm = page.getByRole('form', { name: 'New document' })
  await createForm.getByLabel('Document title').fill('Launch checklist')
  await createForm.getByLabel('Body (Markdown)').fill('- [ ] DNS\n- [ ] Backups')
  await createForm.getByRole('textbox', { name: 'Tags' }).fill('launch, operations')
  await createForm.getByRole('textbox', { name: 'Search keywords' }).fill('release checklist, go-live')
  await createForm.getByLabel('Knowledge status').selectOption('draft')
  await createForm.getByLabel('Knowledge owner').selectOption({ label: 'Doc Writer' })
  await createForm.getByRole('button', { name: 'Create document' }).click()
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

test('document relationships require supersedes confirmation and remain navigable', async ({ app, owner, page }) => {
  const suffix = Date.now().toString(36)
  const source = (await owner.post('/api/documents', { title: `New guide ${suffix}`, body: 'Use this version' })).body.document
  const referenced = (await owner.post('/api/documents', { title: `Reference ${suffix}`, body: 'Reference material' })).body.document
  const related = (await owner.post('/api/documents', { title: `Related ${suffix}`, body: 'Related material' })).body.document
  const old = (await owner.post('/api/documents', { title: `Old guide ${suffix}`, body: 'Old version' })).body.document
  await owner.post(`/api/documents/${old.id}/review`, { expectedRevision: 1, markCurrent: true })
  await signIn(page, app)
  await page.goto(`${app.url}/documents/${source.id}`)

  const add = async (title: string, type: 'references' | 'related') => {
    await page.getByRole('button', { name: 'Add relationship' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add document relationship' })
    await dialog.getByLabel('Find a document').fill(title)
    await dialog.getByLabel('Target document').selectOption({ label: `${title} — Unreviewed` })
    await dialog.getByLabel('Relationship type').selectOption(type)
    await dialog.getByRole('button', { name: 'Add relationship' }).click()
    const outgoing = page.getByRole('heading', { name: 'From this document' }).locator('..')
    await expect(outgoing.getByRole('link', { name: title })).toBeVisible()
  }
  await add(referenced.title, 'references')
  await add(related.title, 'related')

  await page.getByRole('button', { name: 'Add relationship' }).focus()
  await page.keyboard.press('Enter')
  const relationDialog = page.getByRole('dialog', { name: 'Add document relationship' })
  await relationDialog.getByLabel('Find a document').fill(old.title)
  await relationDialog.getByLabel('Target document').selectOption({ label: `${old.title} — Current` })
  await relationDialog.getByLabel('Relationship type').selectOption('supersedes')
  await relationDialog.getByRole('button', { name: 'Add relationship' }).click()
  const confirmation = page.getByRole('dialog', { name: 'Confirm supersedes relationship' })
  await expect(confirmation).toContainText(`“${source.title}” will supersede “${old.title}”`)
  await expect(confirmation).toContainText('marked Superseded')
  await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Enter')
  expect((await owner.get(`/api/documents/${source.id}/relations?direction=outgoing`)).body.items).toHaveLength(2)

  await relationDialog.getByRole('button', { name: 'Add relationship' }).focus()
  await page.keyboard.press('Enter')
  await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(confirmation.getByRole('button', { name: 'Confirm and mark superseded' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('link', { name: old.title })).toBeVisible()
  expect((await owner.get(`/api/documents/${old.id}`)).body.document.status).toBe('superseded')

  await page.getByRole('link', { name: old.title }).click()
  const incoming = page.getByRole('heading', { name: 'To this document' }).locator('..')
  await expect(incoming.getByRole('link', { name: source.title })).toBeVisible()
  await page.goBack()
  await page.getByRole('button', { name: `Remove references relationship with ${referenced.title}` }).click()
  await page.getByRole('button', { name: `Remove related relationship with ${related.title}` }).click()
  await page.getByRole('button', { name: `Remove supersedes relationship with ${old.title}` }).click()
  await expect(page.getByText('No outgoing relationships.')).toBeVisible()
})
