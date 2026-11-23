import type { Page } from '@playwright/test'
import { expect, goTo, signIn, signOut, test } from './fixtures'

/** Leaving a document with unsaved changes asks first; Stay keeps the draft, Discard clears it. */
const V1 = '/client/v1'
const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
const leaveDialog = (page: Page) => page.getByRole('dialog', { name: 'Discard unsaved changes?' })

async function dirtyEdit(page: Page, url: string, id: string, title = 'Unsaved edit') {
  await page.goto(`${url}/documents/${id}/edit`)
  await page.getByLabel('Document title').fill(title)
}

test('links, Back and Cancel ask before discarding, and Stay keeps the draft', async ({ app, owner, page }) => {
  const doc = (await owner.post(`${V1}/documents`, { title: `Guard ${stamp()}`, body: 'Body\n' })).body.document
  await signIn(page, app)
  await page.goto(`${app.url}/documents/${doc.id}`)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByLabel('Document title').fill('Unsaved edit')

  // ลิงก์ในแอป: Stay อยู่หน้าเดิม ข้อความยังอยู่
  await goTo(page, 'Tasks')
  await expect(leaveDialog(page)).toBeVisible()
  await expect(leaveDialog(page).getByRole('button', { name: 'Stay and keep editing' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(leaveDialog(page)).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`/documents/${doc.id}/edit$`))
  await expect(page.getByLabel('Document title')).toHaveValue('Unsaved edit')

  // Back: Stay แล้ว Discard
  await page.goBack()
  await expect(leaveDialog(page)).toBeVisible()
  await leaveDialog(page).getByRole('button', { name: 'Stay and keep editing' }).click()
  await expect(page).toHaveURL(new RegExp(`/documents/${doc.id}/edit$`))
  await page.goBack()
  await leaveDialog(page).getByRole('button', { name: 'Discard changes' }).click()
  await expect(page).toHaveURL(new RegExp(`/documents/${doc.id}$`))
  // draft ถูกล้างแล้ว: เปิด Edit ใหม่ได้ค่าจาก server
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.getByLabel('Document title')).toHaveValue(doc.title)

  // Cancel ตอนยังไม่แก้: ไม่ถาม; ตอนแก้แล้ว: ถาม
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(leaveDialog(page)).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`/documents/${doc.id}$`))
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByLabel('Document title').fill('Another edit')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await leaveDialog(page).getByRole('button', { name: 'Discard changes' }).click()
  await expect(page).toHaveURL(new RegExp(`/documents/${doc.id}$`))
  expect((await owner.get(`${V1}/documents/${doc.id}`)).body.document.title).toBe(doc.title)
})

test('saving clears the guard, and reload or closing the tab is guarded only while unsaved', async ({ app, owner, page }) => {
  const doc = (await owner.post(`${V1}/documents`, { title: `Reload ${stamp()}`, body: 'Body\n' })).body.document
  await signIn(page, app)
  await dirtyEdit(page, app.url, doc.id, 'Reload guarded')
  // reload/ปิดแท็บ: หน้าเว็บขอให้ browser ถามก่อน (ยกเลิก beforeunload) เฉพาะตอนมีสิ่งที่ยังไม่บันทึก
  const unloadBlocked = () =>
    page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    })
  expect(await unloadBlocked()).toBe(true)
  await expect(page.getByLabel('Document title')).toHaveValue('Reload guarded')

  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Reload guarded' })).toBeVisible()
  await expect(leaveDialog(page)).toHaveCount(0)
  expect(await unloadBlocked()).toBe(false)
  await goTo(page, 'Tasks')
  await expect(page).toHaveURL(/\/tasks/)
  await expect(leaveDialog(page)).toHaveCount(0)
})

test('signing out with unsaved changes asks first', async ({ app, owner, page }) => {
  const doc = (await owner.post(`${V1}/documents`, { title: `Sign out ${stamp()}`, body: 'Body\n' })).body.document
  await signIn(page, app)
  await dirtyEdit(page, app.url, doc.id)
  await signOut(page)
  await expect(leaveDialog(page)).toBeVisible()
  await leaveDialog(page).getByRole('button', { name: 'Stay and keep editing' }).click()
  await expect(page.getByRole('button', { name: /^Account: / })).toBeVisible()
  await expect(page.getByLabel('Document title')).toHaveValue('Unsaved edit')
  await signOut(page)
  await leaveDialog(page).getByRole('button', { name: 'Discard changes' }).click()
  await expect(page.getByLabel('Username')).toBeVisible()
})

test('a new document guards only once something is typed', async ({ app, page }) => {
  await signIn(page, app)
  await page.goto(`${app.url}/documents/new`)
  await goTo(page, 'Tasks')
  await expect(page).toHaveURL(/\/tasks/)
  await page.goBack()
  await page.getByLabel('Document title').fill('Draft title')
  await goTo(page, 'Tasks')
  await expect(leaveDialog(page)).toBeVisible()
  await leaveDialog(page).getByRole('button', { name: 'Discard changes' }).click()
  await expect(page).toHaveURL(/\/tasks/)
})
