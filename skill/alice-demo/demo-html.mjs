import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { jobPath, validateManifest, readJson, writeJson, hash, fail, loadPlaywright, isMain, cliError } from './demo-core.mjs'

export async function renderHtmlScene(root, manifest, sceneId, { chromium } = {}) {
  const m = validateManifest(manifest, root)
  const scene = m.scenes.find((s) => s.id === sceneId && s.type === 'html')
  if (!scene) fail('MISSING_SCENE', 'Choose an HTML scene')
  const source = jobPath(root, scene.html)
  if (!fs.statSync(source).isFile()) fail('MISSING_HTML', 'Scene HTML is unavailable')
  if (m.font && !fs.statSync(jobPath(root, m.font)).isFile()) fail('MISSING_FONT', 'Selected font is unavailable')
  const relative = `media/frames/${scene.id}-${randomUUID()}`
  const folder = jobPath(root, relative)
  fs.mkdirSync(folder, { recursive: true })
  const browser = await (chromium ?? loadPlaywright(root).chromium).launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: m.video.width, height: m.video.height } })
    page.setDefaultTimeout(30_000)
    const errors = []
    page.on('pageerror', () => errors.push('page'))
    page.on('requestfailed', () => errors.push('asset'))
    page.on('response', (response) => { if (!response.ok()) errors.push('asset') })
    await page.addInitScript((scene) => { window.demoScene = scene }, scene)
    await page.goto(pathToFileURL(source).href, { waitUntil: 'load', timeout: 30_000 })
    if (m.font) {
      const url = pathToFileURL(jobPath(root, m.font)).href
      await page.addStyleTag({ content: `@font-face{font-family:DemoThai;src:url(${JSON.stringify(url)})}body{font-family:DemoThai,sans-serif}` })
    }
    await page.waitForFunction(() => document.fonts.status === 'loaded' && [...document.images].every((image) => image.complete))
    const ready = await page.evaluate(async (customFont) => {
      const faces = customFont ? await document.fonts.load('24px DemoThai', 'ไทย') : []
      return typeof window.renderAt === 'function' && [...document.images].every((image) => image.naturalWidth > 0) &&
        [...document.fonts].every((font) => font.status !== 'error') && (!customFont || faces.length > 0)
    }, Boolean(m.font))
    if (!ready || errors.length) fail('SCENE_NOT_READY', 'HTML requires renderAt(t) and successfully loaded fonts/assets')
    const count = Math.ceil(scene.duration * m.video.fps)
    for (let frame = 0; frame < count; frame++) {
      await page.evaluate(async (t) => { await window.renderAt(t) }, frame / m.video.fps)
      if (errors.length) fail('SCENE_RENDER_FAILED', 'Scene script or asset failed during rendering')
      await page.screenshot({ path: path.join(folder, `${String(frame).padStart(6, '0')}.png`), animations: 'disabled' })
    }
    const record = { scene: scene.id, directory: relative, count, fps: m.video.fps, duration: scene.duration,
      source: scene.html, sourceHash: hash(fs.readFileSync(source)), provenance: scene.disclosure ?? 'HTML presentation; label simulated content in the storyboard' }
    writeJson(root, `media/frames/${scene.id}.json`, record)
    return record
  } finally { await browser.close() }
}

if (isMain(import.meta.url)) {
  try {
    const [command, root, file, sceneId] = process.argv.slice(2)
    if (command === 'render') console.log(JSON.stringify(await renderHtmlScene(root, readJson(file), sceneId), null, 2))
    else console.log('demo-html.mjs render JOB MANIFEST.json SCENE\nHTML must expose renderAt(t), load local assets/fonts and avoid independent wall-clock animation.')
  } catch (error) { cliError(error) }
}
