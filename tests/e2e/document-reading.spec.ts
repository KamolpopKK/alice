import AxeBuilder from '@axe-core/playwright'
import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect, signIn } from './fixtures'

const EVIDENCE = path.resolve('.alice-test/document-reading')

const paragraphs = (label: string, n: number) => Array.from({ length: n }, (_, i) => `${label} paragraph ${i + 1}. ${'Readable reading text keeps a comfortable measure. '.repeat(6)}`).join('\n\n')

function readingBody(id: string) {
  return [
    '# Overview',
    paragraphs('Overview', 6),
    `Jump to [the Thai section](/documents/${id}#รายละเอียด) or [the second steps](/documents/${id}#steps-1).`,
    '## Steps',
    paragraphs('First steps', 4),
    '## รายละเอียด',
    paragraphs('Thai', 6),
    '## Steps',
    paragraphs('Second steps', 6),
  ].join('\n\n')
}

async function settleTheme(page: Page, theme: string) {
  await page.evaluate(async (t) => {
    document.documentElement.setAttribute('data-theme', t)
    await new Promise(requestAnimationFrame)
    await Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {})))
  }, theme)
}

const duplicateIds = (page: Page) =>
  page.evaluate(() => {
    const seen = new Map<string, number>()
    for (const el of document.querySelectorAll('[id]')) seen.set(el.id, (seen.get(el.id) ?? 0) + 1)
    return [...seen].filter(([, n]) => n > 1).map(([id]) => id)
  })

