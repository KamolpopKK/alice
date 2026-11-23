import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

export const hash = (value) => createHash('sha256').update(value).digest('hex')
export const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
export function fail(code, message) {
  throw Object.assign(new Error(message), { code })
}

export function snapshotSource(input) {
  const doc = input?.data ?? input
  if (!doc || typeof doc.id !== 'string' || !doc.id || typeof doc.title !== 'string' ||
      typeof doc.body !== 'string' || !Number.isSafeInteger(doc.revision) || doc.revision < 1) {
    fail('INVALID_SOURCE', 'A fresh full Alice Document with id, title, body and revision is required')
  }
  const source = { id: doc.id, title: doc.title, body: doc.body, revision: doc.revision }
  return { ...source, hash: hash(JSON.stringify(source)) }
}

export function assertSourceRevision(expected, fresh) {
  const actual = snapshotSource(fresh)
  if (expected.id !== actual.id || expected.revision !== actual.revision || expected.hash !== actual.hash) {
    fail('SOURCE_CHANGED', 'Storyboard changed; stop and agree the source before continuing')
  }
  return actual
}

export function jobPath(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0') || path.isAbsolute(relative) || relative.includes('\\')) {
    fail('INVALID_PATH', 'Use a relative path inside the job directory')
  }
  const base = fs.realpathSync(root)
  const target = path.resolve(base, relative)
  const within = (candidate) => candidate === base || candidate.startsWith(base + path.sep)
  if (!within(target)) fail('INVALID_PATH', 'Path escapes the job directory')
  let existing = target
  while (true) {
    try { fs.lstatSync(existing); break } catch (error) {
      if (error.code !== 'ENOENT') throw error
      existing = path.dirname(existing)
    }
  }
  if (!within(fs.realpathSync(existing))) fail('INVALID_PATH', 'Symlink escapes the job directory')
  return target
}

export function writeJson(root, relative, value) {
  const target = jobPath(root, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const tmp = target + '.partial'
  fs.writeFileSync(jobPath(root, path.relative(fs.realpathSync(root), tmp)), JSON.stringify(value, null, 2) + '\n')
  fs.renameSync(tmp, target)
}

const validId = (v) => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(v)
export function validateManifest(manifest, root) {
  const m = manifest
  if (m?.version !== 1 || !m.source || !/^[a-f0-9]{64}$/.test(m.source.hash ?? '') ||
      !m.source.id || !Number.isSafeInteger(m.source.revision) || m.source.revision < 1) fail('INVALID_MANIFEST', 'Invalid manifest source/version')
  const v = m.video
  if (!v || ![v.width, v.height].every((n) => Number.isInteger(n) && n >= 16 && n <= 7680 && n % 2 === 0) ||
      !Number.isInteger(v.fps) || v.fps < 1 || v.fps > 60) fail('INVALID_MANIFEST', 'Invalid video dimensions or fps')
  if (m.narration !== null && (!m.narration || !['gtts', 'edge-tts', 'provided'].includes(m.narration.provider) ||
      typeof m.narration.language !== 'string' || !m.narration.language)) fail('INVALID_MANIFEST', 'Choose narration settings or null')
  if (m.narration?.provider === 'edge-tts' && !m.narration.voice) fail('INVALID_MANIFEST', 'An available edge-tts voice must be selected')
  if (typeof m.subtitles !== 'boolean' || !Array.isArray(m.scenes) || !m.scenes.length) fail('INVALID_MANIFEST', 'Scenes and subtitle choice are required')
  const ids = new Set()
  let end = 0
  for (const s of m.scenes) {
    if (!validId(s.id) || ids.has(s.id) || typeof s.title !== 'string' || !s.title || !['capture', 'html'].includes(s.type) ||
        !Number.isFinite(s.duration) || s.duration <= 0 || !Number.isFinite(s.start) || Math.abs(s.start - end) > 0.001) {
      fail('INVALID_MANIFEST', `Invalid or non-contiguous scene: ${String(s.id).slice(0, 80)}`)
    }
    ids.add(s.id)
    end += s.duration
    if (s.type === 'html' && !s.html) fail('INVALID_MANIFEST', `Missing HTML page: ${s.id}`)
    if (s.type === 'capture' && !s.media && !s.url) fail('INVALID_MANIFEST', `Missing capture source: ${s.id}`)
    if (s.url && !['http:', 'https:'].includes(new URL(s.url).protocol)) fail('INVALID_MANIFEST', `Invalid URL: ${s.id}`)
    for (const key of ['html', 'media', 'actions']) if (s[key]) jobPath(root, s[key])
    if (s.cues !== undefined && !Array.isArray(s.cues)) fail('INVALID_MANIFEST', `Invalid speech cues: ${s.id}`)
    const cues = new Set()
    for (const c of s.cues ?? []) {
      if (!validId(c.id) || cues.has(c.id) || typeof c.text !== 'string' || !c.text.trim()) fail('INVALID_MANIFEST', `Invalid speech cue: ${s.id}`)
      cues.add(c.id)
      if (c.audio) jobPath(root, c.audio)
      if (c.subtitle !== undefined && typeof c.subtitle !== 'string') fail('INVALID_MANIFEST', `Invalid subtitle: ${s.id}`)
    }
    if (!m.narration && (s.cues ?? []).some((c) => !Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.end <= c.start || c.end > s.duration)) {
      fail('INVALID_MANIFEST', `Silent subtitle cues need explicit scene-relative times: ${s.id}`)
    }
  }
  return m
}

export function runTool(command, args, { cwd, timeoutMs = 30_000, maxBytes = 4_000_000, env = process.env } = {}) {
  if (!Array.isArray(args) || !args.every((a) => typeof a === 'string') || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    fail('INVALID_COMMAND', 'Tool arguments and a finite positive timeout are required')
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', size = 0, reason
    const timer = setTimeout(() => { reason = 'TOOL_TIMEOUT'; child.kill('SIGKILL') }, timeoutMs)
    for (const [stream, type] of [[child.stdout, 'out'], [child.stderr, 'err']]) stream.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) { reason = 'TOOL_OUTPUT_LIMIT'; child.kill('SIGKILL'); return }
      if (type === 'out') stdout += chunk.toString(); else stderr += chunk.toString()
    })
    child.on('error', () => { clearTimeout(timer); reject(Object.assign(new Error('Required tool could not start'), { code: 'TOOL_UNAVAILABLE' })) })
    child.on('close', (status) => {
      clearTimeout(timer)
      if (reason || status !== 0) reject(Object.assign(new Error(`Tool failed (${reason ?? status}); inspect the stage without exposing credentials`), { code: reason ?? 'TOOL_FAILED' }))
      else resolve({ stdout, stderr })
    })
  })
}

