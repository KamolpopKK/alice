import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { jobPath, prepareStage, validateManifest, readJson, writeJson, hash, probe, fail, loadPlaywright, withinDeadline, isMain, cliError } from './demo-core.mjs'

export function captureInputHash(root, m, scene) {
  const input = { ...scene }
  if (m.version === 2 && m.render.localTime) delete input.start
  const files = [scene.media, scene.actions, ...(scene.dependencies ?? [])].filter(Boolean)
  return hash(JSON.stringify({ scene: input, video: m.video, files: files.map((file) => [file, hash(fs.readFileSync(jobPath(root, file)))]) }))
}

export async function importCapture(root, manifest, sceneId, { inspect = probe, readSource, authorize } = {}) {
  const m = validateManifest(manifest, root)
  const guard = await prepareStage(root, m, { readSource, authorize })
  const scene = m.scenes.find((s) => s.id === sceneId && s.type === 'capture')
  if (!scene?.media) fail('MISSING_CAPTURE', 'Choose a capture scene with supplied footage')
  const input = jobPath(root, scene.media)
  const media = await inspect(input)
  if (!media.streams.some((s) => s.codec_type === 'video')) fail('INVALID_CAPTURE', 'Supplied footage has no video')
  const record = { scene: scene.id, file: scene.media, duration: media.duration, trimStart: 0,
    hash: hash(fs.readFileSync(input)), ...(m.version === 2 ? { inputHash: captureInputHash(root, m, scene), createdFrom: m.source, validatedFor: m.source } : {}), provenance: scene.provenance ?? 'User-supplied footage; verify actual source before publishing' }
  await guard()
  writeJson(root, `media/capture/${scene.id}.json`, record)
  return record
}

export async function captureScene(root, manifest, sceneId, { actionsReviewed = false, chromium, inspect = probe, storageState, readSource, authorize } = {}) {
  const m = validateManifest(manifest, root)
  const guard = await prepareStage(root, m, { readSource, authorize })
  const scene = m.scenes.find((s) => s.id === sceneId && s.type === 'capture')
  if (!scene) fail('MISSING_SCENE', 'Choose a capture scene')
  if (scene.media) return importCapture(root, m, sceneId, { inspect, readSource, authorize })
  if (scene.actions && !actionsReviewed) fail('ACTIONS_NOT_REVIEWED', 'Inspect capture source and confirm its authorized actions first')
  const folder = jobPath(root, `media/capture/${scene.id}-${Date.now()}`)
  fs.mkdirSync(folder, { recursive: true })
  const browser = await (chromium ?? loadPlaywright(root).chromium).launch({ headless: true })
  let context
  try {
    const size = { width: m.video.width, height: m.video.height }
    context = await browser.newContext({ viewport: size, recordVideo: { dir: folder, size }, ...(storageState ? { storageState } : {}) })
    const page = await context.newPage()
    page.setDefaultTimeout(30_000)
    const beginning = performance.now()
    const response = await page.goto(scene.url, { waitUntil: 'load', timeout: 30_000 })
    if (!response?.ok()) fail('PAGE_UNAVAILABLE', 'Capture page did not load successfully; do not substitute a simulation')
    await page.evaluate(() => document.fonts.ready)
    const trimStart = (performance.now() - beginning) / 1000
    const actionStart = performance.now()
    if (scene.actions) {
      const module = await import(pathToFileURL(jobPath(root, scene.actions)).href)
      if (typeof module.perform !== 'function') fail('INVALID_ACTIONS', 'Reviewed capture source must export perform(page, scene)')
      await withinDeadline(module.perform(page, scene), 30_000)
    }
    const elapsed = (performance.now() - actionStart) / 1000
    if (elapsed > scene.duration) fail('CAPTURE_OVERRUN', 'Capture actions exceed the agreed scene duration')
    await page.waitForTimeout((scene.duration - elapsed) * 1000)
    const video = page.video()
    await context.close()
    context = null
    const file = await video.path()
    const media = await inspect(file)
    const record = { scene: scene.id, file: path.relative(fs.realpathSync(root), file), duration: media.duration,
      trimStart, hash: hash(fs.readFileSync(file)), ...(m.version === 2 ? { inputHash: captureInputHash(root, m, scene), createdFrom: m.source, validatedFor: m.source } : {}), provenance: 'Real browser capture', actions: scene.actions ?? null }
    await guard()
    writeJson(root, `media/capture/${scene.id}.json`, record)
    return record
  } finally {
    if (context) await context.close()
    await browser.close()
  }
}

if (isMain(import.meta.url)) {
  try {
    const [command, root, file, sceneId, ...flags] = process.argv.slice(2)
    if (command === 'capture') console.log(JSON.stringify(await captureScene(root, readJson(file), sceneId, {
      actionsReviewed: flags.includes('--reviewed-actions'), storageState: process.env.DEMO_AUTH_FILE,
    }), null, 2))
    else if (command === 'import') console.log(JSON.stringify(await importCapture(root, readJson(file), sceneId), null, 2))
    else console.log('demo-capture.mjs capture JOB MANIFEST.json SCENE --reviewed-actions | import JOB MANIFEST.json SCENE\nInspect actions before using --reviewed-actions. DEMO_AUTH_FILE is private and must never be packaged. Native capture requires host-supported tooling or supplied footage.')
  } catch (error) { cliError(error) }
}
