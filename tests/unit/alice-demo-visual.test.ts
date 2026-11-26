import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { testDir } from '../helpers/tmp'
// @ts-expect-error standalone distributable
import { stylePresets, directionChoices, generateDirectionGallery, directionSceneHtml } from '../../skill/alice-demo/demo-styles.mjs'

const tailored = (count = 2) => Array.from({ length: count }, (_, i) => ({ ...structuredClone(stylePresets[i]), kind: 'custom', key: `tailored-${i}`, name: ['Context to delivery', 'Technical walkthrough', 'Team handoff'][i], reason: 'Tailored to this process and its audience', tradeoff: 'Long labels require readable holds', visual: { ...structuredClone(stylePresets[i].visual), key: `tailored-${i}`, layout: 'custom', composition: ['split', 'cards', 'timeline'][i] } }))

describe('visual direction choices', () => {
  it('offers six/seven meaningful directions and accepts explicit or hybrid direction without another choice', () => {
    for (const n of [2, 3]) expect(directionChoices({ tailored: tailored(n) }).choices).toHaveLength(4 + n)
    expect(new Set(stylePresets.map((d: any) => d.visual.layout)).size).toBe(4)
    expect(directionChoices({ selected: 'editorial' })).toMatchObject({ needsChoice: false, choices: [], selected: { key: 'editorial' } })
    const hybrid = tailored()[0]
    expect(directionChoices({ selected: hybrid }).selected).toEqual(hybrid)
    for (const x of [{}, { tailored: tailored(1) }, { selected: 'unknown' }, { tailored: [tailored()[0], tailored()[0]] }]) expect(() => directionChoices(x)).toThrow()
  })

  it('escapes user content instead of running embedded markup', () => {
    const html = directionSceneHtml(stylePresets[0].visual, { title: '<script>throw 1</script>', onScreenText: 'ไทย API <img src=x onerror=alert(1)>' })
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<img src=x')
  })

  it('generates native illustrated gallery files without capture or voice calls', async () => {
    const root = testDir('demo-directions-')
    fs.symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'))
    const result = await generateDirectionGallery(root, { tailored: tailored(3), context: { title: 'ทีมและ agent', onScreenText: 'บริบทร่วมกัน → SDLC → ผลงานที่ตรวจแล้ว' } })
    expect(result.choices).toHaveLength(7)
    const images = result.choices.map((d: any) => fs.readFileSync(path.join(root, d.image)))
    expect(new Set(images.map((b: Buffer) => b.toString('base64'))).size).toBe(7)
    expect(fs.readFileSync(path.join(root, result.gallery), 'utf8')).toContain('Exploratory drafts')
    expect(fs.existsSync(path.join(root, 'media/audio'))).toBe(false)
    expect(await generateDirectionGallery(root, { selected: 'diagram' })).toMatchObject({ needsChoice: false, choices: [] })
  })
})

// @ts-expect-error standalone distributable
import { generateVisualSample } from '../../skill/alice-demo/demo-visual.mjs'
// @ts-expect-error standalone distributable
import { snapshotSource, writeJson } from '../../skill/alice-demo/demo-core.mjs'
const sampleJob = () => {
  const root = testDir('visual-sample-', path.resolve('.alice-test/demo-visual'))
  fs.symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'))
  const source = snapshotSource({ id: 'doc_demo', title: 'Story', body: 'ไทย API context', revision: 1 })
  const visual = structuredClone(stylePresets[2].visual)
  const m: any = { version: 2, source, purpose: 'sample', visual, review: { mode: 'images', sceneId: 's1', start: 0 }, render: { seed: 1, localTime: true, toolVersions: { chromium: 'fixture' } },
    video: { width: 640, height: 360, fps: 10 }, narration: null, subtitles: false, scenes: [{ id: 's1', title: 'บริบทร่วมกัน', onScreenText: 'SDLC และ API', html: 'scene.html', type: 'html', start: 0, duration: 8, dependencies: [] }] }
  fs.writeFileSync(path.join(root, 'scene.html'), directionSceneHtml(visual, m.scenes[0]))
  writeJson(root, 'source.json', source)
  const options = { readSource: async () => source, authorize: async (b: any) => ({ stage: b.stage, sourceHash: b.source.hash, inputHash: b.inputHash, reference: 'controlled fixture, simulated sample consent only' }) }
  return { root, m, options }
}

