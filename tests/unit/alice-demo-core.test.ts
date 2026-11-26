import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { testDir } from '../helpers/tmp'
// @ts-expect-error Distributable ESM helper runs without the Alice TypeScript runtime.
import { snapshotSource, assertSourceRevision, jobPath, validateManifest, runTool, writeJson, preflight, withinDeadline } from '../../skill/alice-demo/demo-core.mjs'

const source = () => snapshotSource({ id: 'doc_demo', title: 'Story', body: 'Hello ไทย', revision: 1 })
const manifest = () => ({ version: 1, source: source(), video: { width: 1920, height: 1080, fps: 30 }, narration: null, subtitles: false, scenes: [{ id: 'intro', title: 'Intro', type: 'html', html: 'intro.html', start: 0, duration: 10 }] })

describe('demo production boundaries', () => {
  it('ties a snapshot to full fresh content, identity and revision', () => {
    const s = source()
    expect(assertSourceRevision(s, { data: s }).hash).toBe(s.hash)
    for (const patch of [{ revision: 2 }, { body: 'Edited' }, { id: 'doc_other' }, { title: 'New' }]) {
      expect(() => assertSourceRevision(s, { ...s, ...patch })).toThrow('Storyboard changed')
    }
    expect(() => snapshotSource({ id: 'doc_demo', revision: 1 })).toThrow()
  })

  it('rejects path escapes including existing symlink parents', () => {
    const root = testDir('demo-root-'), outside = testDir('demo-outside-')
    fs.symlinkSync(outside, path.join(root, 'escape'))
    fs.symlinkSync(path.join(outside, 'absent'), path.join(root, 'dangling'))
    for (const p of ['../secret', '/tmp/secret', 'escape/file', 'dangling', 'a\\b', 'bad\0name']) expect(() => jobPath(root, p)).toThrow()
    writeJson(root, 'nested/result.json', { ok: true })
    expect(JSON.parse(fs.readFileSync(jobPath(root, 'nested/result.json'), 'utf8'))).toEqual({ ok: true })
  })

  it('does not mistake an installed FFmpeg for subtitle or codec readiness', async () => {
    const root = testDir('demo-preflight-'), tool = path.join(root, 'ffmpeg')
    fs.writeFileSync(tool, `#!${process.execPath}\nconsole.log(process.argv.includes('-encoders') ? 'libx264 aac' : 'fake 1.0')\n`, { mode: 0o755 })
    const subtitled = { ...manifest(), subtitles: true, scenes: [{ ...manifest().scenes[0], cues: [{ id: 'c1', text: 'ไทย', start: 1, end: 2 }] }] }
    await expect(preflight(root, subtitled, { ffmpeg: tool, ffprobe: tool })).rejects.toMatchObject({ code: 'MISSING_SUBTITLES' })
    fs.writeFileSync(tool, `#!${process.execPath}\nconsole.log('fake 1.0')\n`, { mode: 0o755 })
    await expect(preflight(root, manifest(), { ffmpeg: tool, ffprobe: tool })).rejects.toMatchObject({ code: 'MISSING_CODEC' })
  })

  it('validates timing, source, speech choice and scene inputs', () => {
    const root = testDir('demo-manifest-')
    expect(validateManifest(manifest(), root).scenes).toHaveLength(1)
    const bad = [
      { ...manifest(), source: {} }, { ...manifest(), narration: {} },
      { ...manifest(), scenes: [] }, { ...manifest(), video: { width: 1921, height: 1080, fps: 30 } },
      { ...manifest(), subtitles: true },
      { ...manifest(), scenes: [...manifest().scenes, ...manifest().scenes] },
      { ...manifest(), scenes: [{ ...manifest().scenes[0], start: 1 }] },
      { ...manifest(), scenes: [{ ...manifest().scenes[0], html: '../secret' }] },
      { ...manifest(), scenes: [{ ...manifest().scenes[0], cues: [{ id: 'c1', text: 'ไทย' }] }] },
    ]
    for (const m of bad) expect(() => validateManifest(m, root)).toThrow()
  })

  it('passes text literally without shell evaluation and bounds failures', async () => {
    const root = testDir('demo-command-'), marker = path.join(root, 'owned')
    const text = `hello; touch ${marker}; $(touch ${marker})`
    const result = await runTool(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', text])
    expect(result.stdout).toBe(text)
    expect(fs.existsSync(marker)).toBe(false)
    await expect(runTool(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 30 })).rejects.toMatchObject({ code: 'TOOL_TIMEOUT' })
    await expect(runTool(process.execPath, ['-e', 'process.exit(2)'])).rejects.toMatchObject({ code: 'TOOL_FAILED' })
    await expect(runTool('missing-demo-executable', [])).rejects.toMatchObject({ code: 'TOOL_UNAVAILABLE' })
    await expect(withinDeadline(new Promise(() => {}), 10)).rejects.toMatchObject({ code: 'SCENE_TIMEOUT' })
  })
})

