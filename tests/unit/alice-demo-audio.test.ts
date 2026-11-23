import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { testDir } from '../helpers/tmp'
// @ts-expect-error standalone distributable
import { snapshotSource, jobPath } from '../../skill/alice-demo/demo-core.mjs'
// @ts-expect-error standalone distributable
import { generateSample, generateNarration, listVoices } from '../../skill/alice-demo/demo-audio.mjs'

const manifest = (provider = 'gtts') => ({ version: 1, source: snapshotSource({ id: 'doc_demo', title: 'Story', body: 'ไทย', revision: 1 }), video: { width: 1920, height: 1080, fps: 30 }, subtitles: true, narration: { provider, language: 'th', ...(provider === 'edge-tts' ? { voice: 'th-TH-RealVoice', rate: '+5%' } : {}) }, scenes: [{ id: 's1', title: 'Opening', type: 'html', html: 'scene.html', start: 0, duration: 10, cues: [{ id: 'c1', text: 'Alice สวัสดี' }] }] })
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
    const sample = await generateSample(root, m, { run, inspect })
    expect(sample.text).toBe('อลิซ สวัสดี')
    expect(sample.subtitle).toBe('Alice สวัสดี')
    await expect(generateNarration(root, m, { run, inspect })).rejects.toMatchObject({ code: 'SAMPLE_APPROVAL_REQUIRED' })
    const full = await generateNarration(root, m, { sampleApproved: true, run, inspect })
    expect(full.scenes[0].cues[0].cached).toBe(true)
    expect(calls).toHaveLength(1)
    await generateSample(root, { ...m, narration: { ...m.narration, slow: true } }, { run, inspect })
    expect(calls).toHaveLength(2)
    fs.writeFileSync(jobPath(root, sample.file), 'corrupt')
    await generateSample(root, m, { run, inspect })
    expect(calls).toHaveLength(3)
  })

  it('lists actual voices and passes edge settings as arguments', async () => {
    const root = testDir('demo-edge-')
    expect(await listVoices({ run: async () => ({ stdout: '[{"ShortName":"actual"}]' }) })).toEqual([{ ShortName: 'actual' }])
    const sample = await generateSample(root, manifest('edge-tts'), { inspect, run: async (_: string, args: string[]) => {
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
    await expect(generateSample(root, manifest(), { run, inspect })).rejects.toMatchObject({ code: 'TOOL_TIMEOUT' })
    expect(calls).toBe(1)
    await generateNarration(root, { ...manifest(), narration: null, scenes: [{ ...manifest().scenes[0], cues: [] }] }, { run })
    expect(calls).toBe(1)
  })

  it('rejects speech longer than its agreed slot', async () => {
    const root = testDir('demo-audio-overrun-'), m = manifest()
    m.scenes[0].duration = 1
    await expect(generateNarration(root, m, { sampleApproved: true, inspect, run: async (_: string, args: string[]) => { fs.writeFileSync(args[3], 'audio'); return { stdout: '' } } })).rejects.toMatchObject({ code: 'AUDIO_OVERRUN' })
  })
})
