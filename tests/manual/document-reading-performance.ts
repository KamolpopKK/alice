// วัดความเร็วของ focus reader, preview แบบขยาย, draft reader และตัวดู Mermaid บน production build
// usage: npm run build && node --import tsx tests/manual/document-reading-performance.ts
// ทุกเวลาวัดใน browser (event.timeStamp / performance.now ถึงเฟรมที่วาดแล้ว) ไม่ใช้เวลารอบคำสั่งของ Playwright
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium, type Page } from '@playwright/test'
import { startApp } from '../helpers/app'
import { OWNER, bootstrapOwner } from '../helpers/client'
import { removeTestDirs } from '../helpers/tmp'
import { READING_LIMIT, readingFixture } from './document-reading-fixtures'

const V1 = '/client/v1'
const BUDGET = { readerReadyMs: 2000, interactionP95Ms: 100, interactionSamples: 30 }
const SAMPLES = { reopen: 10, zoom: 40, pan: 40 }
const ROOT = path.resolve(import.meta.dirname, '../..')
const OUT = path.join(ROOT, '.alice-test/document-reading/performance')
// ไฟล์ที่การวัดนี้ครอบคลุม: เปลี่ยนไฟล์ใดแล้วต้องวัดใหม่
const MEASURED = [
  'src/web/components/DocumentReader.tsx',
  'src/web/components/Markdown.tsx',
  'src/web/components/markdown-scope.ts',
  'src/web/components/DocumentLink.tsx',
  'src/web/components/DocumentPreview.tsx',
  'src/web/components/MermaidDiagram.tsx',
  'src/web/components/MermaidViewer.tsx',
  'src/web/components/MermaidViewer.css',
  'src/web/components/mermaid-viewer-geometry.ts',
  'src/web/documents/DocumentEditor.tsx',
  'src/web/pages/DocumentDetailPage.tsx',
  'src/web/pages/pages.css',
  'src/web/styles.css',
  'src/web/ui/overlays.tsx',
  'src/web/ui/alice-ui.css',
  'tests/manual/document-reading-fixtures.ts',
  'tests/manual/document-reading-performance.ts',
]

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  // nearest-rank
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]
}
const round = (n: number) => Math.round(n * 10) / 10
const stats = (values: number[]) => ({ samples: values.length, p50Ms: round(percentile(values, 50)), p95Ms: round(percentile(values, 95)), maxMs: round(Math.max(...values)) })
const sha = (file: string) => createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex')

/**
 * Clicks `click` inside the page and resolves when `ready` is in the DOM, then after the next painted
 * frame. Also reports when `mermaid` (if given) finished rendering, measured from the same click.
 */
async function openTimed(page: Page, click: string, ready: string, mermaid?: string): Promise<{ readyMs: number; mermaidMs: number | null }> {
  return page.evaluate(
    ([clickSel, readySel, mermaidSel]) =>
      new Promise<{ readyMs: number; mermaidMs: number | null }>((resolve, reject) => {
        const target = document.querySelector<HTMLElement>(clickSel)
        if (!target) return reject(new Error(`missing ${clickSel}`))
        const start = performance.now()
        let readyMs: number | null = null
        const painted = (cb: () => void) => requestAnimationFrame(() => setTimeout(cb, 0))
        target.click()
        const check = () => {
          const elapsed = performance.now() - start
          if (readyMs === null && document.querySelector(readySel)) {
            readyMs = -1
            painted(() => {
              readyMs = performance.now() - start
              if (!mermaidSel) resolve({ readyMs, mermaidMs: null })
            })
          }
          if (mermaidSel && readyMs !== null && readyMs >= 0) {
            const img = document.querySelector<HTMLImageElement>(mermaidSel)
            if (img && img.complete && img.naturalWidth > 0) return painted(() => resolve({ readyMs: readyMs!, mermaidMs: performance.now() - start }))
          }
          if (elapsed > 30_000) return reject(new Error(`timed out waiting for ${readySel}`))
          requestAnimationFrame(check)
        }
        check()
      }),
    [click, ready, mermaid ?? ''] as const,
  )
}