// @ts-expect-error standalone distributable
import { prepareStage, manifestHash } from '../../skill/alice-demo/demo-core.mjs'
const visualManifest = (): any => ({ ...manifest(), version: 2, purpose: 'sample',
  visual: { key: 'editorial', palette: { background: '#fff8ef', foreground: '#282520', accent: '#ad521e' }, typography: { family: 'DemoThai' }, layout: 'editorial', motion: 'reveal', dependencies: [] },
  review: { mode: 'video5', sceneId: 'intro', start: 0 }, render: { seed: 7, localTime: true, toolVersions: { chromium: 'fixture' } },
  scenes: manifest().scenes.map((s) => ({ ...s, dependencies: [] })) })

describe('v2 source-bound visual stages', () => {
  it('keeps v1 readable and validates v2 tokens, review, dependencies, seed and frames', () => {
    const root = testDir('visual-contract-'), m = visualManifest()
    expect(validateManifest(m, root)).toBe(m)
    for (const patch of [{ version: 3 }, { purpose: 'publish' }, { visual: {} }, { review: { ...m.review, mode: 'gif' } },
      { render: { ...m.render, seed: NaN } }, { scenes: [{ ...m.scenes[0], dependencies: ['../private'] }] },
      { scenes: [{ ...m.scenes[0], frameCount: 1 }] }, { purpose: 'production' }]) expect(() => validateManifest({ ...m, ...patch }, root)).toThrow()
    expect(validateManifest(manifest(), root).version).toBe(1)
  })

  it('requires out-of-manifest authorization bound to inputs and cannot promote samples', async () => {
    const root = testDir('visual-approval-'), m = visualManifest()
    writeJson(root, 'source.json', m.source)
    const readSource = async () => m.source
    await expect(prepareStage(root, m, { readSource })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' })
    await expect(prepareStage(root, m, { readSource, authorize: async () => true })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' })
    const authorize = async (binding: any) => ({ stage: binding.stage, sourceHash: binding.source.hash, inputHash: binding.inputHash, reference: 'controlled fixture; simulated consent' })
    const guard = await prepareStage(root, m, { readSource, authorize })
    await guard()
    await expect(prepareStage(root, m, { readSource, authorize }, 'production')).rejects.toMatchObject({ code: 'WRONG_PURPOSE' })
    const production = { ...m, purpose: 'production', review: { ...m.review, artifactHash: 'a'.repeat(64) } }
    // A sample authorization, even with a renamed manifest, cannot satisfy full production.
    await expect(prepareStage(root, production, { readSource, authorize: async () => ({ stage: 'sample', sourceHash: m.source.hash, inputHash: manifestHash(m), reference: 'sample only' }) })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' })
    await expect(prepareStage(root, production, { readSource, authorize })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' })
    await expect(prepareStage(root, production, { readSource, authorize: async (b: any) => ({ ...await authorize(b), reviewedArtifactHash: production.review.artifactHash }) })).resolves.toBeTypeOf('function')
  })

  it('fails unreadable/edited source and detects changed inputs before publication', async () => {
    const root = testDir('visual-source-'), m = visualManifest()
    writeJson(root, 'source.json', m.source)
    const authorize = async (b: any) => ({ stage: b.stage, sourceHash: b.source.hash, inputHash: b.inputHash, reference: 'fixture consent' })
    await expect(prepareStage(root, m, { readSource: async () => { throw new Error('unavailable') }, authorize })).rejects.toThrow('unavailable')
    let fresh = m.source
    const guard = await prepareStage(root, m, { readSource: async () => fresh, authorize })
    fresh = { ...m.source, body: 'Edited after authorization' }
    await expect(guard()).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
    fresh = m.source
    m.visual.palette.accent = '#000000'
    await expect(guard()).rejects.toMatchObject({ code: 'INPUT_CHANGED' })
  })
})
