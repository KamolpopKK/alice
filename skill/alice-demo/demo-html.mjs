import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { renderNativeMotion } from './demo-motion.mjs'
import { jobPath, prepareStage, validateManifest, readJson, writeJson, hash, fail, loadPlaywright, withinDeadline, isMain, cliError } from './demo-core.mjs'

export function htmlInputHash(root, manifest, scene) {
  const files = [...new Set([scene.html, ...(manifest.font ? [manifest.font] : []), ...(manifest.assets ?? []),
    ...(manifest.version === 2 ? [...manifest.visual.dependencies, ...scene.dependencies] : [])])]
  const input = { ...scene }
  if (manifest.version === 2 && manifest.render.localTime) delete input.start
  const helpers = manifest.version === 2 ? ['demo-core.mjs', 'demo-html.mjs', 'demo-motion.mjs', 'demo-styles.mjs'].map((file) => [file, hash(fs.readFileSync(fileURLToPath(new URL(file, import.meta.url))))]) : undefined
  return hash(JSON.stringify({ scene: input, video: manifest.video, visual: manifest.version === 2 ? manifest.visual : undefined,
    render: manifest.version === 2 ? manifest.render : undefined, helpers,
    files: files.map((file) => [file, hash(fs.readFileSync(jobPath(root, file)))]) }))
}

export function verifyHtmlFrames(root, m, scene, record) {
  if (record.inputHash !== htmlInputHash(root, m, scene) || record.count !== Math.ceil(scene.duration * m.video.fps) || record.fps !== m.video.fps) fail('STALE_FRAMES', 'HTML content, dependencies or timing changed; render the scene again')
  if (m.version === 2) {
    if (!record.dependenciesComplete || !Array.isArray(record.frameHashes) || record.frameHashes.length !== record.count) fail('STALE_FRAMES', 'Frames require complete dependencies and media hashes')
    for (const [i, expected] of record.frameHashes.entries()) {
      if (hash(fs.readFileSync(jobPath(root, `${record.directory}/${String(i).padStart(6, '0')}.png`))) !== expected) fail('STALE_FRAMES', 'Rendered frame bytes changed')
    }
  }
  return record
}

export async function openHtmlScene(root, m, scene, { chromium } = {}) {
  const source = jobPath(root, scene.html)
  const browser = await (chromium ?? loadPlaywright(root).chromium).launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: m.video.width, height: m.video.height } })
    page.setDefaultTimeout(30_000)
    const errors = []
    const dependencies = new Set([scene.html, ...(m.font ? [m.font] : []), ...(m.assets ?? []), ...(m.visual?.dependencies ?? []), ...(scene.dependencies ?? [])].map((file) => jobPath(root, file)))
    if (m.version === 2) await page.route('**/*', async (route) => {
      const url = route.request().url()
      if (url.startsWith('data:') || url.startsWith('blob:')) return route.continue()
      if (url.startsWith('file:') && dependencies.has(fileURLToPath(new URL(url)))) return route.continue()
      errors.push('undeclared')
      await route.abort()
    })
    page.on('pageerror', () => errors.push('page'))
    page.on('requestfailed', () => errors.push('asset'))
    page.on('response', (response) => { if (!response.ok()) errors.push('asset') })
    await page.addInitScript({ content: `window.demoMotion=${renderNativeMotion.toString()}` })
    await page.addInitScript(({ scene, visual, render }) => { window.demoScene = scene; window.demoVisual = visual; window.demoRender = render }, { scene: m.version === 2 && m.render.localTime ? { ...scene, start: 0 } : scene, visual: m.visual, render: m.render })
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
    if (errors.includes('undeclared')) fail('UNDECLARED_DEPENDENCY', 'Declare every local HTML/CSS/module/font/image dependency; remote HTML dependencies are not reusable')
    if (!ready || errors.length) fail('SCENE_NOT_READY', 'HTML requires renderAt(t) and successfully loaded fonts/assets')
    if (m.version === 2 && await page.evaluate(() => document.getAnimations().some((a) => a.playState === 'running'))) fail('WALL_CLOCK_ANIMATION', 'Use renderAt(t) instead of independent CSS animations')
    const render = async (t) => {
      await withinDeadline(page.evaluate(async (t) => { await window.renderAt(t) }, t))
      if (errors.includes('undeclared')) fail('UNDECLARED_DEPENDENCY', 'A scene loaded an undeclared dependency')
      if (errors.length) fail('SCENE_RENDER_FAILED', 'Scene script or asset failed during rendering')
    }
    return { browser, page, render }
  } catch (error) { await browser.close(); throw error }
}

