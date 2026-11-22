import type { Page } from '@playwright/test'
import { createAgent } from '../helpers/client'
import { connectMcp } from '../helpers/mcp'
import { expect, signIn, test } from './fixtures'

/** A newer server revision during editing: adopt when clean, warn and ask when there is a draft. */
const V1 = '/client/v1'
const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
const source = (page: Page) => page.getByLabel('Body', { exact: true })

async function openEdit(page: Page, url: string, id: string) {
  await page.goto(`${url}/documents/${id}/edit`)
  await page.getByRole('radio', { name: 'Markdown' }).click()
}

test('an untouched editor takes the newer version an agent saves', async ({ app, owner, page }) => {
  const agent = await createAgent(owner, `Reviser ${stamp()}`)
  const mcp = await connectMcp(app.url, agent.token)
  const doc = (await owner.post(`${V1}/documents`, { title: `Clean ${stamp()}`, body: 'First\n' })).body.document
  await signIn(page, app)
  await openEdit(page, app.url, doc.id)
  await expect(source(page)).toHaveValue('First\n')
  await mcp.ok('update_document', { id: doc.id, body: 'Agent version\n' })
  await page.getByRole('radio', { name: 'Markdown' }).click()
  await expect(source(page)).toHaveValue('Agent version\n')
  await expect(page.getByText('This document changed while you were editing')).toHaveCount(0)
  await mcp.close()
})

test('a draft is kept when an agent saves meanwhile, and Save asks before replacing their version', async ({ app, owner, page }) => {
  const agent = await createAgent(owner, `Agent ${stamp()}`)
  const mcp = await connectMcp(app.url, agent.token)
  const doc = (await owner.post(`${V1}/documents`, { title: `Busy ${stamp()}`, body: 'Original body\n', tags: ['keep'] })).body.document
  await signIn(page, app)
  await openEdit(page, app.url, doc.id)
  await page.getByLabel('Document title').fill('My new title')

  await mcp.ok('update_document', { id: doc.id, body: 'Agent body\n', tags: ['agent-tag'] })
  await expect(page.getByText('This document changed while you were editing')).toBeVisible()
  await expect(page.getByLabel('Document title')).toHaveValue('My new title')
  await expect(source(page)).toHaveValue('Original body\n')

  await page.getByRole('button', { name: 'Save changes' }).click()
  const dialog = page.getByRole('dialog', { name: 'Someone saved a newer version' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Keep editing' }).click()
  expect((await owner.get(`${V1}/documents/${doc.id}`)).body.document.title).toBe(doc.title)

  await page.getByRole('button', { name: 'Save changes' }).click()
  await dialog.getByRole('button', { name: 'Save mine over theirs' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'My new title' })).toBeVisible()
  // ส่งเฉพาะชื่อที่แก้: เนื้อหาและ tag ของ agent ไม่ถูกเขียนทับด้วยค่าเก่า
  const saved = (await owner.get(`${V1}/documents/${doc.id}`)).body.document
  expect(saved).toMatchObject({ title: 'My new title', body: 'Agent body\n', tags: ['agent-tag'] })
  await mcp.close()
})

test('Load latest confirms before discarding the draft', async ({ app, owner, page }) => {
  const agent = await createAgent(owner, `Writer ${stamp()}`)
  const mcp = await connectMcp(app.url, agent.token)
  const doc = (await owner.post(`${V1}/documents`, { title: `Latest ${stamp()}`, body: 'Old\n' })).body.document
  await signIn(page, app)
  await openEdit(page, app.url, doc.id)
  await source(page).fill('My draft\n')
  await mcp.ok('update_document', { id: doc.id, body: 'Newest\n' })
  await page.getByRole('button', { name: 'Load latest' }).click()
  const confirm = page.getByRole('dialog', { name: 'Load the latest version?' })
  await confirm.getByRole('button', { name: 'Keep editing' }).click()
  await expect(source(page)).toHaveValue('My draft\n')
  await page.getByRole('button', { name: 'Load latest' }).click()
  await confirm.getByRole('button', { name: 'Discard my changes and load latest' }).click()
  await page.getByRole('radio', { name: 'Markdown' }).click()
  await expect(source(page)).toHaveValue('Newest\n')
  await expect(page.getByText('This document changed while you were editing')).toHaveCount(0)
  await mcp.close()
})
