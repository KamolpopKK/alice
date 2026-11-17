import type { Page } from '@playwright/test'
import { inviteHuman, OWNER } from '../helpers/client'
import { openClientEvents } from '../helpers/sse'
import { expect, signIn, test } from './fixtures'

const V1 = '/client/v1'
const isPadMutation = (url: string, method: string) => method !== 'GET' && /\/client\/v1\/pads\//.test(url)
const titles = async (owner: { get: (p: string) => Promise<any> }, archived = 'active') =>
  ((await owner.get(`${V1}/tasks?limit=200&archived=${archived}`)).body.items as Array<{ title: string }>).map((t) => t.title)

async function goOffline(page: Page) {
  await page.route('**/client/v1/pads/**', (route) => (isPadMutation(route.request().url(), route.request().method()) ? route.abort('internetdisconnected') : route.continue()))
}

test('typing never waits; unsynced capture survives reload and replays exactly once', async ({ app, owner, page }) => {
  const pad = (await owner.post(`${V1}/pads`, { name: 'Flaky wifi' })).body.pad
  await signIn(page, app)
  await page.goto(`${app.url}/pads/${pad.id}`)
  await goOffline(page)
  const capture = page.getByRole('textbox', { name: 'New task' }).last()
  await capture.click()
  await page.keyboard.type('Offline one')
  await page.keyboard.press('Enter')
  // บรรทัดถัดไปพร้อมทันทีแม้ server ยังไม่ตอบ
  await expect(page.getByRole('textbox', { name: 'New task' }).last()).toBeFocused()
  await page.keyboard.type('Offline two')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Typed but not committed')
  await expect(page.getByRole('status').filter({ hasText: 'Not synced' })).toBeVisible()
  await expect(page.locator('[data-key]', { has: page.locator('input[value="Offline one"]') }).getByText('Not synced')).toBeVisible()
  // ยังไม่ยืนยัน = ไม่อยู่บน Board/List ของใคร
  expect(await titles(owner)).not.toContain('Offline one')

  await page.reload()
  await expect(page.locator('input[value="Offline one"]')).toBeVisible()
  await expect(page.locator('input[value="Offline two"]')).toBeVisible()
  await expect(page.locator('input[value="Typed but not committed"]')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Not synced' })).toBeVisible()
  expect(await titles(owner)).not.toContain('Offline one')

  await page.unroute('**/client/v1/pads/**')
  await page.getByRole('button', { name: 'Retry now' }).click()
  await expect.poll(async () => (await titles(owner)).filter((t) => t === 'Offline one' || t === 'Offline two').sort()).toEqual(['Offline one', 'Offline two'])
  await expect(page.getByRole('status').filter({ hasText: 'Not synced' })).toHaveCount(0)
  // บรรทัดที่ยังไม่กด Enter ยังอยู่เป็น draft และสร้างเมื่อ commit
  await page.locator('input[value="Typed but not committed"]').press('Enter')
  await expect.poll(async () => (await titles(owner)).filter((t) => t === 'Typed but not committed').length).toBe(1)
  // outbox ถูกล้างเมื่อทุกอย่างยืนยันแล้ว
  await expect.poll(async () => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('alice.padOutbox')).length)).toBe(0)
})

test('a lost response is replayed idempotently: one task per accepted intent', async ({ app, owner, page }) => {
  const pad = (await owner.post(`${V1}/pads`, { name: 'Lost responses' })).body.pad
  await signIn(page, app)
  await page.goto(`${app.url}/pads/${pad.id}`)
  let dropped = 0
  // server รับและบันทึกแล้ว แต่ client ไม่ได้รับคำตอบ
  await page.route('**/client/v1/pads/**/blocks', async (route) => {
    if (route.request().method() === 'POST' && dropped < 2) {
      dropped++
      await route.fetch()
      return route.abort('connectionreset')
    }
    return route.continue()
  })
  const capture = page.getByRole('textbox', { name: 'New task' }).last()
  await capture.click()
  await page.keyboard.type('Exactly once')
  await page.keyboard.press('Enter')
  await expect.poll(() => dropped).toBe(2)
  await page.getByRole('button', { name: 'Retry now' }).click()
  await expect.poll(async () => (await titles(owner)).filter((t) => t === 'Exactly once').length, { timeout: 15_000 }).toBe(1)
  await expect(page.getByRole('status').filter({ hasText: 'Not synced' })).toHaveCount(0)
  const blocks = (await owner.get(`${V1}/pads/${pad.id}/blocks`)).body.items
  expect(blocks.filter((b: any) => b.task?.title === 'Exactly once')).toHaveLength(1)
})

