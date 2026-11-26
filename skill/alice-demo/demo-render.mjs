import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { assertSourceRevision, prepareStage, manifestHash, validateManifest, snapshotSource, readJson, writeJson, jobPath, hash, probe, runTool, preflight, fail, isMain, cliError } from './demo-core.mjs'
import { verifyHtmlFrames } from './demo-html.mjs'
import { normalizedSceneMap, createContactSheets, visualQualityChecks, verifyReviewPackage } from './demo-review.mjs'
import { captureInputHash } from './demo-capture.mjs'
import { audioInputKey } from './demo-audio.mjs'

const timestamp = (seconds) => {
  const n = Math.round(seconds * 1000)
  return `${String(Math.floor(n / 3600000)).padStart(2, '0')}:${String(Math.floor(n / 60000) % 60).padStart(2, '0')}:${String(Math.floor(n / 1000) % 60).padStart(2, '0')},${String(n % 1000).padStart(3, '0')}`
}

export function makeSubtitles(manifest, audio) {
  const entries = []
  for (const scene of manifest.scenes) {
    const measured = audio?.scenes.find((s) => s.id === scene.id)
    const cues = manifest.narration ? measured?.cues ?? [] : scene.cues ?? []
    for (const cue of cues) {
      if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start || cue.end > scene.duration + 0.001) fail('INVALID_SUBTITLE', 'Subtitle cue is outside its scene')
      const text = cue.subtitle ?? cue.text
      entries.push(`${entries.length + 1}\n${timestamp(scene.start + cue.start)} --> ${timestamp(scene.start + cue.end)}\n${text}\n`)
    }
  }
  return entries.join('\n')
}

export async function verifyVideo(file, manifest, { inspect = probe } = {}) {
  const result = await inspect(file)
  const video = result.streams.find((s) => s.codec_type === 'video')
  const duration = manifest.scenes.reduce((n, s) => n + s.duration, 0)
  const rate = video?.avg_frame_rate?.split('/').map(Number)
  if (!video || video.codec_name !== 'h264' || video.width !== manifest.video.width || video.height !== manifest.video.height ||
      !rate || Math.abs(rate[0] / rate[1] - manifest.video.fps) > 0.01 || Math.abs(result.duration - duration) > 0.2 ||
      !result.streams.some((s) => s.codec_type === 'audio' && s.codec_name === 'aac')) fail('INVALID_OUTPUT', 'Output codec, size, timing or streams do not match the manifest')
  return { duration: result.duration, width: video.width, height: video.height, fps: rate[0] / rate[1], video: 'h264', audio: 'aac' }
}

export function aliceSourceReader(workspace, identity = 'codex', command = 'alice') {
  if (!workspace || !['codex', 'claude-code'].includes(identity)) fail('INVALID_SOURCE_READER', 'Select workspace and agent identity')
  return async (id) => {
    const { stdout } = await runTool(command, ['--as', identity, '--workspace', workspace, 'document', 'show', id, '--json'], { timeoutMs: 60_000 })
    const result = JSON.parse(stdout.slice(stdout.indexOf('{')))
    if (!result.ok) fail('SOURCE_UNAVAILABLE', 'Could not fetch the current storyboard')
    return result.data
  }
}

export function verifyAudio(root, manifest) {
  if (!manifest.narration) return null
  const audio = readJson(jobPath(root, 'audio.json'))
  if (JSON.stringify(audio.narration) !== JSON.stringify(manifest.narration)) fail('STALE_AUDIO', 'Narration settings changed; regenerate affected audio')
  for (const scene of manifest.scenes) {
    const measured = audio.scenes.find((s) => s.id === scene.id)
    if (!measured || measured.cues.length !== (scene.cues ?? []).length) fail('STALE_AUDIO', 'Narration cues changed')
    for (const [i, record] of measured.cues.entries()) {
      if (record.key !== audioInputKey(root, manifest, scene.cues[i]).key ||
          record.hash !== hash(fs.readFileSync(jobPath(root, record.file))) || record.subtitle !== (scene.cues[i].subtitle ?? scene.cues[i].text)) fail('STALE_AUDIO', 'Narration source or media changed')
    }
    if (measured.duration > scene.duration + 0.001) fail('AUDIO_OVERRUN', `Speech exceeds the agreed duration: ${scene.title}`)
  }
  return audio
}

