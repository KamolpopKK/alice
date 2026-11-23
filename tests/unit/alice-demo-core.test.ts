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