async function closeTopDialog(page: Page) {
  // นับจาก DOM: dialog ที่อยู่ใต้ dialog อื่นถูกซ่อนจาก accessibility tree
  const count = await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length)
  // Radix ลงทะเบียน layer ใหม่หลังย้าย focus หนึ่งเฟรม: รอก่อนกด Escape
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  await page.keyboard.press('Escape')
  await page.waitForFunction((n) => document.querySelectorAll('[role="dialog"]').length < n, count)
}

/** Network time of matching requests that started after `since` (resource timing, inside the page). */
async function networkSince(page: Page, since: number, pattern: string) {
  return page.evaluate(
    ([t, p]) =>
      performance
        .getEntriesByType('resource')
        .filter((e) => e.startTime >= t && e.name.includes(p))
        .map((e) => ({ url: e.name.replace(location.origin, ''), startMs: Math.round(e.startTime - t), durationMs: Math.round((e as PerformanceResourceTiming).responseEnd - e.startTime) })),
    [since, pattern] as const,
  )
}

/**
 * Installs an in-page recorder: `start(kind)` marks an input event's timestamp; the first matching
 * visual change after it (image size for zoom, scroll position for pan) records input → painted frame.
 */
async function installInteractionRecorder(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __rec: { kind: string | null; start: number; samples: Record<string, number[]>; failures: Record<string, number> } }
    w.__rec = { kind: null, start: 0, samples: { zoom: [], keyPan: [], wheelPan: [] }, failures: { zoom: 0, keyPan: 0, wheelPan: 0 } }
    const viewer = document.querySelector('.mermaid-viewer')!
    const viewport = viewer.querySelector<HTMLElement>('.mermaid-viewer-viewport')!
    const img = viewport.querySelector('img')!
    const done = () => {
      const r = w.__rec
      if (!r.kind) return
      const kind = r.kind
      r.kind = null
      requestAnimationFrame(() => setTimeout(() => r.samples[kind].push(performance.now() - r.start), 0))
    }
    viewer.addEventListener('click', (e) => { if ((e.target as Element).closest('button[aria-label^="Zoom"]')) { w.__rec.kind = 'zoom'; w.__rec.start = e.timeStamp } }, true)
    viewport.addEventListener('keydown', (e) => { if (e.key.startsWith('Arrow')) { w.__rec.kind = 'keyPan'; w.__rec.start = e.timeStamp } }, true)
    viewport.addEventListener('wheel', (e) => { w.__rec.kind = 'wheelPan'; w.__rec.start = e.timeStamp }, { capture: true, passive: true })
    new MutationObserver(() => { if (w.__rec.kind === 'zoom') done() }).observe(img, { attributes: true, attributeFilter: ['width', 'height'] })
    viewport.addEventListener('scroll', () => { if (w.__rec.kind === 'keyPan' || w.__rec.kind === 'wheelPan') done() })
  })
}

const recorded = (page: Page, kind: string) => page.evaluate((k) => (window as unknown as { __rec: { samples: Record<string, number[]> } }).__rec.samples[k].length, kind)

async function measureZoom(page: Page) {
  const viewer = page.getByRole('dialog', { name: 'Diagram', exact: true })
  const zoomIn = viewer.getByRole('button', { name: 'Zoom in' })
  const zoomOut = viewer.getByRole('button', { name: 'Zoom out' })
  const level = viewer.getByRole('status', { name: 'Zoom level' })
  let direction: 'in' | 'out' = 'in'
  for (let i = 0; i < SAMPLES.zoom; i++) {
    // ไป-กลับระหว่างขอบเขต: ทุกครั้งต้องเปลี่ยนขนาดภาพจริง
    if (direction === 'in' && (await zoomIn.isDisabled())) direction = 'out'
    if (direction === 'out' && (await zoomOut.isDisabled())) direction = 'in'
    const before = await level.textContent()
    const count = await recorded(page, 'zoom')
    await (direction === 'in' ? zoomIn : zoomOut).click()
    await page.waitForFunction((n) => (window as unknown as { __rec: { samples: Record<string, number[]> } }).__rec.samples.zoom.length > n, count, { timeout: 5000 })
    if ((await level.textContent()) === before) throw new Error('zoom did not change the image')
  }
}