export function packageSources(root, manifest, runDirectory, normalizedClips) {
  const folder = jobPath(root, `${runDirectory}/source-package`)
  fs.mkdirSync(path.join(folder, 'scenes'), { recursive: true })
  const copy = (relative) => {
    if (/(^|\/)(\.env[^/]*|\.auth[^/]*|storage-state[^/]*|cookies[^/]*)$/i.test(relative)) fail('PRIVATE_SOURCE', 'Do not package private authentication files')
    const input = jobPath(root, relative)
    if (!fs.statSync(input).isFile()) fail('INVALID_SOURCE_FILE', 'Package sources must be explicit files')
    const output = path.join(folder, 'originals', relative)
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.copyFileSync(input, output)
  }
  for (const file of ['source.json', 'manifest.json']) copy(file)
  for (const file of new Set([...(manifest.assets ?? []), ...(manifest.font ? [manifest.font] : []), ...(manifest.visual?.dependencies ?? []), ...manifest.scenes.flatMap((s) => s.dependencies ?? [])])) copy(file)
  for (const scene of manifest.scenes) for (const key of ['html', 'actions', 'media']) if (scene[key]) copy(scene[key])
  const audioFile = jobPath(root, 'audio.json')
  if (manifest.narration && fs.existsSync(audioFile)) {
    copy('audio.json')
    for (const scene of readJson(audioFile).scenes) for (const cue of scene.cues) copy(cue.file)
  }
  for (const [index, clip] of normalizedClips.entries()) fs.copyFileSync(jobPath(root, clip), path.join(folder, 'scenes', `${index}.mp4`))
  fs.writeFileSync(path.join(folder, 'concat.txt'), normalizedClips.map((_, i) => `file 'scenes/${i}.mp4'`).join('\n') + '\n')
  if (manifest.subtitles) {
    fs.copyFileSync(jobPath(root, `${runDirectory}/captions.srt`), path.join(folder, 'captions.srt'))
    fs.mkdirSync(path.join(folder, 'fonts'))
    fs.copyFileSync(jobPath(root, manifest.font), path.join(folder, 'fonts', `selected${path.extname(manifest.font)}`))
  }
  if (manifest.version === 2) {
    const helpers = path.join(folder, 'helpers')
    fs.mkdirSync(helpers)
    const sourceFolder = path.dirname(fileURLToPath(import.meta.url))
    const inventory = []
    const names = ['demo-core.mjs', 'demo-audio.mjs', 'demo-capture.mjs', 'demo-html.mjs', 'demo-render.mjs', 'demo-styles.mjs', 'demo-motion.mjs', 'demo-visual.mjs', 'demo-review.mjs', 'scene-template.html', 'SKILL.md', 'TEMPLATE.md', 'PRODUCTION.md', 'DOCUMENT-KNOWLEDGE.md', 'OUTPUT-FORMATS.md', 'PROJECT-FILES.md']
    for (const file of names) {
      let input = path.join(sourceFolder, file)
      // Repository helpers inherit the public guides already included in installed skills.
      if (!fs.existsSync(input) && path.basename(path.dirname(sourceFolder)) === 'skill' && ['DOCUMENT-KNOWLEDGE.md', 'OUTPUT-FORMATS.md', 'PROJECT-FILES.md'].includes(file)) input = path.join(sourceFolder, '../_shared', file)
      if (!fs.existsSync(input) || !fs.statSync(input).isFile()) fail('MISSING_HELPER', 'Source package requires the complete public helper closure')
      fs.copyFileSync(input, path.join(helpers, file))
      inventory.push({ file, hash: hash(fs.readFileSync(input)) })
    }
    fs.writeFileSync(path.join(folder, 'helper-versions.json'), JSON.stringify(inventory, null, 2))
  }
  const reproduce = `import fs from 'node:fs'\nimport path from 'node:path'\nimport {fileURLToPath} from 'node:url'\nimport {spawnSync} from 'node:child_process'\nconst root=path.dirname(fileURLToPath(import.meta.url))\nconst output=path.resolve(root,process.argv[2]??'reproduced.mp4')\nif(fs.existsSync(output)) throw new Error('Choose a new output path')\nconst args=['-v','error','-f','concat','-safe','1','-i','concat.txt',${manifest.subtitles ? "'-vf','subtitles=filename=captions.srt:fontsdir=fonts','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-c:a','copy'," : "'-c','copy',"}'-movflags','+faststart',output]\nconst r=spawnSync(process.env.DEMO_FFMPEG??'ffmpeg',args,{cwd:root,stdio:'inherit',timeout:3600000,shell:false})\nif(r.error||r.status!==0) throw new Error('Reproduction failed')\n`
  fs.writeFileSync(path.join(folder, 'reproduce.mjs'), reproduce)
  fs.writeFileSync(path.join(folder, 'README.txt'), 'Run node reproduce.mjs [NEW_OUTPUT.mp4] with FFmpeg available. Saved normalized clips reproduce assembly without contacting TTS or opening the original app. Original storyboard, scripts, settings and media are in originals/. Recapture may differ. Inspect every file for secrets before sharing.\n')
  fs.writeFileSync(path.join(folder, 'pronunciations.json'), JSON.stringify(manifest.pronunciations ?? {}, null, 2))
  return path.relative(fs.realpathSync(root), folder)
}

