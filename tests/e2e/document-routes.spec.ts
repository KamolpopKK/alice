import type { Page } from '@playwright/test'
import { inviteHuman } from '../helpers/client'
import { expect, goTo, signIn, signOut, test } from './fixtures'

/** Full-page document authoring: routes, entry points, link context, return paths and in-memory drafts. */
const V1 = '/client/v1'
const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
const titleField = (page: Page) => page.getByLabel('Document title')

async function documentCount(owner: { get: (p: string) => Promise<{ body: { items: unknown[] } }> }) {
  return (await owner.get(`${V1}/documents?archived=all&limit=200`)).body.items.length
}

test('every Create and Edit entry opens a full page, and old links still work', async ({ app, owner, page }) => {
  const task = (await owner.post(`${V1}/tasks`, { title: `Routes task ${stamp()}` })).body.task
  const doc = (await owner.post(`${V1}/documents`, { title: `Routes doc ${stamp()}`, body: 'Body\n' })).body.document
  await signIn(page, app)

  await goTo(page, 'Documents')
  await page.getByRole('button', { name: 'New document' }).click()
  await expect(page).toHaveURL(/\/documents\/new$/)
  await expect(page.getByRole('heading', { level: 1, name: 'New document' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.goto(`${app.url}/`)
  await page.getByRole('button', { name: 'New document' }).first().click()
  await expect(page).toHaveURL(/\/documents\/new$/)

  await page.goto(`${app.url}/documents?new=1`)
  await expect(page).toHaveURL(/\/documents\/new$/)

  await page.goto(`${app.url}/tasks/${task.id}`)
  await page.getByRole('region', { name: 'Documents' }).getByRole('button', { name: 'New document' }).click()
  await expect(page).toHaveURL(new RegExp(`/documents/new\\?taskId=${task.id}&returnTo=%2Ftasks%2F${task.id}$`))
  await expect(page.getByText(`Will be linked to the task “${task.title}” when you create it.`)).toBeVisible()

  await page.goto(`${app.url}/documents/${doc.id}`)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/documents/${doc.id}/edit$`))
  await expect(page.getByRole('heading', { level: 1, name: `Edit “${doc.title}”` })).toBeVisible()
  // โหลดตรงหรือ refresh ก็ได้หน้าเดิม
  await page.reload()
  await expect(titleField(page)).toHaveValue(doc.title)
  await page.goto(`${app.url}/documents/new`)
  await expect(page.getByRole('heading', { level: 1, name: 'New document' })).toBeVisible()
})

test('Create saves nothing until pressed, links to its task, opens the new document and Cancel returns', async ({ app, owner, page }) => {
  const task = (await owner.post(`${V1}/tasks`, { title: `Link me ${stamp()}` })).body.task
  await signIn(page, app)
  const before = await documentCount(owner)
  await page.goto(`${app.url}/tasks/${task.id}`)
  await page.getByRole('region', { name: 'Documents' }).getByRole('button', { name: 'New document' }).click()
  await titleField(page).fill('Not saved')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`))
  expect(await documentCount(owner)).toBe(before)

  await page.getByRole('region', { name: 'Documents' }).getByRole('button', { name: 'New document' }).click()
  // Cancel ล้าง draft แล้ว: ฟอร์มว่าง
  await expect(titleField(page)).toHaveValue('')
  const title = `Linked spec ${stamp()}`
  await titleField(page).fill(title)
  await page.getByLabel('Source URL (optional)').fill('https://example.com/spec')
  await page.getByRole('button', { name: 'Create document' }).click()
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  const id = page.url().split('/').pop()!
  const saved = (await owner.get(`${V1}/documents/${id}`)).body.document
  expect(saved).toMatchObject({ title, body: '', sourceUrl: 'https://example.com/spec' })
  expect(saved.links.tasks.map((t: { id: string }) => t.id)).toEqual([task.id])
})

test('link targets and return paths from the address are checked', async ({ app, owner, page }) => {
  await signIn(page, app)
  const before = await documentCount(owner)
  await page.goto(`${app.url}/documents/new?taskId=${encodeURIComponent('../../admin')}&returnTo=${encodeURIComponent('https://evil.example/')}`)
  await expect(page.getByText('This link target is not valid')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page).toHaveURL(`${app.url}/documents`)
  await page.goto(`${app.url}/documents/new?returnTo=${encodeURIComponent('//evil.example/x')}`)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page).toHaveURL(`${app.url}/documents`)
  expect(await documentCount(owner)).toBe(before)
})

test('an unsaved draft survives moving around the app but never shows up for another person', async ({ app, owner, page }) => {
  const doc = (await owner.post(`${V1}/documents`, { title: `Draft scope ${stamp()}`, body: 'Original\n' })).body.document
  const name = `drafter${stamp()}`.slice(0, 20)
  await inviteHuman(owner, name, 'Second Person')
  await signIn(page, app)
  await page.goto(`${app.url}/documents/${doc.id}/edit`)
  await titleField(page).fill('Unsaved title')
  await page.getByRole('radio', { name: 'Markdown' }).click()
  await page.getByLabel('Body', { exact: true }).fill('Unsaved body\n')
  // ไปหน้าอื่นในแอปแล้วกลับมา (ไม่ reload: draft อยู่ใน RAM เท่านั้น)
  await goTo(page, 'Tasks')
  await expect(page).toHaveURL(/\/tasks/)
  await page.goBack()
  await expect(titleField(page)).toHaveValue('Unsaved title')
  await page.getByRole('radio', { name: 'Markdown' }).click()
  await expect(page.getByLabel('Body', { exact: true })).toHaveValue('Unsaved body\n')
  expect((await owner.get(`${V1}/documents/${doc.id}`)).body.document.title).toBe(doc.title)

  // อีกคนเข้าสู่ระบบในหน้าเดิมโดยไม่ reload: RAM เดิมยังอยู่ แต่ draft เป็นของคนก่อน จึงต้องไม่เห็น
  await signOut(page)
  await page.getByLabel('Username').fill(name)
  await page.getByLabel('Password', { exact: true }).fill(`${name}-password-123`)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('button', { name: /^Account: Second Person/ })).toBeVisible()
  await page.evaluate((path) => {
    history.pushState({}, '', path)
    dispatchEvent(new PopStateEvent('popstate'))
  }, `/documents/${doc.id}/edit`)
  await expect(page.getByRole('heading', { level: 1, name: `Edit “${doc.title}”` })).toBeVisible()
  await expect(titleField(page)).toHaveValue(doc.title)
})
