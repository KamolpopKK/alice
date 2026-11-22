// วัดความเร็วของหน้าเขียนเอกสารและ Board บน production build (npm run build ก่อน)
// usage: node --import tsx tests/manual/authoring-performance.ts
// เวลาทั้งหมดวัดภายใน browser (performance.now / event.timeStamp) จึงไม่รวมเวลา network และ IPC ของ Playwright
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium, type Page } from '@playwright/test'
import { startApp } from '../helpers/app'
import { OWNER, bootstrapOwner } from '../helpers/client'
import { removeTestDirs } from '../helpers/tmp'

const V1 = '/client/v1'
const BUDGET = { readyMs: 2000, switchMs: 2000, inputP95Ms: 100, inputSamples: 40, boardCards: 150 }
const OUT = path.resolve(import.meta.dirname, '../../test-results/authoring-performance')

const fence = (lang: string, body: string) => `\`\`\`${lang}\n${body}\n\`\`\``

/** A realistic mix of everything the editor handles, about 30,000 characters. */
function mixedFixture(): string {
  const unit = [
    '## ส่วนงาน Section 🚀',
    'Paragraph with **bold**, *italic*, ~~strike~~, `code` and a [link](https://example.com/docs). ภาษาไทยปนกับ English.',
    '- item one\n  - nested item\n- [ ] todo\n- [x] done',
    '| Name | Count |\n|:-----|------:|\n| a | 1 |\n| b | 22 |',
    fence('ts', 'const value = compute(1, 2)\nexport default value'),
    fence('mermaid', 'flowchart LR\n  A[Draft] --> B[Review] --> C[Done]'),
    '<div align="center">raw html block</div>',
    '<!-- reviewer note -->',
    '> quoted text',
  ].join('\n\n')
  let out = '# Mixed fixture\n\n'
  while (out.length < 30_000) out += unit + '\n\n'
  return out
}

/** Exactly the 100,000-character limit, mostly ordinary paragraphs and lists. */
function maximumFixture(): string {
  const unit = 'Paragraph with **bold** text, a [link](https://example.com) and ภาษาไทย.\n\n- list item\n- another item\n\n'
  let out = '# Maximum fixture\n\n'
  while (out.length + unit.length <= 100_000) out += unit
  return out + 'x'.repeat(100_000 - out.length)
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}
const round = (n: number) => Math.round(n * 10) / 10

/** Clicks inside the page and waits, inside the page, until `ready` matches; returns milliseconds. */
async function timeInPage(page: Page, clickSelector: string, readySelector: string): Promise<number> {
  return page.evaluate(
    ([click, ready]) =>
      new Promise<number>((resolve, reject) => {
        const target = document.querySelector<HTMLElement>(click)
        if (!target) return reject(new Error(`missing ${click}`))
        const start = performance.now()
        target.click()
        const check = () => {
          if (document.querySelector(ready)) requestAnimationFrame(() => resolve(performance.now() - start))
          else if (performance.now() - start > 15_000) reject(new Error(`timed out waiting for ${ready}`))
          else requestAnimationFrame(check)
        }
        check()
      }),
    [clickSelector, readySelector] as const,
  )
}

/** Records, inside the page, the time from each keystroke's input event to the next painted frame. */
async function measureInput(page: Page, samples: number): Promise<number[]> {
  await page.evaluate(() => {
    const w = window as unknown as { __inputLatency: number[] }
    w.__inputLatency = []
    document.querySelector('.doc-editor-content')!.addEventListener('beforeinput', (e) => {
      const start = e.timeStamp
      requestAnimationFrame(() => setTimeout(() => w.__inputLatency.push(performance.now() - start), 0))
    })
  })
  for (let i = 0; i < samples; i++) {
    await page.keyboard.type(String.fromCharCode(97 + (i % 26)))
    await page.waitForTimeout(30)
  }
  await page.waitForTimeout(200)
  return page.evaluate(() => (window as unknown as { __inputLatency: number[] }).__inputLatency)
}

