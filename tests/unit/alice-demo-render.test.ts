import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { testDir } from '../helpers/tmp'
// @ts-expect-error standalone distributable
import { snapshotSource, writeJson, runTool, probe, hash } from '../../skill/alice-demo/demo-core.mjs'
// @ts-expect-error standalone distributable
import { importCapture } from '../../skill/alice-demo/demo-capture.mjs'
// @ts-expect-error standalone distributable
import { renderVideo, makeSubtitles, verifyVideo } from '../../skill/alice-demo/demo-render.mjs'

const setup = async () => {
  const root = testDir('demo-render-')
  const source = snapshotSource({ id: 'doc_demo', title: 'Approved story', body: 'Scene ไทย', revision: 2 })
  const m = { version: 1, source, video: { width: 320, height: 180, fps: 10 }, narration: null, subtitles: false, scenes: [{ id: 's1', title: 'Real source', type: 'capture', media: 'input.mp4', start: 0, duration: 0.6 }] }
  writeJson(root, 'source.json', source)
  await runTool('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=10', '-t', '0.6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(root, 'input.mp4')])
  await importCapture(root, m, 's1')
  return { root, source, m }
}

describe('demo assembly and delivery files', () => {
  it('builds a real playable MP4 and reproduces it offline without auth files', async () => {
    const { root, source, m } = await setup()
    fs.mkdirSync(path.join(root, '.auth'))
    fs.writeFileSync(path.join(root, '.auth/session.json'), 'must-not-package')
    let reads = 0
    const result = await renderVideo(root, m, { readSource: async () => { reads++; return source }, checkTools: async () => ({ ffmpeg: 'fixture', chromium: 'not used by assembly' }) })
    expect(reads).toBeGreaterThanOrEqual(3)
    expect(result.metadata).toMatchObject({ width: 320, height: 180, fps: 10, video: 'h264', audio: 'aac' })
    expect(result.checks.visualAndListening).toContain('required')
    const packageDir = path.join(root, result.sourcePackage)
    expect(fs.existsSync(path.join(packageDir, 'originals/.auth'))).toBe(false)
    await runTool(process.execPath, [path.join(packageDir, 'reproduce.mjs')])
    expect((await probe(path.join(packageDir, 'reproduced.mp4'))).duration).toBeGreaterThan(0.5)
    expect(JSON.parse(fs.readFileSync(path.join(packageDir, 'originals/source.json'), 'utf8')).revision).toBe(2)
  })

  it('stops a changed source and preserves earlier outputs on failure', async () => {
    const { root, source, m } = await setup()
    let reads = 0
    await expect(renderVideo(root, m, { readSource: async () => ++reads > 1 ? { ...source, revision: 3 } : source, checkTools: async () => ({}) })).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
    fs.writeFileSync(path.join(root, 'previous.mp4'), 'prior-output')
    await expect(renderVideo(root, m, { readSource: async () => source, checkTools: async () => ({}), run: async () => { throw Object.assign(new Error('codec unavailable'), { code: 'TOOL_FAILED' }) } })).rejects.toMatchObject({ code: 'TOOL_FAILED' })
    expect(fs.readFileSync(path.join(root, 'previous.mp4'), 'utf8')).toBe('prior-output')
    await expect(renderVideo(root, m)).rejects.toMatchObject({ code: 'FRESH_SOURCE_REQUIRED' })
  })

  it('rejects stale narration and overrun rather than truncating speech', async () => {
    const { root, source, m } = await setup()
    const narration = { provider: 'gtts', language: 'th' }, text = 'สวัสดี'
    const spoken = { ...m, narration, scenes: [{ ...m.scenes[0], cues: [{ id: 'c1', text }] }] }
    fs.writeFileSync(path.join(root, 'speech.mp3'), 'audio')
    const record = { id: 'c1', text, subtitle: text, file: 'speech.mp3', hash: hash(Buffer.from('audio')), key: hash(JSON.stringify({ text, settings: narration })), start: 0, end: 2 }
    writeJson(root, 'audio.json', { narration, scenes: [{ id: 's1', duration: 2, cues: [record] }] })
    await expect(renderVideo(root, spoken, { readSource: async () => source, checkTools: async () => ({}) })).rejects.toMatchObject({ code: 'AUDIO_OVERRUN' })
    writeJson(root, 'audio.json', { narration: { ...narration, slow: true }, scenes: [] })
    await expect(renderVideo(root, spoken, { readSource: async () => source, checkTools: async () => ({}) })).rejects.toMatchObject({ code: 'STALE_AUDIO' })
  })

  it('exports measured subtitle times and validates output metadata', async () => {
    const { root, m } = await setup()
    const captions = { ...m, scenes: [{ ...m.scenes[0], cues: [{ id: 'c', text: 'ไทย API', start: 0.1, end: 0.5 }] }] }
    expect(makeSubtitles(captions, null)).toContain('00:00:00,100 --> 00:00:00,500\nไทย API')
    await expect(verifyVideo(path.join(root, 'input.mp4'), m)).rejects.toMatchObject({ code: 'INVALID_OUTPUT' })
  })
})

// @ts-expect-error standalone distributable
import { stylePresets } from '../../skill/alice-demo/demo-styles.mjs'
it('reuses unchanged normalized media after fresh approval and rejects changed capture inputs', async () => {
  const { root, source, m } = await setup()
  let current = source
  const v2: any = { ...m, version: 2, purpose: 'production', visual: structuredClone(stylePresets[0].visual), review: { mode: 'images', sceneId: 's1', start: 0, artifactHash: 'a'.repeat(64) }, render: { seed: 1, localTime: true, toolVersions: { ffmpeg: 'fixture' } }, scenes: [{ ...m.scenes[0], dependencies: [] }] }
  const options = { readSource: async () => current, authorize: async (b: any) => ({ stage: b.stage, sourceHash: b.source.hash, inputHash: b.inputHash, reviewedArtifactHash: b.review.artifactHash, reference: 'controlled fixture production authorization' }), checkTools: async () => ({ ffmpeg: 'fixture' }) }
  await importCapture(root, v2, 's1', options)
  const first = await renderVideo(root, v2, options)
  expect(first.cache[0].cached).toBe(false)
  current = snapshotSource({ ...source, body: 'Approved revision with same media', revision: 3 })
  v2.source = current
  writeJson(root, 'source.json', current)
  const fresh = await renderVideo(root, v2, options)
  expect(fresh.cache[0].cached).toBe(true)
  expect(fresh.cache[0].hash).toBe(first.cache[0].hash)
  expect(fresh.cache[0].createdFrom.revision).toBe(2)
  expect(fresh.cache[0].validatedFor.revision).toBe(3)
  v2.scenes[0].duration = 0.5
  await expect(renderVideo(root, v2, options)).rejects.toMatchObject({ code: 'STALE_CAPTURE' })
})