async function measurePan(page: Page, kind: 'keyPan' | 'wheelPan') {
  const viewport = page.locator('.mermaid-viewer-viewport')
  const position = () => viewport.evaluate((v) => [v.scrollLeft, v.scrollTop].join(','))
  if (kind === 'keyPan') await viewport.focus()
  else await viewport.hover()
  const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft']
  for (let i = 0; i < SAMPLES.pan; i++) {
    const before = await position()
    const count = await recorded(page, kind)
    const step = i % 8 < 4 ? 1 : -1
    if (kind === 'keyPan') await page.keyboard.press(keys[(i % 8 < 4 ? 0 : 2) + (i % 2)])
    else await page.mouse.wheel(i % 2 ? 120 * step : 0, i % 2 ? 0 : 120 * step)
    await page.waitForFunction(([k, n]) => (window as unknown as { __rec: { samples: Record<string, number[]> } }).__rec.samples[k as string].length > (n as number), [kind, count] as const, { timeout: 5000 })
    // smooth scroll จบแล้วตำแหน่งต้องเปลี่ยนจริง
    await page.waitForTimeout(250)
    if ((await position()) === before) throw new Error(`${kind} did not move the diagram`)
  }
}

async function signIn(page: Page, url: string) {
  await page.goto(`${url}/login`)
  await page.getByLabel('Username').fill(OWNER.username)
  await page.getByLabel('Password', { exact: true }).fill(OWNER.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('button', { name: /^Account: / }).waitFor()
}

const READER_TEXT = '[role="dialog"] .document-reader-body > p'
const READER_DIAGRAM = '[role="dialog"] .document-reader-body .mermaid-diagram img'

async function measureSaved(page: Page, url: string, id: string) {
  await page.goto(`${url}/documents/${id}`)
  // ข้อมูลพร้อม: body ของหน้า Document แสดงแล้ว (diagram บนหน้าเองไม่นับ)
  await page.locator('.document-body > p').first().waitFor()
  // cold module load: chunk ของ Mermaid โหลดครั้งแรกตอนหน้า Document วาด diagram (ก่อนเปิด reader)
  await page.locator('.document-body .mermaid-diagram img').first().waitFor()
  const mermaidModule = await page.evaluate(() =>
    performance.getEntriesByType('resource').filter((e) => /\/assets\/mermaid/.test(e.name)).map((e) => ({ file: e.name.replace(/^.*\/assets\//, ''), startMs: Math.round(e.startTime), durationMs: Math.round((e as PerformanceResourceTiming).responseEnd - e.startTime) })),
  )
  const pageDiagramMs = await page.evaluate(() => Math.round(performance.now()))
  const cold = await openTimed(page, '.resource-actions button[aria-haspopup="dialog"]', READER_TEXT, READER_DIAGRAM)
  await closeTopDialog(page)
  const warm: number[] = []
  const warmMermaid: number[] = []
  for (let i = 0; i < SAMPLES.reopen; i++) {
    const r = await openTimed(page, '.resource-actions button[aria-haspopup="dialog"]', READER_TEXT, READER_DIAGRAM)
    warm.push(r.readyMs)
    warmMermaid.push(r.mermaidMs!)
    await closeTopDialog(page)
  }
  return { coldModuleLoad: { mermaidChunks: mermaidModule, pageDiagramVisibleAtMs: pageDiagramMs }, coldReadyMs: round(cold.readyMs), coldMermaidRenderedMs: round(cold.mermaidMs!), warmReady: stats(warm), warmMermaidRendered: stats(warmMermaid) }
}

async function measureDraft(page: Page, url: string, id: string) {
  await page.goto(`${url}/documents/${id}/edit`)
  await page.locator('.doc-editor-content[contenteditable="true"]').waitFor()
  const results: Array<{ readyMs: number; mermaidMs: number | null }> = []
  for (let i = 0; i < SAMPLES.reopen + 1; i++) {
    // แก้ draft ก่อนเปิดทุกครั้ง (ยังอยู่ในช่วง debounce) เพื่อวัดรวม flush
    await page.locator('.doc-editor-content p').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type('x')
    results.push(await openTimed(page, '.doc-body-tools button[aria-haspopup="dialog"]', READER_TEXT, READER_DIAGRAM))
    await closeTopDialog(page)
  }
  const [cold, ...warm] = results
  return { coldReadyMs: round(cold.readyMs), coldMermaidRenderedMs: round(cold.mermaidMs!), warmReady: stats(warm.map((r) => r.readyMs)), warmMermaidRendered: stats(warm.map((r) => r.mermaidMs!)) }
}

async function measureExpanded(page: Page, url: string, sourceId: string, targetId: string) {
  await page.goto(`${url}/documents/${sourceId}`)
  const trigger = page.getByRole('button', { name: 'Preview Reading fixture', exact: true })
  const runs: Array<{ endToEndMs: number; networkMs: number; afterDataMs: number; mermaidMs: number; requests: unknown[] }> = []
  for (let i = 0; i < SAMPLES.reopen + 1; i++) {
    await trigger.click()
    await page.getByLabel('Document content preview').waitFor()
    const since = await page.evaluate(() => performance.now())
    const r = await openTimed(page, '[role="dialog"] .ui-dialog-actions button[aria-haspopup="dialog"]', READER_TEXT, READER_DIAGRAM)
    const requests = await networkSince(page, since, `/documents/${targetId}/`)
    // ช่วง network = ตั้งแต่คลิกจนคำขอสุดท้ายตอบกลับ; ส่วนที่เหลือคือหลังข้อมูลพร้อม
    const networkEnd = Math.max(0, ...requests.map((q) => q.startMs + q.durationMs))
    runs.push({ endToEndMs: round(r.readyMs), networkMs: networkEnd, afterDataMs: round(r.readyMs - networkEnd), mermaidMs: round(r.mermaidMs!), requests })
    await closeTopDialog(page)
    await closeTopDialog(page)
  }
  const [cold, ...warm] = runs
  return {
    cold,
    warmEndToEnd: stats(warm.map((r) => r.endToEndMs)),
    warmNetwork: stats(warm.map((r) => r.networkMs)),
    warmAfterData: stats(warm.map((r) => r.afterDataMs)),
    warmMermaidRendered: stats(warm.map((r) => r.mermaidMs)),
    requestsPerOpen: cold.requests,
  }
}

async function measureViewer(page: Page, url: string, id: string) {
  await page.goto(`${url}/documents/${id}`)
  await page.locator('.document-body .mermaid-diagram img').waitFor()
  const open = await openTimed(page, '.document-body .mermaid-diagram-expand', '.mermaid-viewer .mermaid-viewer-viewport img')
  await installInteractionRecorder(page)
  const fitLevel = await page.getByRole('status', { name: 'Zoom level' }).textContent()
  await measureZoom(page)
  // ซูมให้ใหญ่พอจะเลื่อนได้ทั้งสองแกน แล้ววัดการเลื่อน
  const zoomIn = page.getByRole('button', { name: 'Zoom in' })
  while (!(await zoomIn.isDisabled())) await zoomIn.click()
  await page.locator('.mermaid-viewer-viewport').evaluate((v) => v.scrollTo(v.scrollWidth / 2, v.scrollHeight / 2))
  await measurePan(page, 'keyPan')
  await measurePan(page, 'wheelPan')
  const rec = await page.evaluate(() => (window as unknown as { __rec: { samples: Record<string, number[]> } }).__rec.samples)
  return { openReadyMs: round(open.readyMs), fitLevel, zoom: { ...stats(rec.zoom), raw: rec.zoom.map(round) }, keyPan: { ...stats(rec.keyPan), raw: rec.keyPan.map(round) }, wheelPan: { ...stats(rec.wheelPan), raw: rec.wheelPan.map(round) } }
}

async function main() {
  const command = 'node --import tsx tests/manual/document-reading-performance.ts'
  const dirty = execSync('git status --porcelain', { cwd: ROOT }).toString().trim()
  const app = await startApp()
  const owner = await bootstrapOwner(app)
  const browser = await chromium.launch()
  try {
    const body = readingFixture()
    if (body.length > READING_LIMIT) throw new Error('fixture over the document limit')
    const target = (await owner.post(`${V1}/documents`, { title: 'Reading fixture', body })).body.document
    const source = (await owner.post(`${V1}/documents`, { title: 'Reading source', body: `[Reading fixture](/documents/${target.id}#wide-table)` })).body.document
    const before = (await owner.get(`${V1}/documents/${target.id}`)).body.document

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await context.addInitScript({ content: 'window.__name = (f) => f' })
    const page = await context.newPage()
    if (process.env.PERF_DEBUG) {
      page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
      page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()))
    }
    await signIn(page, app.url)
    const saved = await measureSaved(page, app.url, target.id)
    const expanded = await measureExpanded(page, app.url, source.id, target.id)
    const viewer = await measureViewer(page, app.url, target.id)
    const draft = await measureDraft(page, app.url, target.id)
    const after = (await owner.get(`${V1}/documents/${target.id}`)).body.document

    const checks = {
      savedReader: saved.coldReadyMs <= BUDGET.readerReadyMs && saved.warmReady.maxMs <= BUDGET.readerReadyMs,
      draftReader: draft.coldReadyMs <= BUDGET.readerReadyMs && draft.warmReady.maxMs <= BUDGET.readerReadyMs,
      expandedReaderAfterData: expanded.cold.afterDataMs <= BUDGET.readerReadyMs && expanded.warmAfterData.maxMs <= BUDGET.readerReadyMs,
      zoomP95: viewer.zoom.samples >= BUDGET.interactionSamples && viewer.zoom.p95Ms <= BUDGET.interactionP95Ms,
      keyPanP95: viewer.keyPan.samples >= BUDGET.interactionSamples && viewer.keyPan.p95Ms <= BUDGET.interactionP95Ms,
      wheelPanP95: viewer.wheelPan.samples >= BUDGET.interactionSamples && viewer.wheelPan.p95Ms <= BUDGET.interactionP95Ms,
      fixtureUnchanged: after.revision === before.revision && after.body === before.body,
    }
    const sh = (cmd: string) => { try { return execSync(cmd).toString().trim() } catch { return null } }
    const report = {
      when: new Date().toISOString(),
      command,
      commit: execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
      dirtySource: dirty ? dirty.split('\n') : [],
      sourceHashes: Object.fromEntries(MEASURED.map((f) => [f, sha(f)])),
      webBuild: sha('dist/web/index.html'),
      machine: {
        model: sh('sysctl -n hw.model'),
        cpu: sh('sysctl -n machdep.cpu.brand_string') ?? os.cpus()[0]?.model,
        cores: os.cpus().length,
        memoryGb: Math.round(os.totalmem() / 2 ** 30),
        os: sh('sw_vers -productVersion') ? `macOS ${sh('sw_vers -productVersion')}` : `${os.platform()} ${os.release()}`,
        arch: os.arch(),
        node: process.version,
      },
      browser: `Chromium ${browser.version()} (headless, production web build, 1440x900)`,
      fixture: { characters: body.length, tableColumns: 20, mermaidNodes: 100 },
      budgets: BUDGET,
      method: [
        'All times are measured inside the page with performance.now()/event.timeStamp; Playwright only drives input.',
        'Reader ready = click on the opener to the first reader paragraph in the DOM, then one requestAnimationFrame + task (painted frame). Mermaid render is reported separately as the time from the same click to the diagram image being decoded; the 2 s budget does not include it.',
        'Saved/draft readers: data is already on the page; cold = first open after page load, warm = the next opens. Draft opens include flushing an edit typed just before. The reader is part of the main bundle; the lazily loaded Mermaid chunks are fetched when the Document page first draws its diagram, before the reader opens, and are reported under coldModuleLoad.',
        'Expanded preview: end-to-end includes the preview re-check and content requests; network = click to the last response end (resource timing); after-data = end-to-end minus network, compared with the 2 s budget.',
        'Zoom samples include the extra clicks that zoom to the maximum before panning; each one changes the image size.',
        'Zoom = click event timestamp to the painted frame after the image size changed; pan = keydown/wheel timestamp to the painted frame after the viewport scrolled. Every sample is checked to have changed the zoom level or scroll position. Percentiles are nearest-rank.',
      ],
      results: { saved, draft, expanded, viewer },
      checks,
      passed: Object.values(checks).every(Boolean),
    }
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ ...report, results: { ...report.results, viewer: { ...viewer, zoom: { ...viewer.zoom, raw: undefined }, keyPan: { ...viewer.keyPan, raw: undefined }, wheelPan: { ...viewer.wheelPan, raw: undefined } } } }, null, 2))
    if (!report.passed) process.exitCode = 1
  } finally {
    await browser.close()
    await app.stop()
    removeTestDirs()
  }
}

await main()