async function signIn(page: Page, url: string) {
  await page.goto(`${url}/login`)
  await page.getByLabel('Username').fill(OWNER.username)
  await page.getByLabel('Password', { exact: true }).fill(OWNER.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('button', { name: /^Account: / }).waitFor()
}

async function measureDocument(page: Page, url: string, id: string, original: string) {
  await page.goto(`${url}/documents/${id}`)
  await page.getByRole('button', { name: 'Edit', exact: true }).waitFor()
  // เปิดครั้งแรก (รวมโหลด editor chunk) และหลังโหลด editor แล้ว (warm)
  const coldReady = await timeInPage(page, '.resource-actions button:nth-child(2)', '.doc-editor-content[contenteditable="true"]')
  await page.goBack()
  await page.getByRole('button', { name: 'Edit', exact: true }).waitFor()
  const warmReady = await timeInPage(page, '.resource-actions button:nth-child(2)', '.doc-editor-content[contenteditable="true"]')
  const toSource: number[] = []
  const toRich: number[] = []
  for (let i = 0; i < 5; i++) {
    toSource.push(await timeInPage(page, '.ui-segmented [role="radio"]:nth-child(2)', '.doc-source textarea'))
    toRich.push(await timeInPage(page, '.ui-segmented [role="radio"]:nth-child(1)', '.doc-editor-content[contenteditable="true"]'))
  }
  // เปิดแล้วสลับไปมาโดยไม่แก้: Markdown ต้องเหมือนต้นฉบับทุกตัวอักษร
  await page.getByRole('radio', { name: 'Markdown' }).click()
  const preserved = (await page.locator('.doc-source textarea').inputValue()) === original
  await page.getByRole('radio', { name: 'Rich text' }).click()
  await page.locator('.doc-editor-content p').first().click()
  await page.keyboard.press('End')
  const input = await measureInput(page, BUDGET.inputSamples)
  return {
    characters: original.length,
    coldReadyMs: round(coldReady),
    warmReadyMs: round(warmReady),
    switchToMarkdownMaxMs: round(Math.max(...toSource)),
    switchToRichMaxMs: round(Math.max(...toRich)),
    inputSamples: input.length,
    inputP50Ms: round(percentile(input, 50)),
    inputP95Ms: round(percentile(input, 95)),
    contentPreserved: preserved,
  }
}

async function measureBoard(page: Page, url: string, label: string) {
  await page.goto(`${url}/tasks?view=board&q=${label}`)
  const loadMore = page.getByRole('button', { name: 'Load more' })
  // แสดงการ์ดครบทุกหน้า (25 ใบต่อหน้า)
  while (await loadMore.first().isVisible().catch(() => false)) {
    await loadMore.first().click()
    await page.waitForTimeout(150)
  }
  const cards = await page.locator('.tasks-card-drag').count()
  await page.evaluate(() => {
    const w = window as unknown as { __longTasks: number[] }
    w.__longTasks = []
    new PerformanceObserver((list) => list.getEntries().forEach((e) => w.__longTasks.push(e.duration))).observe({ type: 'longtask', buffered: false })
  })
  // ลากการ์ดใบแรกไป In progress ขณะที่โหลดการ์ดครบ 150 ใบแล้ว
  await page.evaluate(() => window.scrollTo(0, 0))
  const card = page.locator('.tasks-card-drag').first()
  const title = (await card.locator('a[data-task-link]').textContent())!.trim()
  const box = (await card.boundingBox())!
  const target = (await page.getByRole('region', { name: 'In progress' }).boundingBox())!
  await page.mouse.move(box.x + box.width - 10, box.y + 8)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width + 4, box.y + 12, { steps: 3 })
  await page.mouse.move(target.x + target.width / 2, target.y + 40, { steps: 20 })
  await page.mouse.up()
  await page.getByRole('status').filter({ hasText: `Moved ${title} to In progress.` }).waitFor()
  const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks)
  const opened = await page.getByRole('complementary', { name: 'Task details' }).count()
  return { cards, dragMoved: true, panelOpenedByDrag: opened > 0, longTasksDuringDrag: longTasks.length, longestTaskMs: round(Math.max(0, ...longTasks)) }
}

async function main() {
  const app = await startApp()
  const owner = await bootstrapOwner(app)
  const browser = await chromium.launch()
  try {
    const mixed = mixedFixture()
    const maximum = maximumFixture()
    const mixedDoc = (await owner.post(`${V1}/documents`, { title: 'Perf mixed', body: mixed })).body.document
    const maxDoc = (await owner.post(`${V1}/documents`, { title: 'Perf maximum', body: maximum })).body.document
    const label = `perf${Date.now().toString(36)}`
    for (let i = 0; i < BUDGET.boardCards; i++) await owner.post(`${V1}/tasks`, { title: `${label} card ${i + 1}`, status: 'ready' })

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    // tsx (esbuild keepNames) ใส่ __name() ในฟังก์ชันที่ส่งเข้า page: ให้ page มี helper นี้ด้วย
    await context.addInitScript({ content: 'window.__name = (f) => f' })
    const page = await context.newPage()
    if (process.env.PERF_DEBUG) {
      page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
      page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()))
      page.on('requestfailed', (r) => console.log('FAILED', r.url(), r.failure()?.errorText))
    }
    await signIn(page, app.url)
    const documents = { mixed: await measureDocument(page, app.url, mixedDoc.id, mixed), maximum: await measureDocument(page, app.url, maxDoc.id, maximum) }
    const board = await measureBoard(page, app.url, label)

    const checks = {
      editorReady: Object.values(documents).every((d) => d.warmReadyMs <= BUDGET.readyMs),
      modeSwitch: Object.values(documents).every((d) => d.switchToMarkdownMaxMs <= BUDGET.switchMs && d.switchToRichMaxMs <= BUDGET.switchMs),
      inputP95: Object.values(documents).every((d) => d.inputSamples >= 30 && d.inputP95Ms <= BUDGET.inputP95Ms),
      contentPreserved: Object.values(documents).every((d) => d.contentPreserved),
      board: board.cards >= BUDGET.boardCards && !board.panelOpenedByDrag,
    }
    const report = {
      when: new Date().toISOString(),
      commit: execSync('git rev-parse HEAD').toString().trim(),
      machine: { model: os.cpus()[0]?.model, cores: os.cpus().length, memoryGb: Math.round(os.totalmem() / 2 ** 30), platform: `${os.platform()} ${os.release()}`, arch: os.arch() },
      browser: `Chromium ${browser.version()} (headless, production web build)`,
      budgets: BUDGET,
      method:
        'In-page timings only: readiness/switch = click to editor or textarea present plus one frame; input = beforeinput event timestamp to the next painted frame. Mermaid previews render asynchronously and are not waited for.',
      documents,
      board,
      checks,
      passed: Object.values(checks).every(Boolean),
    }
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
    if (!report.passed) process.exitCode = 1
  } finally {
    await browser.close()
    await app.stop()
    removeTestDirs()
  }
}

await main()
