import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { testDir } from '../helpers/tmp'
// @ts-expect-error standalone distributable
import { snapshotSource, jobPath, runTool, probe } from '../../skill/alice-demo/demo-core.mjs'
// @ts-expect-error standalone distributable
import { generateSample, generateNarration, listVoices, measureSpeech } from '../../skill/alice-demo/demo-audio.mjs'

const manifest = (provider = 'gtts') => ({ version: 1, source: snapshotSource({ id: 'doc_demo', title: 'Story', body: 'ไทย', revision: 1 }), video: { width: 1920, height: 1080, fps: 30 }, subtitles: true, narration: { provider, language: 'th', ...(provider === 'edge-tts' ? { voice: 'th-TH-RealVoice', rate: '+5%' } : {}) }, scenes: [{ id: 's1', title: 'Opening', type: 'html', html: 'scene.html', start: 0, duration: 10, cues: [{ id: 'c1', text: 'Alice สวัสดี' }] }] })
const measure = async (_file: string, duration: number) => ({ speechStart: 0.1, speechEnd: duration - 0.1 })
const inspect = async () => ({ duration: 2, streams: [{ codec_type: 'audio' }] })

describe('demo narration', () => {
  it('generates a literal sample, reuses matching audio and invalidates changed settings', async () => {
    const root = testDir('demo-audio-'), calls: string[][] = []
    const run = async (_: string, args: string[]) => {
      calls.push(args)
      fs.writeFileSync(args[3], 'fake-audio')
      return { stdout: '', stderr: '' }
    }
    const m = { ...manifest(), pronunciations: { Alice: 'อลิซ' } }
    const sample = await generateSample(root, m, { run, inspect, measure })
    expect(sample.text).toBe('อลิซ สวัสดี')
    expect(sample.subtitle).toBe('Alice สวัสดี')
    await expect(generateNarration(root, m, { run, inspect, measure })).rejects.toMatchObject({ code: 'SAMPLE_APPROVAL_REQUIRED' })
    const full = await generateNarration(root, m, { sampleApproved: true, run, inspect, measure })
    expect(full.scenes[0].cues[0].cached).toBe(true)
    expect(full.scenes[0].cues[0].start).toBe(0.1)
    expect(full.scenes[0].cues[0].end).toBe(1.9)
    expect(calls).toHaveLength(1)
    await generateSample(root, { ...m, narration: { ...m.narration, slow: true } }, { run, inspect, measure })
    expect(calls).toHaveLength(2)
    fs.writeFileSync(jobPath(root, sample.file), 'corrupt')
    await generateSample(root, m, { run, inspect, measure })
    expect(calls).toHaveLength(3)
  })

  it('measures real leading/trailing silence instead of treating padding as speech', async () => {
    const root = testDir('demo-speech-'), file = jobPath(root, 'speech.wav')
    await runTool('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', '-af', 'adelay=200,apad=pad_dur=0.5', file])
    const media = await probe(file)
    const bounds = await measureSpeech(file, media.duration)
    expect(Math.abs(bounds.speechStart - 0.2)).toBeLessThan(0.03)
    expect(Math.abs(bounds.speechEnd - 0.7)).toBeLessThan(0.03)
  })

  it('lists actual voices and passes edge settings as arguments', async () => {
    const root = testDir('demo-edge-')
    expect(await listVoices({ run: async () => ({ stdout: '[{"ShortName":"actual"}]' }) })).toEqual([{ ShortName: 'actual' }])
    const sample = await generateSample(root, manifest('edge-tts'), { inspect, measure, run: async (_: string, args: string[]) => {
      expect(args).toContain('--rate=+5%')
      expect(args).toContain('th-TH-RealVoice')
      fs.writeFileSync(args[args.indexOf('--write-media') + 1], 'edge audio')
      return { stdout: '' }
    } })
    expect(sample.provider).toBe('edge-tts')
  })

  it('stops without provider fallback and does nothing for no narration', async () => {
    const root = testDir('demo-audio-failure-')
    let calls = 0
    const run = async () => { calls++; throw Object.assign(new Error('failed'), { code: 'TOOL_TIMEOUT' }) }
    await expect(generateSample(root, manifest(), { run, inspect, measure })).rejects.toMatchObject({ code: 'TOOL_TIMEOUT' })
    expect(calls).toBe(1)
    await generateNarration(root, { ...manifest(), narration: null, subtitles: false, scenes: [{ ...manifest().scenes[0], cues: [] }] }, { run })
    expect(calls).toBe(1)
  })

  it('rejects speech longer than its agreed slot', async () => {
    const root = testDir('demo-audio-overrun-'), m = manifest()
    m.scenes[0].duration = 1
    await expect(generateNarration(root, m, { sampleApproved: true, inspect, measure, run: async (_: string, args: string[]) => { fs.writeFileSync(args[3], 'audio'); return { stdout: '' } } })).rejects.toMatchObject({ code: 'AUDIO_OVERRUN' })
  })
})

it('invalidates provided narration when bytes change at the same path', async () => {
  const root = testDir('demo-provided-cache-'), m: any = manifest('provided')
  m.scenes[0].cues[0].audio = 'provided.mp3'
  fs.writeFileSync(jobPath(root, 'provided.mp3'), 'first recording')
  const first = await generateSample(root, m, { inspect, measure })
  const reused = await generateSample(root, m, { inspect, measure })
  expect(reused.cached).toBe(true)
  fs.writeFileSync(jobPath(root, 'provided.mp3'), 'new recording at same path')
  const changed = await generateSample(root, m, { inspect, measure })
  expect(changed.cached).toBe(false)
  expect(changed.key).not.toBe(first.key)
  expect(fs.readFileSync(jobPath(root, first.file), 'utf8')).toBe('first recording')
})

// @ts-expect-error standalone distributable
import { writeJson } from '../../skill/alice-demo/demo-core.mjs'
// @ts-expect-error standalone distributable
import { stylePresets } from '../../skill/alice-demo/demo-styles.mjs'
it('retains original audio provenance when a new approved source has equivalent cue input', async () => {
  const root = testDir('demo-audio-provenance-')
  const m: any = { ...manifest('provided'), version: 2, purpose: 'sample', visual: structuredClone(stylePresets[0].visual), review: { mode: 'images', sceneId: 's1', start: 0 }, render: { seed: 1, localTime: true, toolVersions: { audio: 'fixture' } }, scenes: [{ ...manifest('provided').scenes[0], dependencies: [] }] }
  m.scenes[0].cues[0].audio = 'voice.mp3'
  fs.writeFileSync(jobPath(root, 'voice.mp3'), 'same approved recording')
  writeJson(root, 'source.json', m.source)
  const options = { inspect, measure, readSource: async () => m.source, authorize: async (b: any) => ({ stage: b.stage, sourceHash: b.source.hash, inputHash: b.inputHash, reference: 'fixture consent' }) }
  const first = await generateSample(root, m, options)
  m.source = snapshotSource({ ...m.source, revision: 2, body: 'Approved metadata edit; no cue change' })
  writeJson(root, 'source.json', m.source)
  const second = await generateSample(root, m, options)
  expect(second.cached).toBe(true)
  expect(second.key).toBe(first.key)
  expect(second.createdFrom.revision).toBe(1)
  expect(second.validatedFor.revision).toBe(2)
})
