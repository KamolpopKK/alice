import { HttpClient, OWNER } from '../helpers/client'
import { expect, test } from './fixtures'

test('a human signs in, approves a CLI device, then revokes it from Devices @mobile', async ({ app, owner, page }) => {
  void owner
  const anon = new HttpClient(app.url)
  const start = (await anon.post('/client/v1/device/authorize', { clientKind: 'cli', clientName: 'Alice CLI', deviceName: 'build-box', clientVersion: '0.2.0' })).body

  // ลิงก์จาก CLI → login ก่อน → กลับมาที่หน้าอนุมัติพร้อม code
  await page.goto(start.verificationUriComplete)
  await page.getByLabel('Username').fill(OWNER.username)
  await page.getByLabel('Password', { exact: true }).fill(OWNER.password)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('heading', { name: 'Allow Alice CLI to act as you?' })).toBeVisible()
  await expect(page.getByText('build-box')).toBeVisible()
  await expect(page.getByText(start.userCode)).toBeVisible()
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByRole('heading', { name: 'Approved' })).toBeVisible()

  const token = await anon.post('/client/v1/device/token', { deviceCode: start.deviceCode })
  expect(token.status).toBe(200)
  const cli = new HttpClient(app.url)
  cli.bearer = token.body.accessToken
  expect((await cli.get('/client/v1/auth/me')).body.actor.displayName).toBe(OWNER.displayName)

  await page.goto(`${app.url}/devices`)
  await page.getByRole('button', { name: 'Revoke Alice CLI on build-box' }).click()
  // เทสต์อื่นใน worker เดียวกัน (เช่น desktop.spec) อาจมี session ของ owner ค้างอยู่: ตรวจเฉพาะแถวที่เพิกถอน
  await expect(page.getByRole('button', { name: 'Revoke Alice CLI on build-box' })).toHaveCount(0)
  expect((await cli.get('/client/v1/tasks')).status).toBe(401)
})

test('a human can deny an unexpected sign-in request', async ({ app, owner, page }) => {
  // ต้องขอ owner เอง: ถ้าเทสต์นี้เป็นตัวแรกบน worker ใหม่ (เช่นหลังเทสต์อื่นล้ม) server จะยังไม่มี owner
  void owner
  const anon = new HttpClient(app.url)
  const start = (await anon.post('/client/v1/device/authorize', { clientKind: 'desktop', clientName: 'Alice Desktop', deviceName: 'unknown-pc', clientVersion: '0.2.0' })).body
  const { signIn } = await import('./fixtures')
  await signIn(page, app)
  await page.goto(`${app.url}/device`)
  await page.getByLabel('Code').fill(start.userCode.toLowerCase())
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Deny' }).click()
  await expect(page.getByRole('heading', { name: 'Request denied' })).toBeVisible()
  expect((await anon.post('/client/v1/device/token', { deviceCode: start.deviceCode })).body.error.code).toBe('DEVICE_ACCESS_DENIED')
})