test('a rejected intent keeps its text with Retry and Discard', async ({ app, owner, page }) => {
  const pad = (await owner.post(`${V1}/pads`, { name: 'Rejections' })).body.pad
  await signIn(page, app)
  await page.goto(`${app.url}/pads/${pad.id}`)
  let reject = true
  await page.route('**/client/v1/pads/**/blocks', async (route) => {
    if (route.request().method() === 'POST' && reject) {
      return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INVALID_STATE', message: 'Project Website is archived; choose an active project' } }) })
    }
    return route.continue()
  })
  const capture = page.getByRole('textbox', { name: 'New task' }).last()
  await capture.click()
  await page.keyboard.type('Needs a retry')
  await page.keyboard.press('Enter')
  const failed = page.locator('[data-sync="failed"]', { has: page.locator('input[value="Needs a retry"]') })
  await expect(failed.getByText('Project Website is archived')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'could not be saved' })).toBeVisible()
  // พิมพ์ต่อได้ระหว่างนั้น
  await page.keyboard.type('Keeps typing')
  await expect(page.locator('input[value="Keeps typing"]')).toBeVisible()
  reject = false
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.poll(async () => (await titles(owner)).filter((t) => t === 'Needs a retry').length).toBe(1)

  reject = true
  await page.getByRole('textbox', { name: 'New task' }).last().click()
  await page.keyboard.type('Discard me')
  await page.keyboard.press('Enter')
  const second = page.locator('[data-sync="failed"]', { has: page.locator('input[value="Discard me"]') })
  await expect(second).toBeVisible()
  await second.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(page.locator('input[value="Discard me"]')).toHaveCount(0)
  reject = false
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'New task' }).last()).toBeVisible()
  await expect(page.locator('input[value="Discard me"]')).toHaveCount(0)
  expect(await titles(owner)).not.toContain('Discard me')
})

test('two sessions of the same human merge different lines live and flag a same-line overwrite', async ({ app, owner, browser }) => {
  const pad = (await owner.post(`${V1}/pads`, { name: 'Two devices' })).body.pad
  const text = (t: string) => [{ type: 'text', text: t }]
  const x = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'text', content: text('Laptop line') })).body.block
  const y = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'text', content: text('Phone line'), afterId: x.id })).body.block
  const z = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'text', content: text('Shared line'), afterId: y.id })).body.block
  const member = await inviteHuman(owner, 'watcher', 'Watcher')
  const memberEvents = await openClientEvents(member)

  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const a = await ctxA.newPage()
  const b = await ctxB.newPage()
  await signIn(a, app, OWNER.username, OWNER.password)
  await signIn(b, app, OWNER.username, OWNER.password)
  await a.goto(`${app.url}/pads/${pad.id}`)
  await b.goto(`${app.url}/pads/${pad.id}`)
  const line = (p: Page, id: string) => p.locator(`[data-block-id="${id}"] [role="textbox"]`)

  await line(a, x.id).click()
  await a.keyboard.press('End')
  await a.keyboard.type(' (edited on laptop)')
  await line(b, y.id).click()
  await b.keyboard.press('End')
  await b.keyboard.type(' (edited on phone)')
  // ต่างบรรทัด: รวมกันได้และอัปเดตสด
  await expect(line(a, y.id)).toHaveText('Phone line (edited on phone)', { timeout: 10_000 })
  await expect(line(b, x.id)).toHaveText('Laptop line (edited on laptop)', { timeout: 10_000 })

  // บรรทัดเดียวกัน: เขียนทีหลังชนะ เครื่องที่แพ้เห็นข้อความแจ้ง
  await line(a, z.id).click()
  await a.keyboard.press('End')
  await a.keyboard.type(' A')
  await expect.poll(async () => (await owner.get(`${V1}/pads/${pad.id}/blocks`)).body.items.find((i: any) => i.id === z.id).content[0].text).toBe('Shared line A')
  await line(b, z.id).click()
  await b.keyboard.press('End')
  await b.keyboard.type(' B')
  await expect.poll(async () => (await owner.get(`${V1}/pads/${pad.id}/blocks`)).body.items.find((i: any) => i.id === z.id).content[0].text).toBe('Shared line A B')
  await expect(a.getByRole('alert').filter({ hasText: 'updated on another device' })).toBeVisible({ timeout: 10_000 })
  await expect(line(a, z.id)).toHaveText('Shared line A B')

  // อีกคนไม่ได้รับ event ของ Pad เลย
  const task = (await owner.post(`${V1}/tasks`, { title: 'Marker for watcher' })).body.task
  await memberEvents.waitFor((e) => e.event === 'invalidate' && e.data.id === task.id)
  const seen = JSON.stringify(memberEvents.events)
  for (const id of [pad.id, x.id, y.id, z.id]) expect(seen).not.toContain(id)
  memberEvents.close()
  await ctxA.close()
  await ctxB.close()
})

test('reloading while the server is applying a capture shows the line once', async ({ app, owner, page }) => {
  const pad = (await owner.post(`${V1}/pads`, { name: 'Reload mid-flight' })).body.pad
  await signIn(page, app)
  await page.goto(`${app.url}/pads/${pad.id}`)
  let held = false
  // server บันทึกแล้ว แต่คำตอบมาช้า และหน้าถูก reload ก่อน
  await page.route('**/client/v1/pads/**/blocks', async (route) => {
    if (route.request().method() !== 'POST' || held) return route.continue()
    held = true
    await route.fetch()
    await new Promise((r) => setTimeout(r, 3000))
    return route.abort('connectionreset').catch(() => undefined)
  })
  await page.getByRole('textbox', { name: 'New task' }).last().click()
  await page.keyboard.type('Applied before reload')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await titles(owner)).filter((t) => t === 'Applied before reload').length).toBe(1)
  await page.unroute('**/client/v1/pads/**/blocks')
  await page.reload()
  await expect(page.locator('input[value="Applied before reload"]')).toHaveCount(1)
  await expect(page.locator('[data-sync="pending"]')).toHaveCount(0)
  await page.waitForTimeout(1500)
  await expect(page.locator('input[value="Applied before reload"]')).toHaveCount(1)
  expect((await titles(owner)).filter((t) => t === 'Applied before reload')).toHaveLength(1)
})