test('the focus reader opens over a saved document, scrolls headings in place and returns to the same spot @mobile', async ({ app, owner, page }, info) => {
  const created = (await owner.post('/api/documents', { title: 'Reading fixture', body: 'placeholder' })).body.document
  const doc = (await owner.patch(`/api/documents/${created.id}`, { body: readingBody(created.id) })).body.document
  const before = (await owner.get(`/api/documents/${doc.id}`)).body.document
  const writes: string[] = []
  page.on('request', (r) => {
    if (r.method() !== 'GET' && /\/(client\/v1|api)\/documents/.test(r.url())) writes.push(`${r.method()} ${r.url()}`)
  })
  await signIn(page, app)
  await page.goto(`${app.url}/documents/${doc.id}`)
  await expect(page.getByRole('heading', { name: 'Reading fixture', exact: true })).toBeVisible()
  const url = page.url()

  // อ่านค้างไว้กลางหน้า แล้วเปิด reader
  const main = page.locator('#main')
  await page.getByRole('heading', { name: 'รายละเอียด', exact: true }).scrollIntoViewIfNeeded()
  const scrolled = await main.evaluate((el) => el.scrollTop)
  const windowScroll = await page.evaluate(() => scrollY)
  expect(scrolled + windowScroll).toBeGreaterThan(0)
  const open = page.getByRole('button', { name: 'Focus reader', exact: true })
  // focus โดยไม่เลื่อนหน้า เหมือนกด Tab มาที่ปุ่มขณะอ่านอยู่กลางหน้า
  await open.evaluate((el: HTMLElement) => el.focus({ preventScroll: true }))
  expect(await page.evaluate(() => scrollY)).toBe(windowScroll)
  await page.keyboard.press('Enter')
  const reader = page.getByRole('dialog', { name: 'Reading fixture', exact: true })
  await expect(reader).toBeVisible()
  await expect(reader).toContainText(`Saved document · Unreviewed · Revision ${doc.revision}`)
  expect(page.url()).toBe(url)

  // หน้า Document ยังอยู่ด้านหลังและโต้ตอบไม่ได้
  await expect(page.getByRole('heading', { name: 'Reading fixture', level: 1, includeHidden: true })).toHaveCount(1)
  expect(await page.locator('.document-page').count()).toBe(1)
  await expect(page.getByRole('heading', { name: 'Reading fixture', level: 1 })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Focus reader', exact: true })).toHaveCount(0)
  expect(await duplicateIds(page)).toEqual([])
  const readerHeading = reader.getByRole('heading', { name: 'รายละเอียด', exact: true })
  await expect(readerHeading).toHaveAttribute('id', /^reader-.+--รายละเอียด$/)
  await expect(page.locator('.document-page').getByRole('heading', { name: 'รายละเอียด', exact: true, includeHidden: true })).toHaveAttribute('id', 'รายละเอียด')

  // ข้อความทั่วไปจำกัดความยาวบรรทัด แม้ reader กว้างกว่า
  const content = reader.locator('.document-reader-body')
  const paragraph = content.locator('p').first()
  const [contentWidth, paragraphWidth] = await Promise.all([content.evaluate((el) => el.clientWidth), paragraph.evaluate((el) => el.getBoundingClientRect().width)])
  expect(paragraphWidth).toBeLessThanOrEqual(contentWidth)
  if (info.project.name === 'desktop') expect(paragraphWidth).toBeLessThan(contentWidth)

  // ลิงก์ไปหัวข้อในฉบับเดียวกันเลื่อนเฉพาะใน reader
  const body = reader.locator('.ui-dialog-body')
  expect(await body.evaluate((el) => el.scrollTop)).toBe(0)
  await reader.getByRole('link', { name: 'the second steps', exact: true }).click()
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  const second = reader.getByRole('heading', { name: 'Steps', exact: true }).nth(1)
  await expect(second).toHaveAttribute('id', /--steps-1$/)
  await expect(second).toBeInViewport()
  expect(page.url()).toBe(url)
  expect(await main.evaluate((el) => el.scrollTop)).toBe(scrolled)
  await reader.getByRole('link', { name: 'the Thai section', exact: true }).click()
  await expect(readerHeading).toBeInViewport()
  await expect(reader.getByRole('button', { name: 'Close', exact: true })).toBeInViewport()

  fs.mkdirSync(EVIDENCE, { recursive: true })
  await page.screenshot({ path: path.join(EVIDENCE, `focus-reader-${info.project.name}.png`) })
  for (const theme of ['light', 'dark']) {
    await settleTheme(page, theme)
    const axe = await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  // Escape ปิดเฉพาะ reader แล้วคืน focus และตำแหน่งเดิม
  await page.keyboard.press('Escape')
  await expect(reader).toHaveCount(0)
  await expect(open).toBeFocused()
  await expect.poll(() => main.evaluate((el) => el.scrollTop)).toBe(scrolled)
  expect(await page.evaluate(() => scrollY)).toBe(windowScroll)
  expect(page.url()).toBe(url)
  await expect(page.getByRole('heading', { name: 'Reading fixture', level: 1 })).toBeVisible()

  // อ่านอย่างเดียว: ไม่มีการเขียน และ body/revision/review/relations เท่าเดิม
  expect(writes).toEqual([])
  const after = (await owner.get(`/api/documents/${doc.id}`)).body.document
  for (const key of ['body', 'revision', 'status', 'reviewedRevision', 'reviewedAt', 'relations', 'updatedAt'] as const) expect(after[key]).toEqual(before[key])
  fs.writeFileSync(path.join(EVIDENCE, `read-only-${info.project.name}.json`), JSON.stringify({ id: doc.id, writes, before: { revision: before.revision, status: before.status, updatedAt: before.updatedAt }, after: { revision: after.revision, status: after.status, updatedAt: after.updatedAt } }, null, 2))
})

test('links to other documents leave the reader through the normal router, and compact previews nest above it', async ({ app, owner, page }) => {
  const target = (await owner.post('/api/documents', { title: 'Reader link target', body: '# Target\n\nTarget body.' })).body.document
  const source = (await owner.post('/api/documents', { title: 'Reader link source', body: `Read [the target](/documents/${target.id}) next.` })).body.document
  await signIn(page, app)
  await page.goto(`${app.url}/documents/${source.id}`)
  await page.getByRole('button', { name: 'Focus reader', exact: true }).click()
  const reader = page.getByRole('dialog', { name: 'Reader link source', exact: true })
  await expect(reader).toBeVisible()

  // Compact preview เปิดซ้อนบน reader และ Escape ปิดทีละชั้น
  const previewButton = reader.getByRole('button', { name: 'Preview the target', exact: true })
  await previewButton.click()
  const preview = page.getByRole('dialog', { name: 'Document preview', exact: true })
  await expect(preview).toContainText('Reader link target')
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
  await expect(reader).toBeVisible()
  await expect(previewButton).toBeFocused()

  await reader.getByRole('link', { name: 'the target', exact: true }).click()
  await expect(reader).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`/documents/${target.id}$`))
  await expect(page.getByRole('heading', { name: 'Reader link target', level: 1 })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Reader link source', level: 1 })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('the reader is offered only for documents with content and stays out of History', async ({ app, owner, page }) => {
  const empty = (await owner.post('/api/documents', { title: 'Source only', body: '', sourceUrl: 'https://example.com/spec' })).body.document
  const doc = (await owner.post('/api/documents', { title: 'History reader', body: 'First body.' })).body.document
  await owner.patch(`/api/documents/${doc.id}`, { body: 'Second body.' })
  await signIn(page, app)
  await page.goto(`${app.url}/documents/${empty.id}`)
  await expect(page.getByText('This document only references its source.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Focus reader', exact: true })).toHaveCount(0)
  await page.goto(`${app.url}/documents/${doc.id}`)
  await expect(page.getByRole('button', { name: 'Focus reader', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Revision history', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Focus reader', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.getByRole('button', { name: 'Focus reader', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'History reader', exact: true })).toContainText('Second body.')
})

/** ลูกศรขวาซ้ำจนถึงขอบขวา: แต่ละครั้งเลื่อนทีละช่วงเหมือนผู้ใช้กดค้าง */
async function scrollToEndByKeyboard(page: Page, region: ReturnType<Page['locator']>) {
  for (let i = 0; i < 200; i++) {
    const atEnd = await region.evaluate((el) => el.scrollLeft >= el.scrollWidth - el.clientWidth - 1)
    if (atEnd) return
    await page.keyboard.press('ArrowRight')
  }
  throw new Error('table did not reach its last column by keyboard')
}

function wideTable() {
  const head = Array.from({ length: 20 }, (_, i) => `Column ${i + 1}`)
  const row = (r: number) => head.map((_, c) => (c === 1 ? 'รายละเอียดภาษาไทยที่ยาวพอสมควรเพื่อทดสอบการตัดบรรทัดภายในเซลล์ของตาราง' : c === 2 ? `https://example.com/${'very-long-path-segment-'.repeat(8)}${r}` : c === 3 ? 'A longer explanation that should wrap inside its own cell rather than stretching the column without any bound at all. '.repeat(2) : `R${r}C${c + 1}`))
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...[1, 2, 3].map((r) => `| ${row(r).join(' | ')} |`)].join('\n')
}

test('wide tables scroll inside their own region on the page and in the reader @mobile', async ({ app, owner, page }, info) => {
  const body = `# Wide table\n\nIntro paragraph.\n\n${wideTable()}\n\n| Short | Table |\n| --- | --- |\n| a | b |\n\nAfter the table.`
  const doc = (await owner.post('/api/documents', { title: 'Wide table fixture', body })).body.document
  await signIn(page, app)
  await page.goto(`${app.url}/documents/${doc.id}`)
  const regions = page.getByRole('region', { name: 'Table, scrolls sideways when wide', exact: true })
  await expect(regions).toHaveCount(2)
  const wide = regions.first()

  const geometry = () => wide.evaluate((el) => {
    const cells = [...el.querySelectorAll('th')].map((th) => th.getBoundingClientRect().width)
    const long = el.querySelectorAll('tbody tr:first-child td')[3].getBoundingClientRect().width
    const em = parseFloat(getComputedStyle(el.querySelector('.markdown-cell')!).fontSize)
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, minColumn: Math.min(...cells), long, em, headers: el.querySelectorAll('thead th').length, rows: el.querySelectorAll('tbody tr').length }
  })
  const g = await geometry()
  expect(g.headers).toBe(20)
  expect(g.rows).toBe(3)
  expect(g.scrollWidth).toBeGreaterThan(g.clientWidth)
  expect(g.minColumn).toBeGreaterThanOrEqual(48)
  expect(g.long).toBeLessThanOrEqual(28 * g.em + 20)
  const pageOverflow = () => page.evaluate(() => {
    const main = document.getElementById('main')!
    return { page: document.documentElement.scrollWidth - innerWidth, main: main.scrollWidth - main.clientWidth }
  })
  expect(await pageOverflow()).toEqual({ page: expect.any(Number), main: expect.any(Number) })
  const overflow = await pageOverflow()
  expect(overflow.page).toBeLessThanOrEqual(0)
  expect(overflow.main).toBeLessThanOrEqual(0)

  // คีย์บอร์ด: focus ที่กรอบตาราง แล้วลูกศร/End เลื่อนไปคอลัมน์ที่อยู่นอกจอ
  await wide.focus()
  await expect(wide).toBeFocused()
  const outline = await wide.evaluate((el) => getComputedStyle(el).outlineStyle)
  expect(outline).toBe('solid')
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => wide.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => wide.evaluate((el) => el.scrollLeft)).toBe(0)
  await scrollToEndByKeyboard(page, wide)
  await expect(wide.getByRole('columnheader', { name: 'Column 20' })).toBeInViewport()
  // touch/trackpad: กรอบเลื่อนได้เองด้วย overflow ปกติ และไม่ปิด gesture
  expect(await wide.evaluate((el) => [getComputedStyle(el).overflowX, getComputedStyle(el).touchAction])).toEqual(['auto', 'auto'])
  if (info.project.name === 'desktop') {
    await wide.evaluate((el) => el.scrollTo(0, 0))
    await wide.hover()
    await page.mouse.wheel(400, 0)
    await expect.poll(() => wide.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  }

  fs.mkdirSync(EVIDENCE, { recursive: true })
  await page.screenshot({ path: path.join(EVIDENCE, `wide-table-page-${info.project.name}.png`) })
  for (const theme of ['light', 'dark']) {
    await settleTheme(page, theme)
    const axe = await new AxeBuilder({ page }).include('#main').analyze()
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
  }

  // ใน reader: ตารางใช้ความกว้างเต็ม แต่เลื่อนเฉพาะตาราง และปุ่มปิดยังอยู่ในจอ
  await page.getByRole('button', { name: 'Focus reader', exact: true }).click()
  const reader = page.getByRole('dialog', { name: 'Wide table fixture', exact: true })
  const inReader = reader.getByRole('region', { name: 'Table, scrolls sideways when wide', exact: true }).first()
  await expect(inReader).toBeVisible()
  const readerGeometry = await reader.evaluate((dialog) => {
    const body = dialog.querySelector('.ui-dialog-body')!
    const table = dialog.querySelector('.markdown-table')!
    const paragraph = dialog.querySelector('.document-reader-body > p')!
    return { bodyOverflow: body.scrollWidth - body.clientWidth, table: table.getBoundingClientRect().width, paragraph: paragraph.getBoundingClientRect().width, tableScroll: table.scrollWidth - table.clientWidth }
  })
  expect(readerGeometry.bodyOverflow).toBeLessThanOrEqual(0)
  expect(readerGeometry.tableScroll).toBeGreaterThan(0)
  expect(readerGeometry.table).toBeGreaterThanOrEqual(readerGeometry.paragraph)
  await inReader.focus()
  await scrollToEndByKeyboard(page, inReader)
  await expect(reader.getByRole('columnheader', { name: 'Column 20' })).toBeInViewport()
  await expect(reader.getByRole('button', { name: 'Close', exact: true })).toBeInViewport()
  await page.screenshot({ path: path.join(EVIDENCE, `wide-table-reader-${info.project.name}.png`) })
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
  await page.keyboard.press('Escape')
  await expect(reader).toHaveCount(0)
  expect((await owner.get(`/api/documents/${doc.id}`)).body.document.body).toBe(body)
})
