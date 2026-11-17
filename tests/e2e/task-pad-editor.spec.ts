import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import type { HttpClient } from '../helpers/client'
import { expect, openNewPad as newPadFromNav, signIn, test } from './fixtures'

const V1 = '/client/v1'

async function audit(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(result.violations.map((v) => `${label}: ${v.id} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

async function openNewPad(page: Page, app: { url: string }, name: string, owner: HttpClient) {
  const pad = (await owner.post(`${V1}/pads`, { name })).body.pad
  await page.goto(`${app.url}/pads/${pad.id}`)
  await expect(page.getByLabel('Pad name')).toHaveValue(name)
  return pad as { id: string }
}

const blocksOf = async (owner: HttpClient, padId: string) => (await owner.get(`${V1}/pads/${padId}/blocks?limit=200`)).body.items as any[]
const summary = (items: any[]) => items.map((b) => `${b.depth}:${b.type}:${b.type === 'task' ? b.task.title : b.content.map((s: any) => (s.type === 'text' ? s.text : `@${s.taskId}`)).join('')}`)
const capture = (page: Page) => page.getByRole('textbox', { name: 'New task' }).last()

test('keyboard-first capture: Enter rules, headings, text, hierarchy and descriptions', async ({ app, owner, page }) => {
  await signIn(page, app)
  await newPadFromNav(page, owner)
  // พร้อมพิมพ์ Task ทันทีโดยไม่ต้องคลิก
  await expect(capture(page)).toBeFocused()
  const padId = page.url().split('/pads/')[1]

  await page.keyboard.type('Agenda')
  // Cmd/Ctrl + / เปิดเมนูของบรรทัด → เปลี่ยนเป็น Heading
  await page.keyboard.press('ControlOrMeta+/')
  await page.getByRole('menuitem', { name: 'Turn into Heading' }).click()
  await expect(page.getByRole('textbox', { name: 'Heading level 1' })).toBeFocused()
  // Enter หลัง Heading = Text ใต้หัวข้อ
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Text' })).toBeFocused()
  await page.keyboard.type('Budget is tight this quarter')
  // Enter หลัง Text = Text
  await page.keyboard.press('Enter')
  await page.keyboard.type('Follow up on invoices')
  await page.keyboard.press('ControlOrMeta+/')
  await page.getByRole('menuitem', { name: 'Turn into Task' }).click()
  await expect(page.getByRole('textbox', { name: 'Task title' }).last()).toBeFocused()
  // Enter หลัง Task = Task ใหม่ ทันที
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Ask finance for numbers')
  // Tab จาก Task ที่มีชื่อ = เข้า Description
  await page.keyboard.press('Tab')
  const description = page.getByLabel('Description of Ask finance for numbers')
  await expect(description).toBeFocused()
  await page.keyboard.type('Need:')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('- Q3 actuals')
  // Enter สองครั้งบนบรรทัดว่าง = กลับไปจด Task ต่อ
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'New task' }).nth(0)).toBeFocused()
  await page.keyboard.type('Book the room')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Big one')
  // Cmd/Ctrl + Enter ออกจาก Description และเริ่ม Task ถัดไป
  await page.keyboard.press('ControlOrMeta+Enter')
  await page.keyboard.type('Send notes')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.type('Wrap up')
  await page.keyboard.press('Enter')

  await expect.poll(async () => summary(await blocksOf(owner, padId)), { timeout: 10_000 }).toEqual([
    '1:heading:Agenda',
    '2:text:Budget is tight this quarter',
    '2:task:Follow up on invoices',
    '2:task:Ask finance for numbers',
    '2:task:Book the room',
    '2:task:Send notes',
    '2:task:Wrap up',
  ])
  const items = await blocksOf(owner, padId)
  expect(items.find((b) => b.task?.title === 'Ask finance for numbers').task.description).toBe('Need:\n- Q3 actuals')
  expect(items.find((b) => b.task?.title === 'Book the room').task.description).toBe('Big one')
  // Task ทั้งหมดอยู่บน Board จริง
  const board = (await owner.get(`${V1}/board`)).body.columns.backlog.items.map((t: any) => t.title)
  expect(board).toEqual(expect.arrayContaining(['Follow up on invoices', 'Ask finance for numbers', 'Book the room', 'Send notes', 'Wrap up']))

  // Shift+Tab ออกจากระดับ: Task กลับมาอยู่ระดับบน
  await page.getByRole('textbox', { name: 'Task title' }).filter({ hasText: '' }).last().click()
  await page.locator('[data-type="task"]').filter({ has: page.locator('input[value="Wrap up"]') }).getByRole('textbox').focus()
  await page.keyboard.press('Shift+Tab')
  await expect.poll(async () => summary(await blocksOf(owner, padId)).at(-1)).toBe('1:task:Wrap up')
  await audit(page, 'editor')
})

test('Task-under-Task is refused; sections collapse and move with their subtree by keyboard and drag', async ({ app, owner, page }) => {
  const pad = (await owner.post(`${V1}/pads`, { name: 'Sections' })).body.pad
  const s1 = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'heading', content: [{ type: 'text', text: 'First' }] })).body.block
  await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'task', title: 'Inside first', parentId: s1.id })
  const s2 = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'heading', content: [{ type: 'text', text: 'Second' }], afterId: s1.id })).body.block
  await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'task', title: 'Inside second', parentId: s2.id })
  const t = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'task', title: 'Top task', afterId: s2.id })).body.block
  await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'task', title: 'Sibling task', afterId: t.id })
  await signIn(page, app)
  await page.goto(`${app.url}/pads/${pad.id}`)

  // Task ใต้ Task ไม่ได้ (Alt+Shift+→)
  await page.locator('input[value="Sibling task"]').focus()
  await page.keyboard.press('Alt+Shift+ArrowRight')
  await expect(page.getByRole('status').filter({ hasText: 'Nothing can be nested under a Task' })).toHaveCount(1)
  expect(summary(await blocksOf(owner, pad.id)).at(-1)).toBe('1:task:Sibling task')

  // ย้าย section ทั้งก้อนด้วยคีย์บอร์ด
  await page.getByRole('textbox', { name: 'Heading level 1' }).filter({ hasText: 'Second' }).focus()
  await page.keyboard.press('Alt+Shift+ArrowUp')
  await expect.poll(async () => summary(await blocksOf(owner, pad.id))).toEqual([
    '1:heading:Second',
    '2:task:Inside second',
    '1:heading:First',
    '2:task:Inside first',
    '1:task:Top task',
    '1:task:Sibling task',
  ])
  // collapse ซ่อน subtree
  await page.getByRole('button', { name: 'Collapse section Second' }).click()
  await expect(page.locator('input[value="Inside second"]')).toHaveCount(0)
  await expect.poll(async () => (await blocksOf(owner, pad.id))[0].collapsed).toBe(true)
  await page.getByRole('button', { name: 'Expand section Second' }).click()
  await expect(page.locator('input[value="Inside second"]')).toBeVisible()

  // drag-and-drop ได้ผลเหมือนคีย์บอร์ด
  const handle = page.getByRole('button', { name: 'Task actions: Top task' })
  const target = page.locator('[data-type="heading"]').filter({ hasText: 'Second' })
  await page.locator('[data-type="task"]').filter({ has: page.locator('input[value="Top task"]') }).hover()
  await handle.dragTo(target, { targetPosition: { x: 200, y: 4 } })
  await expect.poll(async () => summary(await blocksOf(owner, pad.id))[0]).toBe('1:task:Top task')
  await audit(page, 'sections')
})

test('@ places unplaced tasks, mentions placed ones, and inserts mentions in text and descriptions', async ({ app, owner, page }) => {
  const free = (await owner.post(`${V1}/tasks`, { title: 'Unplaced zebra work' })).body.task
  const elsewhere = (await owner.post(`${V1}/pads`, { name: 'Other pad' })).body.pad
  const placed = (await owner.post(`${V1}/pads/${elsewhere.id}/blocks`, { type: 'task', title: 'Placed yak work' })).body.block.task
  await signIn(page, app)
  const pad = await openNewPad(page, app, 'Mentions pad', owner)
  await capture(page).click()
  await page.keyboard.type('@zebra')
  const listbox = page.getByRole('listbox', { name: 'Place an existing task' })
  await expect(listbox.getByRole('option', { name: /Unplaced zebra work/ })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'New task', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Enter')
  await capture(page).focus()
  await page.keyboard.type('@yak')
  await expect(page.getByRole('option', { name: /Placed yak work/ })).toContainText('already in a pad')
  await page.keyboard.press('Enter')
  await expect.poll(async () => summary(await blocksOf(owner, pad.id))).toEqual(['1:task:Unplaced zebra work', `1:text:@${placed.id}`])

  // @ ใน Text แทรก mention
  const textLine = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'text', content: [{ type: 'text', text: 'Depends on ' }] })).body.block
  await page.reload()
  const editable = page.locator(`[data-block-id="${textLine.id}"] [role="textbox"]`)
  await editable.click()
  await page.keyboard.press('End')
  await page.keyboard.type('@zeb')
  await expect(page.getByRole('listbox', { name: 'Mention a task' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(editable.locator('[data-mention]')).toHaveText('@Unplaced zebra work')
  await expect.poll(async () => (await blocksOf(owner, pad.id)).find((b) => b.id === textLine.id).content).toEqual([
    { type: 'text', text: 'Depends on ' },
    { type: 'mention', taskId: free.id },
    { type: 'text', text: ' ' },
  ])
  // mention เปิด side peek
  await editable.locator('[data-mention]').click()
  await expect(page.getByRole('dialog', { name: 'Task details' }).getByRole('heading', { name: 'Unplaced zebra work' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // @ ใน Description → Markdown link
  await page.locator('input[value="Unplaced zebra work"]').focus()
  await page.keyboard.press('Tab')
  await page.keyboard.type('See @yak')
  await expect(page.getByRole('listbox', { name: 'Mention a task' }).getByRole('option', { name: /Placed yak work/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect.poll(async () => (await owner.get(`${V1}/tasks/${free.id}`)).body.task.description).toBe(`See [@Placed yak work](/tasks/${placed.id}) `)
})

test('multiline paste always asks; tasks are created atomically and Undo removes the batch', async ({ app, owner, page }) => {
  await signIn(page, app)
  const pad = await openNewPad(page, app, 'Paste pad', owner)
  await capture(page).click()
  const paste = async (text: string) =>
    page.evaluate((t) => {
      const el = document.activeElement as HTMLElement
      const data = new DataTransfer()
      data.setData('text/plain', t)
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, text)

  await paste(`One\n\n${'x'.repeat(320)}\nThree`)
  const dialog = page.getByRole('dialog', { name: 'Paste multiple lines' })
  await expect(dialog).toContainText('Line 3 (320 characters)')
  await expect(dialog.getByRole('button', { name: /Create \d+ task/ })).toBeDisabled()
  await audit(page, 'paste dialog')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  expect(await blocksOf(owner, pad.id)).toEqual([])

  const before = (await owner.get(`${V1}/tasks?limit=200`)).body.items.length
  await capture(page).focus()
  await paste('Alpha\n\n  Beta  \nGamma\n')
  await page.getByRole('dialog', { name: 'Paste multiple lines' }).getByRole('button', { name: 'Create 3 tasks' }).click()
  await expect.poll(async () => summary(await blocksOf(owner, pad.id))).toEqual(['1:task:Alpha', '1:task:Beta', '1:task:Gamma'])
  expect((await owner.get(`${V1}/tasks?limit=200`)).body.items.length).toBe(before + 3)

  // Undo ทั้ง batch ครั้งเดียว: block หาย task ถูก archive (ไม่ถูกลบ)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await blocksOf(owner, pad.id)).length).toBe(0)
  const archived = (await owner.get(`${V1}/tasks?archived=archived&limit=200`)).body.items.map((t: any) => t.title)
  expect(archived).toEqual(expect.arrayContaining(['Alpha', 'Beta', 'Gamma']))

  // Paste as text
  await capture(page).focus()
  await paste('note one\nnote two')
  await page.getByRole('dialog', { name: 'Paste multiple lines' }).getByRole('button', { name: 'Paste as text' }).click()
  await expect.poll(async () => summary(await blocksOf(owner, pad.id))).toEqual(['1:text:note one', '1:text:note two'])

  // rich formatting ถูกตัดทิ้งใน Text
  const line = page.locator('[data-type="text"] [role="textbox"]').last()
  await line.click()
  await page.keyboard.press('End')
  await page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    const data = new DataTransfer()
    data.setData('text/html', '<b>bold</b>')
    data.setData('text/plain', ' bold')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await expect(line.locator('b')).toHaveCount(0)
  await expect.poll(async () => summary(await blocksOf(owner, pad.id)).at(-1)).toBe('1:text:note two bold')
})

test('Undo covers typing, creation, conversion, nesting and removal without deleting tasks', async ({ app, owner, page }) => {
  await signIn(page, app)
  const pad = await openNewPad(page, app, 'Undo pad', owner)
  await capture(page).click()
  await page.keyboard.type('Oops task')
  await page.keyboard.press('Enter')
  await expect.poll(async () => summary(await blocksOf(owner, pad.id))).toEqual(['1:task:Oops task'])
  const taskId = (await blocksOf(owner, pad.id))[0].task.id
  // undo การสร้าง task: block หาย task ถูก archive
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await blocksOf(owner, pad.id)).length).toBe(0)
  expect((await owner.get(`${V1}/tasks/${taskId}`)).body.task.archivedAt).not.toBeNull()

  const text = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'text', content: [{ type: 'text', text: 'Keep this' }] })).body.block
  await page.reload()
  const editable = page.locator(`[data-block-id="${text.id}"] [role="textbox"]`)
  await editable.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' and more')
  await expect.poll(async () => summary(await blocksOf(owner, pad.id))[0]).toBe('1:text:Keep this and more')
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => summary(await blocksOf(owner, pad.id))[0]).toBe('1:text:Keep this')

  // conversion Text → Task แล้ว Undo: ได้ข้อความเดิมกลับ task ใหม่ถูก archive
  await editable.click()
  await page.keyboard.press('ControlOrMeta+/')
  await page.getByRole('menuitem', { name: 'Turn into Task' }).click()
  await expect.poll(async () => summary(await blocksOf(owner, pad.id))[0]).toBe('1:task:Keep this')
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => summary(await blocksOf(owner, pad.id))).toEqual(['1:text:Keep this'])

  // Remove from pad แล้ว Undo: task เดิมกลับมาอยู่ที่เดิม
  const kept = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'task', title: 'Stays alive' })).body.block
  await page.reload()
  await page.locator('input[value="Stays alive"]').focus()
  await page.keyboard.press('ControlOrMeta+/')
  await page.getByRole('menuitem', { name: 'Remove from pad' }).click()
  await expect.poll(async () => (await blocksOf(owner, pad.id)).some((b) => b.task?.id === kept.task.id)).toBe(false)
  expect((await owner.get(`${V1}/tasks/${kept.task.id}`)).body.task.archivedAt).toBeNull()
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await blocksOf(owner, pad.id)).some((b) => b.task?.id === kept.task.id)).toBe(true)
})

test('completion, archive and restore from the Pad keep tasks authoritative', async ({ app, owner, page }) => {
  const pad = (await owner.post(`${V1}/pads`, { name: 'Lifecycle', defaultStatus: 'in_progress' })).body.pad
  const block = (await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'task', title: 'Finish slides' })).body.block
  await signIn(page, app)
  await page.goto(`${app.url}/pads/${pad.id}`)
  await page.getByRole('checkbox', { name: 'Complete: Finish slides' }).click()
  await expect.poll(async () => (await owner.get(`${V1}/tasks/${block.task.id}`)).body.task.status).toBe('done')
  await page.getByRole('checkbox', { name: 'Reopen: Finish slides' }).click()
  await expect.poll(async () => (await owner.get(`${V1}/tasks/${block.task.id}`)).body.task.status).toBe('in_progress')
  await owner.post(`${V1}/tasks/${block.task.id}/archive`)
  await page.reload()
  await expect(page.locator('[data-type="task"]').filter({ hasText: 'Archived' })).toHaveCount(1)
  await page.locator('input[value="Finish slides"]').focus()
  await page.getByRole('button', { name: 'Task actions: Finish slides' }).click()
  await page.getByRole('menuitem', { name: 'Restore task' }).click()
  await expect.poll(async () => (await owner.get(`${V1}/tasks/${block.task.id}`)).body.task.archivedAt).toBeNull()
})

test('a large pad stays responsive, keyboard navigation reaches later windows', async ({ app, owner, page }) => {
  const pad = (await owner.post(`${V1}/pads`, { name: 'Large pad' })).body.pad
  let prev: string | null = null
  for (let i = 0; i < 450; i++) {
    const res: any = await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'text', content: [{ type: 'text', text: `line ${i}` }], afterId: prev })
    prev = res.body.block.id
  }
  await signIn(page, app)
  const started = Date.now()
  await page.goto(`${app.url}/pads/${pad.id}`)
  await expect(page.locator('[data-type="text"]')).toHaveCount(450, { timeout: 15_000 })
  expect(Date.now() - started).toBeLessThan(15_000)
  const last = page.locator('[data-type="text"] [role="textbox"]').last()
  await last.click()
  await page.keyboard.press('End')
  const t0 = Date.now()
  await page.keyboard.type(' edited')
  expect(Date.now() - t0).toBeLessThan(3000)
  await expect.poll(async () => summary(await (async () => {
    const out: any[] = []
    let cursor: string | null = null
    do {
      const res: any = await owner.get(`${V1}/pads/${pad.id}/blocks?limit=200${cursor ? `&cursor=${cursor}` : ''}`)
      out.push(...res.body.items)
      cursor = res.body.nextCursor
    } while (cursor)
    return out
  })()).at(-1)).toBe('1:text:line 449 edited')
  await page.keyboard.press('ArrowDown')
  await expect(capture(page)).toBeFocused()
})

test('touch-sized screens keep block controls reachable without hover @mobile', async ({ app, owner, page }) => {
  const pad = (await owner.post(`${V1}/pads`, { name: 'Phone capture' })).body.pad
  await owner.post(`${V1}/pads/${pad.id}/blocks`, { type: 'text', content: [{ type: 'text', text: 'Make me a task' }] })
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, app)
  await page.goto(`${app.url}/pads/${pad.id}`)
  await page.getByRole('textbox', { name: 'Text' }).click()
  const handle = page.getByRole('button', { name: 'Text actions: Make me a task' })
  await expect(handle).toBeVisible()
  const box = await handle.boundingBox()
  expect(box!.height).toBeGreaterThanOrEqual(24)
  await handle.click()
  await page.getByRole('menuitem', { name: 'Turn into Task' }).click()
  await expect.poll(async () => summary(await blocksOf(owner, pad.id))).toEqual(['1:task:Make me a task'])
  await capture(page).click()
  await page.keyboard.type('Second from phone')
  await page.keyboard.press('Enter')
  await expect.poll(async () => summary(await blocksOf(owner, pad.id))).toEqual(['1:task:Make me a task', '1:task:Second from phone'])
  await audit(page, 'mobile editor')
})
