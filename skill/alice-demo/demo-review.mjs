import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { hash, jobPath, writeJson, probe, runTool, loadPlaywright, fail } from './demo-core.mjs'
import { escapeHtml } from './demo-styles.mjs'

const frameCount = (metadata, fps) => {
  const v = metadata.streams.find((s) => s.codec_type === 'video'), rate = v?.avg_frame_rate?.split('/').map(Number)
  const count = Number(v?.nb_frames)
  if (!Number.isSafeInteger(count) || count < 1 || !rate || Math.abs(rate[0] / rate[1] - fps) > 0.001) fail('INVALID_SCENE_MAP', 'Use measured constant-fps normalized clips with frame counts')
  return count
}

export async function normalizedSceneMap(root, m, clips, { inspect = probe, tools = {} } = {}) {
  if (clips.length !== m.scenes.length) fail('INVALID_SCENE_MAP', 'Every scene needs its normalized clip')
  let end = 0
  const scenes = []
  for (const [i, clip] of clips.entries()) {
    const metadata = await inspect(jobPath(root, clip), tools), count = frameCount(metadata, m.video.fps)
    if (Math.abs(count / m.video.fps - m.scenes[i].duration) > 1 / m.video.fps + 0.001) fail('INVALID_SCENE_MAP', 'Normalized clip exceeds the agreed duration by more than a frame')
    scenes.push({ id: m.scenes[i].id, title: m.scenes[i].title, startFrame: end, endFrame: end + count, count,
      start: end / m.video.fps, duration: count / m.video.fps, requestedDuration: m.scenes[i].duration })
    end += count
  }
  return { fps: m.video.fps, frameCount: end, scenes }
}

export function reviewPositions(map) {
  if (!map || !Number.isInteger(map.fps) || map.fps < 1 || !map.scenes?.length) fail('INVALID_SCENE_MAP', 'A measured scene map is required')
  const samples = new Map()
  let end = 0
  const add = (frame, scene, role) => {
    const record = samples.get(frame) ?? { frame, time: frame / map.fps, scenes: [], roles: [] }
    if (!record.scenes.includes(scene.id)) record.scenes.push(scene.id)
    record.roles.push(`${scene.id}:${role}`)
    samples.set(frame, record)
  }
  for (const [i, scene] of map.scenes.entries()) {
    if (scene.startFrame !== end || !Number.isSafeInteger(scene.count) || scene.count < 1 || scene.endFrame !== end + scene.count) fail('INVALID_SCENE_MAP', 'Scene frame ranges must be positive and contiguous')
    add(end, scene, 'start'); add(end + Math.floor((scene.count - 1) / 2), scene, 'middle'); add(scene.endFrame - 1, scene, 'end')
    if (i) { add(end - 1, map.scenes[i - 1], 'before-cut'); add(end, scene, 'after-cut') }
    end = scene.endFrame
  }
  if (end !== map.frameCount) fail('INVALID_SCENE_MAP', 'Scene map total does not match measured frames')
  return [...samples.values()].sort((a, b) => a.frame - b.frame)
}

