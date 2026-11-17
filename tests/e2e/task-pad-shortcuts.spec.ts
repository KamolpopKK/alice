import type { Page } from '@playwright/test'
import type { HttpClient } from '../helpers/client'
import type { RunningApp } from '../helpers/app'
import { FakeNativeCore } from './desktop-bridge'
import { expect, signIn, test, accountButton } from './fixtures'

const V1 = '/client/v1'
const padIds = async (owner: HttpClient) => ((await owner.get(`${V1}/pads?archived=all&limit=200`)).body.items as Array<{ id: string; name: string }>)
const captureLine = (page: Page) => page.getByRole('textbox', { name: 'New task' }).last()
/** The keyboard listener exists only once the app knows Task Pads are available; its nav link renders in the same pass. */
const shortcutsReady = (page: Page) => expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Task Pads' })).toBeVisible()

async function desktopSignIn(page: Page, app: RunningApp, owner: HttpClient, native: FakeNativeCore) {
  await page.goto(app.url)
  await page.getByLabel('Profile name').fill('work')
  await page.getByLabel('Server URL').fill(app.url)
  await page.getByRole('button', { name: 'Add server' }).click()
  await page.getByRole('button', { name: 'Sign in with browser' }).click()
  await expect(page.getByLabel('Sign-in code')).toHaveText(/^[A-Z]{4}-[A-Z]{4}$/)
  expect((await owner.post('/client/v1/device/approve', { userCode: native.pendingUserCode })).status).toBe(200)
  await expect(accountButton(page)).toBeVisible()
}

test('active-tab shortcuts open the last pad or create exactly one new pad, and can be turned off', async ({ app, owner, page }) => {
  const recent = (await owner.post(`${V1}/pads`, { name: 'Shortcut target' })).body.pad
  await owner.post(`${V1}/pads/${recent.id}/blocks`, { type: 'task', title: 'Already here' })
  await signIn(page, app)
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible()
  await shortcutsReady(page)

  await page.keyboard.press('Alt+Shift+KeyP')
  await expect(page).toHaveURL(new RegExp(`/pads/${recent.id}`))
  await expect(captureLine(page)).toBeFocused()

  await page.goto(`${app.url}/projects`)
  await shortcutsReady(page)
  const before = (await padIds(owner)).length
  await page.keyboard.press('Alt+Shift+KeyN')
  await expect(page).toHaveURL(/\/pads\/pad_/)
  await expect(captureLine(page)).toBeFocused()
  await page.keyboard.type('Captured from anywhere')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await padIds(owner)).length).toBe(before + 1)
  // reload ไม่ทำให้สร้าง Pad ซ้ำ (state ของ history ยังอยู่)
  await page.reload()
  await expect(page.locator('input[value="Captured from anywhere"]')).toBeVisible()
  expect((await padIds(owner)).length).toBe(before + 1)

  // ปิดได้จาก Capture shortcuts
  await page.getByRole('button', { name: 'More pad options' }).click()
  await page.getByRole('menuitem', { name: 'Capture shortcuts…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Capture shortcuts' })
  await expect(dialog).toContainText('Alt+Shift+N')
  await expect(dialog.getByText('Alice Desktop (works from any app)')).toHaveCount(0)
  await dialog.getByLabel('Enable these shortcuts in this browser').uncheck()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await page.goto(`${app.url}/projects`)
  await shortcutsReady(page)
  await page.keyboard.press('Alt+Shift+KeyN')
  await page.waitForTimeout(300)
  await expect(page).toHaveURL(/\/projects$/)
  expect((await padIds(owner)).length).toBe(before + 1)
})

test('Desktop capture intents open the last pad or a new pad once, even when pressed before sign-in', async ({ app, owner, page }) => {
  const native = await FakeNativeCore.attach(page)
  // กดก่อน sign-in: intent ต้องไม่หาย
  await page.goto(app.url)
  await expect(page.getByRole('heading', { name: 'Alice servers' })).toBeVisible()
  await native.pressShortcut('new-pad')
  await native.pressShortcut('new-pad')
  const before = (await padIds(owner)).length
  await desktopSignIn(page, app, owner, native)
  await expect(page).toHaveURL(/\/pads\/pad_/)
  await expect(captureLine(page)).toBeFocused()
  await expect.poll(async () => (await padIds(owner)).length).toBe(before + 1)
  const created = page.url().split('/pads/')[1]
  await page.keyboard.type('Desktop capture line')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await owner.get(`${V1}/pads/${created}/blocks`)).body.items.map((b: any) => b.task?.title)).toEqual(['Desktop capture line'])

  // เปิด Pad ล่าสุดจากหน้าอื่น และจาก Pad เดิมที่เปิดอยู่ (focus บรรทัดใหม่)
  await page.goto(`${app.url}/projects`)
  await native.pressShortcut('open-last')
  await expect(page).toHaveURL(new RegExp(`/pads/${created}`))
  await expect(captureLine(page)).toBeFocused()
  await page.locator('input[value="Desktop capture line"]').focus()
  await native.pressShortcut('open-last')
  await expect(captureLine(page)).toBeFocused()
  expect((await padIds(owner)).length).toBe(before + 1)
})

test('Desktop shortcut settings show conflicts, save changes and restore defaults', async ({ app, owner, page }) => {
  const native = await FakeNativeCore.attach(page)
  native.takenShortcuts.add('Alt+Shift+Space')
  await desktopSignIn(page, app, owner, native)
  await page.goto(`${app.url}/pads`)
  await page.getByRole('button', { name: 'More pad options' }).click()
  await page.getByRole('menuitem', { name: 'Capture shortcuts…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Capture shortcuts' })
  await expect(dialog.getByLabel('Open last pad')).toHaveValue('Alt+Space')
  await expect(dialog.getByRole('alert')).toContainText('Another app may already use it')
  // บันทึกด้วยการกดคีย์ผสม
  await dialog.getByLabel('New pad').focus()
  await page.keyboard.press('Control+Alt+KeyN')
  await expect(dialog.getByLabel('New pad')).toHaveValue('Ctrl+Alt+N')
  await dialog.getByRole('button', { name: 'Save shortcuts' }).click()
  await expect(dialog.getByRole('status')).toContainText('Saved for this computer')
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  expect(native.shortcuts).toMatchObject({ enabled: true, openLast: 'Alt+Space', newPad: 'Ctrl+Alt+N' })
  await dialog.getByLabel('Use global capture shortcuts on this computer').uncheck()
  await dialog.getByRole('button', { name: 'Save shortcuts' }).click()
  await expect.poll(() => native.shortcuts.enabled).toBe(false)
  await dialog.getByRole('button', { name: /Restore defaults/ }).click()
  await expect(dialog.getByLabel('New pad')).toHaveValue('Alt+Shift+Space')
  await expect.poll(() => native.shortcuts.enabled).toBe(true)
})