describe('selected visual review', () => {
  it('makes keyframes and exactly five seconds of the same selected scene without a new voice call', async () => {
    const { root, m, options } = sampleJob()
    const images = await generateVisualSample(root, m, options)
    expect(images.samples).toHaveLength(3)
    expect(images.checks.motionReview).toContain('stills only')
    const video = await generateVisualSample(root, { ...m, review: { ...m.review, mode: 'video5' } }, options)
    expect(video.samples).toHaveLength(50)
    expect(video.metadata.duration).toBeCloseTo(5, 1)
    expect(video.visualHash).toBe(images.visualHash)
    expect(video.dependencyHash).toBe(images.dependencyHash)
    expect(video.checks.fullProductionApproved).toBe(false)
    expect(video.samples.at(-1).sceneTime).toBe(4.9)
    writeJson(root, 'sample-evidence.json', { images, video })
  })

  it('stops unapproved, stale, too-short and sound-without-approved-audio samples', async () => {
    const { root, m, options } = sampleJob()
    await expect(generateVisualSample(root, m, { readSource: options.readSource })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' })
    await expect(generateVisualSample(root, m, { ...options, readSource: async () => ({ ...m.source, revision: 2 }) })).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
    const video = { ...m, review: { ...m.review, mode: 'video5', start: 4 } }
    await expect(generateVisualSample(root, video, options)).rejects.toMatchObject({ code: 'SAMPLE_EXCERPT_REQUIRED' })
    await expect(generateVisualSample(root, { ...m, review: { ...m.review, mode: 'video5', sound: true } }, options)).rejects.toMatchObject({ code: 'SAMPLE_AUDIO_REQUIRED' })
  })
})

// @ts-expect-error standalone distributable
import { runTool, hash } from '../../skill/alice-demo/demo-core.mjs'
// @ts-expect-error standalone distributable
import { importCapture } from '../../skill/alice-demo/demo-capture.mjs'

describe('real footage and approved sample sound', () => {
  it('reviews existing capture footage without navigating to the original app', async () => {
    const { root, m, options } = sampleJob()
    await runTool('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=10', '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(root, 'capture.mp4')])
    const capture = { ...m, scenes: [{ ...m.scenes[0], type: 'capture', html: undefined, media: 'capture.mp4' }] }
    await importCapture(root, capture, 's1', options)
    const sample = await generateVisualSample(root, capture, options)
    expect(sample.samples).toHaveLength(3)
    expect(sample.samples[0].hash).toBe(sample.samples[2].hash)
  })

  it('includes whole approved audio cues and rejects an excerpt which would cut one', async () => {
    const { root, m, options } = sampleJob()
    const text = 'API', narration = { provider: 'provided', language: 'th' }
    await runTool('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=400:duration=1', path.join(root, 'provided.mp3')])
    const cue = { id: 'c1', text, subtitle: text, file: 'provided.mp3', hash: hash(fs.readFileSync(path.join(root, 'provided.mp3'))), key: hash(JSON.stringify({ text, settings: narration })), duration: 1, speechStart: 0, speechEnd: 1, start: 0, end: 1 }
    writeJson(root, 'audio.json', { narration, scenes: [{ id: 's1', duration: 1, cues: [cue] }] })
    const sound = { ...m, narration, scenes: [{ ...m.scenes[0], cues: [{ id: 'c1', text, audio: 'provided.mp3' }] }], review: { ...m.review, mode: 'video5', sound: true } }
    expect((await generateVisualSample(root, sound, options)).checks.sound).toContain('existing approved')
    writeJson(root, 'audio.json', { narration, scenes: [{ id: 's1', duration: 5.5, cues: [{ ...cue, start: 4.5, end: 5.5 }] }] })
    await expect(generateVisualSample(root, sound, options)).rejects.toMatchObject({ code: 'SAMPLE_AUDIO_WOULD_CUT' })
  })
})