export async function renderHtmlScene(root, manifest, sceneId, { chromium, readSource, authorize } = {}) {
  const m = validateManifest(manifest, root)
  const guard = await prepareStage(root, m, { readSource, authorize })
  const scene = m.scenes.find((s) => s.id === sceneId && s.type === 'html')
  if (!scene) fail('MISSING_SCENE', 'Choose an HTML scene')
  const source = jobPath(root, scene.html)
  if (!fs.statSync(source).isFile()) fail('MISSING_HTML', 'Scene HTML is unavailable')
  if (m.font && !fs.statSync(jobPath(root, m.font)).isFile()) fail('MISSING_FONT', 'Selected font is unavailable')
  const relative = `media/frames/${scene.id}-${randomUUID()}`
  const folder = jobPath(root, relative)
  fs.mkdirSync(folder, { recursive: true })
  const { browser, page, render } = await openHtmlScene(root, m, scene, { chromium })
  try {
    const inputHash = htmlInputHash(root, m, scene), runtime = browser.version()
    const priorFile = jobPath(root, `media/frames/${scene.id}.json`)
    if (m.version === 2 && fs.existsSync(priorFile)) {
      try {
        const previous = verifyHtmlFrames(root, m, scene, readJson(priorFile))
        if (previous.runtime === runtime) {
          await guard()
          verifyHtmlFrames(root, m, scene, previous)
          const reused = { ...previous, cached: true, validatedFor: m.source }
          writeJson(root, `media/frames/${scene.id}.json`, reused)
          return reused
        }
      } catch (error) {
        if (!['STALE_FRAMES', 'ENOENT', 'INVALID_PATH'].includes(error.code) && !(error instanceof SyntaxError)) throw error
      }
    }
    const count = Math.ceil(scene.duration * m.video.fps)
    for (let frame = 0; frame < count; frame++) {
      await render(frame / m.video.fps)
      await page.screenshot({ path: path.join(folder, `${String(frame).padStart(6, '0')}.png`), animations: 'disabled' })
    }
    // Check actual rendered pixels after a backwards seek; arithmetic alone cannot prove determinism.
    if (m.version === 2) {
      for (const frame of [...new Set([Math.floor((count - 1) / 2), 0])]) {
        await render(frame / m.video.fps)
        const expected = hash(fs.readFileSync(path.join(folder, `${String(frame).padStart(6, '0')}.png`)))
        if (hash(await page.screenshot({ animations: 'disabled' })) !== expected) fail('NONDETERMINISTIC_SCENE', 'Repeated/backward seek changed the rendered frame')
      }
    }
    const record = { scene: scene.id, directory: relative, count, fps: m.video.fps, duration: scene.duration, inputHash, runtime, cached: false,
      ...(m.version === 2 ? { dependenciesComplete: true, frameHashes: Array.from({ length: count }, (_, i) => hash(fs.readFileSync(path.join(folder, `${String(i).padStart(6, '0')}.png`)))), createdFrom: m.source, validatedFor: m.source } : {}),
      source: scene.html, sourceHash: hash(fs.readFileSync(source)), provenance: scene.disclosure ?? 'HTML presentation; label simulated content in the storyboard' }
    if (inputHash !== htmlInputHash(root, m, scene)) fail('INPUT_CHANGED', 'Dependencies changed during frame rendering')
    await guard()
    if (inputHash !== htmlInputHash(root, m, scene)) fail('INPUT_CHANGED', 'Dependencies changed before frame publication')
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