export async function createContactSheets(root, { output, sceneMap, expectedHash, font }, options = {}) {
  const file = jobPath(root, output), videoHash = hash(fs.readFileSync(file))
  if (expectedHash && videoHash !== expectedHash) fail('STALE_REVIEW', 'The video changed since feedback/review was requested')
  const inspect = options.inspect ?? probe, run = options.run ?? runTool, tools = options.tools ?? {}
  const metadata = await inspect(file, tools)
  if (frameCount(metadata, sceneMap.fps) !== sceneMap.frameCount) fail('INVALID_SCENE_MAP', 'Final MP4 frame count differs from the normalized scene map')
  const samples = reviewPositions(sceneMap), relative = `reviews/${randomUUID()}`, folder = jobPath(root, relative)
  fs.mkdirSync(path.join(folder, 'frames'), { recursive: true })
  try {
    await run(tools.ffmpeg ?? 'ffmpeg', ['-v', 'error', '-i', file, '-vf', `select=${samples.map((s) => `eq(n\\,${s.frame})`).join('+')}`, '-fps_mode', 'vfr', path.join(folder, 'frames/%06d.png')], { timeoutMs: 120_000 })
    samples.forEach((sample, i) => {
      sample.file = `${relative}/frames/${String(i + 1).padStart(6, '0')}.png`
      sample.hash = hash(fs.readFileSync(jobPath(root, sample.file)))
    })
    const browser = await (options.chromium ?? loadPlaywright(root).chromium).launch({ headless: true })
    const sheets = []
    try {
      const page = await browser.newPage({ viewport: { width: 1536, height: 1080 } })
      await page.route('**/*', (route) => /^(https?):/.test(route.request().url()) ? route.abort() : route.continue())
      for (let offset = 0; offset < samples.length; offset += 12) {
        const batch = samples.slice(offset, offset + 12), index = sheets.length + 1
        const cards = batch.map((s) => `<figure><img src="${pathToFileURL(jobPath(root, s.file)).href}" alt="Frame ${s.frame}"><figcaption><b>${escapeHtml(s.scenes.map((id) => sceneMap.scenes.find((scene) => scene.id === id).title).join(' / '))}</b><br>frame ${s.frame} · ${s.time.toFixed(3)}s<br>${escapeHtml(s.roles.join(' · '))}</figcaption></figure>`).join('')
        const html = `<!doctype html><html lang="th"><meta charset="utf-8"><title>Video contact sheet</title><style>${font ? `@font-face{font-family:Review;src:url(${JSON.stringify(pathToFileURL(jobPath(root, font)).href)})}` : ''}*{box-sizing:border-box}body{margin:0;padding:24px;background:#fff8ef;color:#282520;font:16px/1.5 ${font ? 'Review' : 'sans-serif'}}h1{font-size:24px;margin:0}header{margin-bottom:20px}section{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}figure{margin:0;background:white;border:1px solid #c9c2b8;border-radius:10px;overflow:hidden}img{display:block;width:100%}figcaption{padding:12px;font-size:16px;overflow-wrap:anywhere}</style><header><h1>Final video · Contact sheet ${index}</h1><div>${escapeHtml(output)} · SHA-256 ${videoHash}</div></header><section>${cards}</section></html>`
        const htmlFile = `${relative}/sheet-${index}.html`, image = `${relative}/sheet-${index}.png`
        fs.writeFileSync(jobPath(root, htmlFile), html)
        await page.goto(pathToFileURL(jobPath(root, htmlFile)).href)
        await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode())) })
        if (font && !await page.evaluate(() => document.fonts.load('16px Review', 'ไทย').then((faces) => faces.length > 0))) fail('MISSING_FONT', 'Contact-sheet font failed to load')
        await page.screenshot({ path: jobPath(root, image), fullPage: true, animations: 'disabled' })
        sheets.push({ file: image, hash: hash(fs.readFileSync(jobPath(root, image))), frames: batch.map((s) => s.frame) })
      }
    } finally { await browser.close() }
    if (hash(fs.readFileSync(file)) !== videoHash) fail('STALE_REVIEW', 'Final video changed during contact-sheet generation')
    const record = { status: 'complete', output, videoHash, sceneMap, samples, sheets, font: font ? { file: font, hash: hash(fs.readFileSync(jobPath(root, font))) } : 'system sans-serif; inspect actual glyphs', checks: { frameMapping: 'within one frame', watchingAndListening: 'required; not established by contact sheets' } }
    writeJson(root, `${relative}/review.json`, record)
    return { ...record, record: `${relative}/review.json` }
  } catch (error) {
    writeJson(root, `${relative}/incomplete.json`, { status: 'incomplete', output, videoHash, stage: 'contact-sheets', code: error.code ?? 'REVIEW_FAILED' })
    throw Object.assign(new Error('Contact sheets incomplete; preserve the MP4 and retry this stage'), { code: 'REVIEW_INCOMPLETE', cause: error })
  }
}

export async function verifyReviewPackage(root, record, { inspect = probe, tools = {} } = {}) {
  const file = jobPath(root, record.output)
  if (record.status !== 'complete' || hash(fs.readFileSync(file)) !== record.videoHash) fail('STALE_REVIEW', 'Contact sheets belong to a different final video')
  if (frameCount(await inspect(file, tools), record.sceneMap.fps) !== record.sceneMap.frameCount) fail('INVALID_SCENE_MAP', 'Final video frame count changed')
  const expected = reviewPositions(record.sceneMap).map((s) => s.frame)
  if (JSON.stringify(record.samples.map((s) => s.frame)) !== JSON.stringify(expected) || JSON.stringify(record.sheets.flatMap((s) => s.frames)) !== JSON.stringify(expected)) fail('STALE_REVIEW', 'Review package lost scene/cut coverage')
  if (record.samples.some((s) => Math.abs(s.time - s.frame / record.sceneMap.fps) > 1 / record.sceneMap.fps)) fail('STALE_REVIEW', 'Sample timestamp labels changed')
  for (const media of [...record.samples, ...record.sheets]) if (hash(fs.readFileSync(jobPath(root, media.file))) !== media.hash) fail('STALE_REVIEW', 'Review image bytes changed')
  return true
}
