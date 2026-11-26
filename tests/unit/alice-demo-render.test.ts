import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
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
  fs.symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'))
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

// @ts-expect-error standalone distributable
import { renderHtmlScene } from '../../skill/alice-demo/demo-html.mjs'
// @ts-expect-error standalone distributable
import { proposeFeedback, applyFeedback } from '../../skill/alice-demo/demo-review.mjs'
it('applies only approved feedback and republishes a matched latest preview package', async () => {
  const root = testDir('demo-feedback-', path.resolve('.alice-test/demo-visual'))
  fs.symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'))
  fs.copyFileSync('skill/alice-demo/scene-template.html', path.join(root, 'scene.html'))
  let current = snapshotSource({ id: 'doc_fixture', title: 'Controlled feedback story', body: 'First: original; Second: unchanged', revision: 1 })
  const before: any = { version: 2, purpose: 'production', source: current, visual: structuredClone(stylePresets[0].visual), review: { mode: 'images', sceneId: 'first', start: 0, artifactHash: 'a'.repeat(64) }, render: { seed: 1, localTime: true, toolVersions: { chromium: 'fixture' } }, video: { width: 640, height: 360, fps: 10 }, narration: null, subtitles: false,
    scenes: ['first', 'second'].map((id, i) => ({ id, title: id, onScreenText: 'ไทย API original', type: 'html', html: 'scene.html', start: i * 0.6, duration: 0.6, dependencies: [] })) }
  const options = { readSource: async () => current, authorize: async (b: any) => b.stage === 'feedback'
    ? { stage: b.stage, sourceHash: b.source.hash, videoHash: b.videoHash, planHash: b.planHash, approvedIds: b.approvedIds, reference: 'controlled fixture: approve copy only' }
    : { stage: b.stage, sourceHash: b.source.hash, inputHash: b.inputHash, reviewedArtifactHash: b.review.artifactHash, reference: 'controlled fixture, simulated production consent' }, checkTools: async () => ({ ffmpeg: 'fixture' }) }
  writeJson(root, 'source.json', current)
  for (const scene of before.scenes) await renderHtmlScene(root, before, scene.id, options)
  const first = await renderVideo(root, before, options)
  expect(first.review.status).toBe('complete')
  fs.copyFileSync(path.join(root, 'scene.html'), path.join(root, 'corrected.html'))
  const repairPlan = await proposeFeedback(root, before, first.review, [{ id: 'padding', sceneId: 'first', field: 'html', value: 'corrected.html', intent: 'implementation', reason: 'Restore approved layout without changing the story' }])
  const repaired = await applyFeedback(root, before, first.review, repairPlan, ['padding'], options)
  expect(repaired.source.hash).toBe(before.source.hash)
  await expect(proposeFeedback(root, before, first.review, [{ id: 'bad', sceneId: 'first', field: 'onScreenText', value: 'New story', intent: 'implementation', reason: 'Wrongly bypass source update' }])).rejects.toMatchObject({ code: 'INVALID_FEEDBACK' })
  const proposals = [{ id: 'copy', sceneId: 'first', time: 0.2, field: 'onScreenText', value: 'บริบทใหม่ API', reason: 'Clarify approved explanation' }, { id: 'other', sceneId: 'second', time: 0.8, field: 'title', value: 'Unapproved title', reason: 'Optional idea' }]
  const plan = await proposeFeedback(root, before, first.review, proposals)
  await expect(applyFeedback(root, before, first.review, plan, ['copy'], options)).rejects.toMatchObject({ code: 'SOURCE_UPDATE_REQUIRED' })
  current = snapshotSource({ ...current, body: 'First: บริบทใหม่ API; Second: unchanged', revision: 2 })
  const applied = await applyFeedback(root, before, first.review, plan, ['copy'], options)
  expect(applied.manifest.scenes[1]).toEqual(before.scenes[1])
  expect(applied.unappliedIds).toEqual(['other'])
  writeJson(root, 'source.json', current)
  const frames = []
  for (const scene of applied.manifest.scenes) frames.push(await renderHtmlScene(root, applied.manifest, scene.id, options))
  expect(frames[0].cached).toBe(false)
  expect(frames[1].cached).toBe(true)
  const latest = await renderVideo(root, applied.manifest, options)
  expect(latest.cache[0].cached).toBe(false)
  expect(latest.cache[1].cached).toBe(true)
  expect(latest.review.videoHash).not.toBe(first.review.videoHash)
  expect(fs.existsSync(path.join(root, first.output))).toBe(true)
  expect(hash(fs.readFileSync(path.join(root, first.output)))).toBe(first.review.videoHash)
  expect(fs.existsSync(path.join(root, latest.sourcePackage, 'helpers/demo-review.mjs'))).toBe(true)
  expect(fs.existsSync(path.join(root, latest.sourcePackage, 'helpers/DOCUMENT-KNOWLEDGE.md'))).toBe(true)
  expect(fs.existsSync(path.join(root, latest.sourcePackage, 'review.json'))).toBe(true)
  await expect(proposeFeedback(root, before, first.review, proposals)).rejects.toMatchObject({ code: 'STALE_FEEDBACK' })
  writeJson(root, 'feedback-evidence.json', { first, plan, applied, latest })
})

