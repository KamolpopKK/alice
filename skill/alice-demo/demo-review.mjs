import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { hash, jobPath, writeJson, probe, runTool, loadPlaywright, fail, manifestHash, readJson } from './demo-core.mjs'
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

export async function createContactSheets(root, { output, sceneMap, expectedHash, font, source, inputHash }, options = {}) {
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
        const height = await page.locator('body').evaluate((body) => Math.ceil(body.getBoundingClientRect().height))
        await page.setViewportSize({ width: 1536, height: Math.max(100, height) })
        await page.screenshot({ path: jobPath(root, image), fullPage: true, animations: 'disabled' })
        sheets.push({ file: image, hash: hash(fs.readFileSync(jobPath(root, image))), frames: batch.map((s) => s.frame) })
      }
    } finally { await browser.close() }
    if (hash(fs.readFileSync(file)) !== videoHash) fail('STALE_REVIEW', 'Final video changed during contact-sheet generation')
    const record = { status: 'complete', output, videoHash, source, inputHash, sceneMap, samples, sheets, font: font ? { file: font, hash: hash(fs.readFileSync(jobPath(root, font))) } : 'system sans-serif; inspect actual glyphs', checks: { frameMapping: 'within one frame', watchingAndListening: 'required; not established by contact sheets' } }
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

export async function visualQualityChecks(root, m, output, { run = runTool, tools = {}, chromium } = {}) {
  const file = jobPath(root, output), videoHash = hash(fs.readFileSync(file)), warnings = [], unknown = [], geometry = []
  let temporal
  try {
    const result = await run(tools.ffmpeg ?? 'ffmpeg', ['-hide_banner', '-i', file, '-vf', 'blackdetect=d=0.1:pix_th=0.1,freezedetect=n=-60dB:d=2', '-an', '-f', 'null', '-'], { timeoutMs: 120_000 })
    temporal = result.stderr.split('\n').filter((line) => /black_start:|freeze_start:|freeze_end:/.test(line)).map((line) => line.replace(/^.*?(black_start:|freeze_start:|freeze_end:)/, '$1'))
    if (temporal.length) warnings.push('Black/frozen ranges detected; review whether they are intentional holds or transitions')
  } catch { unknown.push('Temporal black/freeze scan unavailable; inspect actual video') }
  const { openHtmlScene } = await import('./demo-html.mjs')
  for (const scene of m.scenes.filter((s) => s.type === 'html')) {
    const { browser, page, render } = await openHtmlScene(root, m, scene, { chromium })
    try {
      await render(Math.min(scene.duration - 1 / m.video.fps, Math.max(scene.duration / 2, 1.2)))
      const measured = await page.evaluate((captions) => {
        const issues = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) {
          if (!node.textContent.trim() || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(node.parentElement.tagName)) continue
          const range = document.createRange(); range.selectNodeContents(node)
          for (const r of range.getClientRects()) {
            if (r.width === 0 || r.height === 0) continue
            if (r.left < 0 || r.top < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) issues.push({ kind: 'text-overflow', text: node.textContent.slice(0, 120), bounds: { x: r.x, y: r.y, width: r.width, height: r.height } })
            else if (captions && r.bottom > innerHeight * 0.86) issues.push({ kind: 'caption-safe-area', text: node.textContent.slice(0, 120) })
          }
        }
        return { issues, canvasCount: document.querySelectorAll('canvas').length, fontsLoaded: document.fonts.status === 'loaded' }
      }, m.subtitles)
      geometry.push({ scene: scene.id, ...measured })
      if (measured.issues.length) warnings.push(`Review ${scene.id}: text overflow or caption safe area`)
      if (measured.canvasCount) unknown.push(`${scene.id}: canvas text cannot be measured by DOM geometry`)
    } finally { await browser.close() }
  }
  const luminance = (hex) => {
    const rgb = hex.slice(1).match(/../g).map((s) => parseInt(s, 16) / 255).map((x) => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
  }
  const a = luminance(m.visual.palette.background), b = luminance(m.visual.palette.foreground)
  const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  if (contrast < 4.5) warnings.push('Primary palette contrast is below 4.5:1; inspect actual type sizes and rendered text')
  if (hash(fs.readFileSync(file)) !== videoHash) fail('STALE_REVIEW', 'Video changed during visual checks')
  return { videoHash, geometry, temporal, contrast, warnings, unknown,
    manualRequired: ['watch actual final video for pacing/style/discontinuity', 'inspect Thai and technical glyphs, captions and scene seams', ...(m.narration ? ['listen to actual narration for complete speech and pronunciation'] : [])],
    verdict: 'automated evidence only; no universal quality pass or listening claim' }
}

const sceneFields = ['title', 'onScreenText', 'steps', 'duration', 'cues', 'html', 'media', 'actions']
const globalFields = ['visual', 'font', 'assets', 'narration', 'pronunciations', 'subtitles', 'order']
function assertLatestReview(root, review) {
  const latest = jobPath(root, 'latest.json')
  if (fs.existsSync(latest) && readJson(latest).videoHash !== review.videoHash) fail('STALE_FEEDBACK', 'Feedback refers to an older output; reconcile against the latest preview before applying it')
}

