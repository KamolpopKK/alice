import fs from 'node:fs'
import path from 'node:path'
import { hash, readJson, writeJson, jobPath, runTool, probe, validateManifest, fail, isMain, cliError } from './demo-core.mjs'

export async function listVoices({ python = 'python3', run = runTool } = {}) {
  const script = 'import asyncio,json,edge_tts; print(json.dumps(asyncio.run(edge_tts.list_voices())))'
  return JSON.parse((await run(python, ['-c', script], { timeoutMs: 30_000 })).stdout)
}

async function cueAudio(root, scene, cue, m, options) {
  const { python = 'python3', run = runTool, inspect = probe } = options
  const settings = m.narration
  let text = cue.text
  for (const [word, replacement] of Object.entries(m.pronunciations ?? {})) {
    if (!word || typeof replacement !== 'string') fail('INVALID_PRONUNCIATION', 'Pronunciations must map nonempty words to text')
    text = text.replaceAll(word, replacement)
  }
  const key = hash(JSON.stringify({ text, settings }))
  const stem = `media/audio/${scene.id}-${cue.id}-${key.slice(0, 16)}`
  const file = `${stem}.mp3`, recordFile = `${stem}.json`
  const target = jobPath(root, file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  if (fs.existsSync(jobPath(root, recordFile)) && fs.existsSync(target)) {
    const cached = readJson(jobPath(root, recordFile))
    if (cached.key === key && cached.hash === hash(fs.readFileSync(target))) {
      await inspect(target)
      return { ...cached, cached: true }
    }
  }
  const tmp = jobPath(root, `${stem}.partial.mp3`)
  if (settings.provider === 'provided') {
    if (!cue.audio) fail('MISSING_AUDIO', `Provide selected external narration: ${scene.title}`)
    fs.copyFileSync(jobPath(root, cue.audio), tmp)
  } else {
    const input = jobPath(root, `${stem}.txt`)
    fs.writeFileSync(input, text)
    if (settings.provider === 'gtts') {
      const script = 'import sys,json; from gtts import gTTS; s=json.loads(sys.argv[3]); gTTS(text=open(sys.argv[1],encoding="utf-8").read(),lang=s["language"],slow=s.get("slow",False),timeout=(10,60)).save(sys.argv[2])'
      await run(python, ['-c', script, input, tmp, JSON.stringify(settings)], { timeoutMs: 120_000 })
    } else {
      await run(python, ['-m', 'edge_tts', '--file', input, '--voice', settings.voice,
        `--rate=${settings.rate ?? '+0%'}`, `--volume=${settings.volume ?? '+0%'}`, `--pitch=${settings.pitch ?? '+0Hz'}`,
        '--write-media', tmp], { timeoutMs: 120_000 })
    }
  }
  const media = await inspect(tmp)
  if (!media.streams.some((s) => s.codec_type === 'audio')) fail('INVALID_AUDIO', 'Narration has no audio stream')
  fs.renameSync(tmp, target)
  const record = { key, file, hash: hash(fs.readFileSync(target)), duration: media.duration,
    provider: settings.provider, settings, text, subtitle: cue.subtitle ?? cue.text }
  writeJson(root, recordFile, record)
  return { ...record, cached: false }
}

export async function generateSample(root, manifest, { sceneId, cueId, ...options } = {}) {
  const m = validateManifest(manifest, root)
  if (!m.narration) return null
  const scene = m.scenes.find((s) => (!sceneId || s.id === sceneId) && s.cues?.length)
  const cue = scene?.cues.find((c) => !cueId || c.id === cueId)
  if (!cue) fail('MISSING_CUE', 'Choose a real script cue for the voice sample')
  return cueAudio(root, scene, cue, m, options)
}

export async function generateNarration(root, manifest, { sampleApproved = false, ...options } = {}) {
  const m = validateManifest(manifest, root)
  if (!m.narration) return { scenes: [], narration: null }
  if (!sampleApproved) fail('SAMPLE_APPROVAL_REQUIRED', 'Let the user listen and approve the voice sample before full narration')
  const scenes = []
  for (const scene of m.scenes) {
    let offset = 0
    const cues = []
    for (const cue of scene.cues ?? []) {
      const audio = await cueAudio(root, scene, cue, m, options)
      cues.push({ ...audio, id: cue.id, start: offset, end: offset + audio.duration })
      offset += audio.duration
    }
    if (offset > scene.duration + 0.001) fail('AUDIO_OVERRUN', `Speech exceeds the agreed duration: ${scene.title}; agree timing or script changes`)
    scenes.push({ id: scene.id, duration: offset, cues })
  }
  const result = { narration: m.narration, scenes }
  writeJson(root, 'audio.json', result)
  return result
}

if (isMain(import.meta.url)) {
  try {
    const [command, root, manifestFile, ...flags] = process.argv.slice(2)
    const options = { python: process.env.DEMO_PYTHON ?? 'python3' }
    if (command === 'voices') console.log(JSON.stringify(await listVoices(options), null, 2))
    else if (command === 'sample') console.log(JSON.stringify(await generateSample(root, readJson(manifestFile), options), null, 2))
    else if (command === 'generate') console.log(JSON.stringify(await generateNarration(root, readJson(manifestFile), { ...options, sampleApproved: flags.includes('--sample-approved') }), null, 2))
    else console.log('demo-audio.mjs voices | sample JOB MANIFEST.json | generate JOB MANIFEST.json --sample-approved\nDEMO_PYTHON selects the job Python environment. Set --sample-approved only after actual user approval.')
  } catch (error) { cliError(error) }
}