it('retains the MP4 and previous latest preview when contact-sheet extraction fails', async () => {
  const { root, source, m } = await setup()
  const v2: any = { ...m, version: 2, purpose: 'production', visual: structuredClone(stylePresets[0].visual), review: { mode: 'images', sceneId: 's1', start: 0, artifactHash: 'b'.repeat(64) }, render: { seed: 1, localTime: true, toolVersions: { ffmpeg: 'fixture' } }, scenes: [{ ...m.scenes[0], dependencies: [] }] }
  const options = { readSource: async () => source, authorize: async (b: any) => ({ stage: b.stage, sourceHash: b.source.hash, inputHash: b.inputHash, reviewedArtifactHash: b.review.artifactHash, reference: 'controlled fixture' }), checkTools: async () => ({}) }
  await importCapture(root, v2, 's1', options)
  const first = await renderVideo(root, v2, options)
  const previous = fs.readFileSync(path.join(root, 'latest.json'), 'utf8')
  await expect(renderVideo(root, v2, { ...options, run: async (cmd: string, args: string[], config: any) => {
    if (args.includes('-fps_mode')) throw new Error('forced contact extraction failure')
    return runTool(cmd, args, config)
  } })).rejects.toMatchObject({ code: 'REVIEW_INCOMPLETE' })
  expect(fs.readFileSync(path.join(root, 'latest.json'), 'utf8')).toBe(previous)
  const incomplete = fs.readdirSync(path.join(root, 'runs')).filter((r) => fs.existsSync(path.join(root, 'runs', r, 'incomplete.json')))
  expect(incomplete).toHaveLength(1)
  expect(fs.existsSync(path.join(root, 'runs', incomplete[0], 'video.mp4'))).toBe(true)
  expect(fs.existsSync(path.join(root, first.output))).toBe(true)
})

it('packages only the public helper closure rather than unrelated files beside installed helpers', async () => {
  const { root, m } = await setup(), installed = testDir('demo-package-helpers-')
  for (const file of fs.readdirSync('skill/alice-demo')) fs.copyFileSync(path.join('skill/alice-demo', file), path.join(installed, file))
  for (const file of fs.readdirSync('skill/_shared')) fs.copyFileSync(path.join('skill/_shared', file), path.join(installed, file))
  fs.writeFileSync(path.join(installed, 'private-notes.md'), 'Synthetic private note; must not be copied')
  fs.writeFileSync(path.join(installed, 'agent-authorization.mjs'), 'export const privateReference="not-for-sharing"')
  const { packageSources } = await import(pathToFileURL(path.join(installed, 'demo-render.mjs')).href)
  const manifest = { ...m, version: 2, visual: { dependencies: [] } }
  writeJson(root, 'manifest.json', manifest)
  const folder = packageSources(root, manifest, 'runs/public-closure', ['input.mp4'])
  expect(fs.existsSync(path.join(root, folder, 'helpers/demo-visual.mjs'))).toBe(true)
  expect(fs.existsSync(path.join(root, folder, 'helpers/DOCUMENT-KNOWLEDGE.md'))).toBe(true)
  expect(fs.existsSync(path.join(root, folder, 'helpers/private-notes.md'))).toBe(false)
  expect(fs.existsSync(path.join(root, folder, 'helpers/agent-authorization.mjs'))).toBe(false)
})