export function loadPlaywright(root) {
  const require = createRequire(path.join(path.resolve(root), 'package.json'))
  try { return require('playwright') } catch { return require('@playwright/test') }
}

export async function probe(file, tools = {}) {
  const { stdout } = await runTool(tools.ffprobe ?? 'ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file])
  const result = JSON.parse(stdout)
  const duration = Number(result.format?.duration)
  if (!Number.isFinite(duration) || duration <= 0) fail('INVALID_MEDIA', 'Media has no positive measured duration')
  return { ...result, duration }
}

export async function preflight(root, m, tools = {}) {
  validateManifest(m, root)
  const versions = {}
  for (const name of ['ffmpeg', 'ffprobe']) versions[name] = (await runTool(tools[name] ?? name, ['-version'])).stdout.split('\n')[0]
  const encoders = (await runTool(tools.ffmpeg ?? 'ffmpeg', ['-hide_banner', '-encoders'])).stdout
  if (!/\blibx264\b/.test(encoders) || !/\baac\b/.test(encoders)) fail('MISSING_CODEC', 'FFmpeg requires libx264 and AAC')
  if (m.subtitles) {
    const filters = (await runTool(tools.ffmpeg ?? 'ffmpeg', ['-hide_banner', '-filters'])).stdout
    if (!/\bsubtitles\s+V->V/.test(filters)) fail('MISSING_SUBTITLES', 'FFmpeg requires libass subtitle rendering')
    if (!m.font || !fs.statSync(jobPath(root, m.font)).isFile()) fail('MISSING_FONT', 'Provide a verified Thai font in the job directory')
  }
  const browser = await loadPlaywright(root).chromium.launch({ headless: true })
  versions.chromium = browser.version()
  await browser.close()
  if (m.narration && m.narration.provider !== 'provided') {
    const module = m.narration.provider === 'gtts' ? 'gTTS' : 'edge-tts'
    versions.audio = (await runTool(tools.python ?? 'python3', ['-c', 'import importlib.metadata,sys; print(importlib.metadata.version(sys.argv[1]))', module])).stdout.trim()
  }
  return versions
}

export const isMain = (url) => process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === url
export function cliError(error) {
  console.error(`${error.code ?? 'ERROR'}: ${error.message}`)
  process.exitCode = 1
}

if (isMain(import.meta.url)) {
  const [command, root, file, freshFile] = process.argv.slice(2)
  try {
    if (command === 'snapshot') {
      const snapshot = snapshotSource(readJson(file)); writeJson(root, 'source.json', snapshot)
      console.log(JSON.stringify({ id: snapshot.id, revision: snapshot.revision, hash: snapshot.hash }))
    } else if (command === 'guard') {
      assertSourceRevision(readJson(jobPath(root, 'source.json')), readJson(freshFile ?? file)); console.log('Source matches')
    } else if (command === 'preflight') console.log(JSON.stringify(await preflight(root, readJson(file), {
      ffmpeg: process.env.DEMO_FFMPEG ?? 'ffmpeg', ffprobe: process.env.DEMO_FFPROBE ?? 'ffprobe', python: process.env.DEMO_PYTHON ?? 'python3',
    }), null, 2))
    else console.log('demo-core.mjs snapshot JOB FRESH_DOCUMENT.json | guard JOB FRESH_DOCUMENT.json | preflight JOB MANIFEST.json\nAgent must fetch fresh full Document JSON before every source guard. No approval is inferred.')
  } catch (error) { cliError(error) }
}
