import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { validateManifest, prepareStage, jobPath, writeJson, readJson, hash, probe, runTool, fail, visualHash, isMain, cliError } from './demo-core.mjs'
import { captureInputHash } from './demo-capture.mjs'
import { openHtmlScene, htmlInputHash } from './demo-html.mjs'
import { verifyAudio, makeSubtitles } from './demo-render.mjs'

function sampleAudio(root, m, scene, start, end) {
  if (!m.review.sound) return []
  if (!m.narration) fail('SAMPLE_AUDIO_REQUIRED', 'Sound was requested; use previously approved narration, never create a new voice implicitly')
  const audio = verifyAudio(root, m)
  return audio.scenes.find((s) => s.id === scene.id).cues.filter((cue) => {
    const offset = cue.start - cue.speechStart, finish = offset + cue.duration
    if (finish <= start || offset >= end) return false
    if (offset < start || finish > end) fail('SAMPLE_AUDIO_WOULD_CUT', 'Agree an excerpt that contains complete approved speech; never accelerate or cut it')
    return true
  }).map((cue) => ({ ...cue, offset: cue.start - cue.speechStart - start }))
}

export async function generateVisualSample(root, manifest, options = {}) {
  const m = validateManifest(manifest, root)
  if (m.version !== 2 || m.purpose !== 'sample') fail('SAMPLE_MANIFEST_REQUIRED', 'Use a v2 sample job; this operation never grants full production')
  const guard = await prepareStage(root, m, options, 'sample')
  const scene = m.scenes.find((s) => s.id === m.review.sceneId), start = m.review.start
  const video = m.review.mode === 'video5', fps = m.video.fps
  const duration = video ? 5 : Math.min(5, scene.duration - start)
  if (scene.duration - start < duration - 1e-8 || (video && duration !== 5)) fail('SAMPLE_EXCERPT_REQUIRED', 'Agree a representative five-second excerpt that fits the scene')
  if (!video && m.review.sound) fail('IMAGE_AUDIO_UNSUPPORTED', 'Image review does not audition narration; agree a separate voice sample or video review')
  const audio = video ? sampleAudio(root, m, scene, start, start + 5) : []
  const count = video ? 5 * fps : Math.ceil(duration * fps)
  const frames = video ? Array.from({ length: count }, (_, i) => i) : [...new Set([0, Math.floor((count - 1) / 2), count - 1])]
  const relative = `samples/${randomUUID()}`, folder = jobPath(root, relative)
  fs.mkdirSync(path.join(folder, 'frames'), { recursive: true })
  const samples = [], run = options.run ?? runTool, inspect = options.inspect ?? probe, ffmpeg = options.tools?.ffmpeg ?? 'ffmpeg'
  let captionFilter
  if (m.subtitles) {
    if (!m.font) fail('MISSING_FONT', 'Provide the same verified caption font as production')
    const measured = m.narration ? verifyAudio(root, m).scenes.find((s) => s.id === scene.id).cues : scene.cues ?? []
    const cues = measured.filter((c) => c.end > start && c.start < start + duration).map((c) => ({ ...c, start: Math.max(0, c.start - start), end: Math.min(duration, c.end - start) }))
    if (cues.length) {
      fs.writeFileSync(path.join(folder, 'captions.srt'), makeSubtitles({ ...m, narration: null, scenes: [{ ...scene, start: 0, duration, cues }] }, null))
      fs.mkdirSync(path.join(folder, 'fonts'))
      fs.copyFileSync(jobPath(root, m.font), path.join(folder, 'fonts', `selected${path.extname(m.font)}`))
      captionFilter = `subtitles=filename=${relative}/captions.srt:fontsdir=${relative}/fonts`
    }
  }
  let dependencyHash
  if (scene.type === 'html') {
    dependencyHash = htmlInputHash(root, m, scene)
    const { browser, page, render } = await openHtmlScene(root, m, scene, options)
    try {
      for (const frame of frames) {
        await render(start + frame / fps)
        const file = `${relative}/frames/${String(frame).padStart(6, '0')}.png`
        await page.screenshot({ path: jobPath(root, file), animations: 'disabled' })
        samples.push({ scene: scene.id, frame, sceneTime: start + frame / fps, time: scene.start + start + frame / fps, file, hash: hash(fs.readFileSync(jobPath(root, file))) })
      }
    } finally { await browser.close() }
  } else {
    // Reuse reviewed/supplied footage; this helper never launches an unrequested capture session.
    const capture = readJson(jobPath(root, `media/capture/${scene.id}.json`)), file = jobPath(root, capture.file)
    if ((m.version === 2 && capture.inputHash !== captureInputHash(root, m, scene)) || capture.hash !== hash(fs.readFileSync(file))) fail('STALE_CAPTURE', 'Captured media changed')
    const metadata = await inspect(file)
    const trim = capture.trimStart ?? 0
    if (metadata.duration + 1 / fps < trim + start + duration) fail('SAMPLE_EXCERPT_REQUIRED', 'Supplied footage is too short for the chosen excerpt')
    dependencyHash = capture.hash
    for (const frame of frames) {
      const output = `${relative}/frames/${String(frame).padStart(6, '0')}.png`
      await run(ffmpeg, ['-v', 'error', '-ss', String(trim + start + frame / fps), '-i', file, '-vf', `scale=${m.video.width}:${m.video.height}:force_original_aspect_ratio=decrease,pad=${m.video.width}:${m.video.height}:(ow-iw)/2:(oh-ih)/2`, '-frames:v', '1', jobPath(root, output)], { timeoutMs: 30_000 })
      samples.push({ scene: scene.id, frame, sceneTime: start + frame / fps, time: scene.start + start + frame / fps, file: output, hash: hash(fs.readFileSync(jobPath(root, output))) })
    }
  }
  if (!video && captionFilter) {
    for (const sample of samples) {
      const output = jobPath(root, sample.file + '.captioned.png')
      await run(ffmpeg, ['-v', 'error', '-i', jobPath(root, sample.file), '-vf', `setpts=PTS+${sample.frame / fps}/TB,${captionFilter}`, '-frames:v', '1', output], { cwd: root, timeoutMs: 30_000 })
      fs.renameSync(output, jobPath(root, sample.file))
      sample.hash = hash(fs.readFileSync(jobPath(root, sample.file)))
    }
  }
  let output, metadata
  if (video) {
    output = `${relative}/sample.mp4`
    const args = ['-v', 'error', '-nostdin', '-framerate', String(fps), '-i', path.join(folder, 'frames/%06d.png')]
    for (const cue of audio) args.push('-i', jobPath(root, cue.file))
    args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo')
    const filters = [`[${audio.length + 1}:a]atrim=duration=5[silence]`]
    audio.forEach((cue, i) => filters.push(`[${i + 1}:a]adelay=${Math.round(cue.offset * 1000)}:all=1[a${i}]`))
    filters.push(`[silence]${audio.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audio.length + 1}:normalize=0[audio]`)
    if (captionFilter) args.push('-vf', captionFilter)
    args.push('-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[audio]', '-frames:v', String(5 * fps), '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-threads', '2', '-c:a', 'aac', '-movflags', '+faststart', jobPath(root, output))
    await run(ffmpeg, args, { cwd: root, timeoutMs: 120_000 })
    metadata = await inspect(jobPath(root, output))
    const stream = metadata.streams.find((s) => s.codec_type === 'video')
    if (stream?.codec_name !== 'h264' || stream.width !== m.video.width || stream.height !== m.video.height || Number(stream?.nb_frames) !== 5 * fps || Math.abs(metadata.duration - 5) > 1 / fps) fail('INVALID_SAMPLE', 'Sample must contain exactly five seconds of frames')
  }
  if (scene.type === 'html' && dependencyHash !== htmlInputHash(root, m, scene)) fail('INPUT_CHANGED', 'Visual dependencies changed during sample generation')
  await guard()
  const record = { mode: m.review.mode, scene: scene.id, source: m.source, visualHash: visualHash(m), dependencyHash, start, duration, samples, output,
    outputHash: output ? hash(fs.readFileSync(jobPath(root, output))) : undefined, metadata,
    checks: { motionReview: video ? 'watch the actual video' : 'stills only; motion not verified', fullProductionApproved: false, sound: m.review.sound ? 'existing approved narration only' : 'no new narration' } }
  record.artifactHash = hash(JSON.stringify(record))
  writeJson(root, `${relative}/review.json`, record)
  return { ...record, record: `${relative}/review.json` }
}

if (isMain(import.meta.url)) {
  console.log('Use generateVisualSample(JOB, manifest, { readSource, authorize }) from a trusted agent runner. Fetch live source and supply actual sample authorization; manifest flags cannot grant consent.')
}