export async function renderVideo(root, manifest, { readSource, authorize, tools = {}, run = runTool, inspect = probe, checkTools = preflight } = {}) {
  const m = validateManifest(manifest, root)
  const stageGuard = await prepareStage(root, m, { readSource, authorize }, 'production')
  if (typeof readSource !== 'function') fail('FRESH_SOURCE_REQUIRED', 'Provide a reader which fetches the actual current storyboard')
  const saved = snapshotSource(readJson(jobPath(root, 'source.json')))
  assertSourceRevision(m.source, saved)
  const guard = async () => assertSourceRevision(saved, await readSource(saved.id))
  await guard()
  const versions = await checkTools(root, m, tools)
  const audio = verifyAudio(root, m)
  const runDirectory = `runs/${randomUUID()}`
  const directory = jobPath(root, runDirectory)
  fs.mkdirSync(directory, { recursive: true })
  writeJson(root, 'manifest.json', m)
  const ffmpeg = tools.ffmpeg ?? 'ffmpeg'
  const clips = [], cache = []
  const started = Date.now()
  for (const [index, scene] of m.scenes.entries()) {
    await guard()
    const args = ['-v', 'error', '-nostdin']
    let mediaFingerprint
    if (scene.type === 'html') {
      const frames = readJson(jobPath(root, `media/frames/${scene.id}.json`))
      verifyHtmlFrames(root, m, scene, frames)
      mediaFingerprint = { inputHash: frames.inputHash, frameHashes: frames.frameHashes }
      args.push('-framerate', String(m.video.fps), '-i', jobPath(root, `${frames.directory}/%06d.png`))
    } else {
      const capture = readJson(jobPath(root, `media/capture/${scene.id}.json`))
      if ((m.version === 2 && capture.inputHash !== captureInputHash(root, m, scene)) || capture.hash !== hash(fs.readFileSync(jobPath(root, capture.file)))) fail('STALE_CAPTURE', 'Captured footage changed')
      mediaFingerprint = { hash: capture.hash, inputHash: capture.inputHash, trimStart: capture.trimStart ?? 0 }
      args.push('-ss', String(capture.trimStart ?? 0), '-i', jobPath(root, capture.file))
    }
    const cues = audio?.scenes.find((s) => s.id === scene.id)?.cues ?? []
    for (const cue of cues) args.push('-i', jobPath(root, cue.file))
    if (!cues.length) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo')
    const filters = []
    if (cues.length) {
      for (let i = 0; i < cues.length; i++) filters.push(`[${i + 1}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`)
      filters.push(`${cues.map((_, i) => `[a${i}]`).join('')}concat=n=${cues.length}:v=0:a=1,apad,atrim=duration=${scene.duration}[audio]`)
    } else filters.push(`[1:a]atrim=duration=${scene.duration}[audio]`)
    const output = `${runDirectory}/scene-${index}.mp4`
    args.push('-filter_complex', filters.join(';'), '-map', '0:v:0', '-map', '[audio]', '-vf',
      `scale=${m.video.width}:${m.video.height}:force_original_aspect_ratio=decrease,pad=${m.video.width}:${m.video.height}:(ow-iw)/2:(oh-ih)/2,tpad=stop_mode=clone:stop_duration=${scene.duration},trim=duration=${scene.duration},setpts=PTS-STARTPTS,fps=${m.video.fps}`,
      '-t', String(scene.duration), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-threads', '2', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', jobPath(root, output))
    const key = hash(JSON.stringify({ video: m.video, duration: scene.duration, media: mediaFingerprint, cues: cues.map((c) => ({ hash: c.hash, duration: c.duration, start: c.start, end: c.end, speechStart: c.speechStart, speechEnd: c.speechEnd })), versions,
      helper: hash(fs.readFileSync(fileURLToPath(import.meta.url))) }))
    const recordPath = `media/clips/${scene.id}.json`
    let previous, reused = false
    if (m.version === 2 && fs.existsSync(jobPath(root, recordPath))) {
      try {
        previous = readJson(jobPath(root, recordPath))
        if (previous.key === key && previous.hash === hash(fs.readFileSync(jobPath(root, previous.file)))) {
          fs.copyFileSync(jobPath(root, previous.file), jobPath(root, output))
          reused = true
        }
      } catch (error) {
        if (!['ENOENT', 'INVALID_PATH'].includes(error.code) && !(error instanceof SyntaxError)) throw error
      }
    }
    if (!reused) await run(ffmpeg, args, { cwd: root, timeoutMs: 3_600_000 })
    await guard()
    if (m.version === 2) {
      const record = { key, file: output, hash: hash(fs.readFileSync(jobPath(root, output))), cached: reused,
        createdFrom: reused ? previous.createdFrom : m.source, validatedFor: m.source }
      cache.push({ scene: scene.id, ...record })
    }
    clips.push(output)
  }
  const sceneMap = m.version === 2 ? await normalizedSceneMap(root, m, clips, { inspect, tools }) : undefined
  fs.writeFileSync(path.join(directory, 'concat.txt'), clips.map((_, i) => `file 'scene-${i}.mp4'`).join('\n') + '\n')
  const temporary = path.join(directory, 'video.partial.mp4')
  const args = ['-v', 'error', '-nostdin', '-f', 'concat', '-safe', '1', '-i', path.join(directory, 'concat.txt')]
  if (m.subtitles) {
    fs.writeFileSync(path.join(directory, 'captions.srt'), makeSubtitles(sceneMap ? { ...m, scenes: m.scenes.map((s, i) => ({ ...s, start: sceneMap.scenes[i].start })) } : m, audio))
    fs.mkdirSync(path.join(directory, 'fonts'))
    fs.copyFileSync(jobPath(root, m.font), path.join(directory, 'fonts', `selected${path.extname(m.font)}`))
    args.push('-vf', `subtitles=filename=${runDirectory}/captions.srt:fontsdir=${runDirectory}/fonts`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-threads', '2', '-c:a', 'copy')
  } else args.push('-c', 'copy')
  args.push('-movflags', '+faststart', temporary)
  await run(ffmpeg, args, { cwd: root, timeoutMs: 3_600_000 })
  const metadata = await verifyVideo(temporary, m, { inspect: (file) => inspect(file, tools) })
  await guard()
  await stageGuard()
  if (m.version === 2) {
    verifyAudio(root, m)
    for (const clip of cache) if (clip.hash !== hash(fs.readFileSync(jobPath(root, clip.file)))) fail('STALE_CLIP', 'Normalized clip changed during assembly')
    for (const scene of m.scenes) {
      if (scene.type === 'html') verifyHtmlFrames(root, m, scene, readJson(jobPath(root, `media/frames/${scene.id}.json`)))
      else {
        const capture = readJson(jobPath(root, `media/capture/${scene.id}.json`))
        if ((m.version === 2 && capture.inputHash !== captureInputHash(root, m, scene)) || capture.hash !== hash(fs.readFileSync(jobPath(root, capture.file)))) fail('STALE_CAPTURE', 'Capture bytes changed during assembly')
      }
    }
  }
  for (const clip of cache) writeJson(root, `media/clips/${clip.scene}.json`, clip)
  const output = `${runDirectory}/video.mp4`
  fs.renameSync(temporary, jobPath(root, output))
  let review, qa, sourcePackage
  try {
    if (m.version === 2) {
      review = await createContactSheets(root, { output, sceneMap, font: m.font, source: m.source, inputHash: manifestHash(m) }, { tools, inspect, run })
      qa = await visualQualityChecks(root, m, output, { tools, run })
      await stageGuard()
      await verifyReviewPackage(root, review, { tools, inspect })
    }
    sourcePackage = packageSources(root, m, runDirectory, clips)
    if (review) {
      fs.copyFileSync(jobPath(root, review.record), jobPath(root, `${sourcePackage}/review.json`))
      writeJson(root, `${sourcePackage}/visual-qa.json`, qa)
    }
    await guard()
    await stageGuard()
  } catch (error) {
    writeJson(root, `${runDirectory}/incomplete.json`, { output, source: m.source, status: 'incomplete', stage: 'review-package', code: error.code ?? 'PACKAGE_FAILED' })
    throw Object.assign(new Error(`Review package incomplete; MP4 preserved at ${output}`), { code: error.code ?? 'PACKAGE_FAILED', cause: error })
  }
  const result = { output, sourcePackage, source: { id: saved.id, title: saved.title, revision: saved.revision, hash: saved.hash }, metadata,
    elapsedMs: Date.now() - started, versions, ...(m.version === 2 ? { cache, sceneMap, review, qa, videoHash: review.videoHash } : {}), checks: { metadata: 'passed', visualAndListening: 'required before delivery', sourceRevision: 'matched at final read; no lock' } }
  writeJson(root, `${runDirectory}/report.json`, result)
  fs.copyFileSync(jobPath(root, `${runDirectory}/report.json`), jobPath(root, `${sourcePackage}/report.json`))
  if (m.version === 2) writeJson(root, 'latest.json', { output, videoHash: review.videoHash, report: `${runDirectory}/report.json`, source: m.source, inputHash: manifestHash(m) })
  return result
}

if (isMain(import.meta.url)) {
  try {
    const [command, root, file, workspace, identity = 'codex'] = process.argv.slice(2)
    if (command === 'render') console.log(JSON.stringify(await renderVideo(root, readJson(file), { readSource: aliceSourceReader(workspace, identity),
      tools: { ffmpeg: process.env.DEMO_FFMPEG ?? 'ffmpeg', ffprobe: process.env.DEMO_FFPROBE ?? 'ffprobe', python: process.env.DEMO_PYTHON ?? 'python3' } }), null, 2))
    else console.log('demo-render.mjs render JOB MANIFEST.json WORKSPACE [codex|claude-code]\nFetches live Alice Documents at stage guards. Requires prior production approval. DEMO_FFMPEG/DEMO_FFPROBE/DEMO_PYTHON select installed job tools; never bypass host permissions.')
  } catch (error) { cliError(error) }
}