export async function proposeFeedback(root, before, review, proposals) {
  await verifyReviewPackage(root, review)
  assertLatestReview(root, review)
  if (review.inputHash !== manifestHash(before) || review.source?.hash !== before.source.hash) fail('STALE_FEEDBACK', 'Use the exact manifest and source which produced the reviewed output')
  if (!Array.isArray(proposals) || !proposals.length || new Set(proposals.map((p) => p.id)).size !== proposals.length) fail('INVALID_FEEDBACK', 'Provide uniquely named feedback proposals')
  const items = proposals.map((p) => {
    const scene = p.sceneId ? before.scenes.find((s) => s.id === p.sceneId) : null
    const mapped = scene && review.sceneMap.scenes.find((s) => s.id === scene.id)
    if (!/^[\w-]{1,80}$/.test(p.id ?? '') || typeof p.reason !== 'string' || !p.reason.trim() || !Object.hasOwn(p, 'value') ||
        (p.sceneId ? !scene || !sceneFields.includes(p.field) : !globalFields.includes(p.field)) ||
        (p.intent !== undefined && !['story', 'implementation'].includes(p.intent)) ||
        (p.intent === 'implementation' && !['html', 'media', 'actions', 'font', 'assets'].includes(p.field)) ||
        (p.time !== undefined && (!mapped || !Number.isFinite(p.time) || p.time < mapped.startFrame / review.sceneMap.fps || p.time >= mapped.endFrame / review.sceneMap.fps))) fail('INVALID_FEEDBACK', 'Feedback must identify an actual scene/time and an allowed change')
    return { ...structuredClone(p), affects: p.sceneId ? [p.sceneId] : before.scenes.map((s) => s.id),
      impact: p.field === 'duration' || p.field === 'order' ? 'assembly, captions, scene map and audio-fit checks' : p.field === 'narration' || p.field === 'cues' ? 'affected voice/cues, audio-fit and assembly; preserve voice consent' : 'dependent visual media, assembly and fresh contact sheets',
      sourceUpdateRequired: p.intent !== 'implementation' }
  })
  const plan = { videoHash: review.videoHash, output: review.output, source: before.source, proposals: items }
  return { ...plan, hash: hash(JSON.stringify(plan)) }
}

export async function applyFeedback(root, before, review, plan, approvedIds, { readSource, authorize } = {}) {
  await verifyReviewPackage(root, review)
  assertLatestReview(root, review)
  if (review.inputHash !== manifestHash(before)) fail('STALE_FEEDBACK', 'Original inputs changed after this output was reviewed')
  const checked = await proposeFeedback(root, before, review, plan.proposals)
  if (checked.hash !== plan.hash) fail('STALE_FEEDBACK', 'Proposal fields or impacts changed')
  const { hash: expected, ...body } = plan
  if (hash(JSON.stringify(body)) !== expected || plan.videoHash !== review.videoHash || before.source.hash !== plan.source.hash) fail('STALE_FEEDBACK', 'Reconcile feedback with the exact source and output viewed')
  if (!Array.isArray(approvedIds) || !approvedIds.length || new Set(approvedIds).size !== approvedIds.length || approvedIds.some((id) => !plan.proposals.some((p) => p.id === id))) fail('INVALID_FEEDBACK', 'Approve only explicitly listed proposal ids')
  if (typeof readSource !== 'function' || typeof authorize !== 'function') fail('APPROVAL_REQUIRED', 'Fresh authoritative source and actual approved feedback subset are required')
  const { snapshotSource, validateManifest } = await import('./demo-core.mjs')
  const source = snapshotSource(await readSource(before.source.id))
  const sourceEditRequired = plan.proposals.some((p) => approvedIds.includes(p.id) && p.sourceUpdateRequired)
  if (source.id !== before.source.id || source.revision < before.source.revision || (sourceEditRequired && (source.hash === before.source.hash || source.revision <= before.source.revision))) fail('SOURCE_UPDATE_REQUIRED', 'Save agreed substantive changes in the original storyboard before applying feedback')
  const binding = { stage: 'feedback', source, videoHash: review.videoHash, planHash: plan.hash, approvedIds: [...approvedIds] }
  const evidence = await authorize(binding)
  if (!evidence || evidence.stage !== 'feedback' || evidence.sourceHash !== source.hash || evidence.videoHash !== review.videoHash || evidence.planHash !== plan.hash ||
      JSON.stringify(evidence.approvedIds) !== JSON.stringify(approvedIds) || typeof evidence.reference !== 'string' || !evidence.reference.trim()) fail('APPROVAL_REQUIRED', 'Actual user consent must cover the proposed impact and exact approved subset')
  const next = structuredClone(before), applied = plan.proposals.filter((p) => approvedIds.includes(p.id))
  next.source = source
  for (const change of applied) {
    if (change.sceneId) next.scenes.find((s) => s.id === change.sceneId)[change.field] = structuredClone(change.value)
    else if (change.field === 'order') {
      if (!Array.isArray(change.value) || change.value.length !== next.scenes.length || new Set(change.value).size !== next.scenes.length || change.value.some((id) => !next.scenes.some((s) => s.id === id))) fail('INVALID_FEEDBACK', 'Scene order must contain every scene exactly once')
      next.scenes = change.value.map((id) => next.scenes.find((s) => s.id === id))
    } else next[change.field] = structuredClone(change.value)
  }
  let start = 0
  for (const scene of next.scenes) { scene.start = start; start += scene.duration }
  const needsVisualReview = applied.some((c) => ['visual', 'font', 'assets'].includes(c.field))
  if (needsVisualReview) { next.purpose = 'sample'; delete next.review.artifactHash }
  validateManifest(next, root)
  const latest = snapshotSource(await readSource(source.id))
  if (latest.hash !== source.hash) fail('SOURCE_CHANGED', 'Storyboard changed while applying feedback')
  return { manifest: next, appliedIds: approvedIds, unappliedIds: plan.proposals.filter((p) => !approvedIds.includes(p.id)).map((p) => p.id),
    needsVisualReview, source, previousVideoHash: review.videoHash, authorizationReference: evidence.reference,
    nextStep: 'Agent synchronizes affected HTML/assets with this source, obtains affected sample/voice/full-production approvals, then rerenders; no production is authorized by this result' }
}
