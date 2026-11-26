/** Fixture-specific caption compositing differences; complements human visual/audio review. */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { testDir } from '../helpers/tmp'
// @ts-expect-error standalone distributable
import { readJson, runTool } from '../../skill/alice-demo/demo-core.mjs'

const root = path.resolve(process.argv[2])
const events = readJson(path.join(root, 'transcript.json'))
const folder = testDir('subtitle-qa-', root)
const results = []
for (const mode of ['capture', 'html', 'mixed']) {
  const output = events.findLast((e: any) => e.event === 'render-and-reproduce' && e.mode === mode)?.output
  assert(output, `Missing ${mode} output`)
  const m = readJson(path.join(root, mode, 'manifest.json'))
  const event = events.findLast((e: any) => e.event === 'render-and-reproduce' && e.mode === mode)
  const report = readJson(path.join(event.sourcePackage, 'report.json'))
  const audio = m.narration ? readJson(path.join(root, mode, 'audio.json')) : null
  for (const [sceneIndex, scene] of m.scenes.entries()) {
    const sceneStart = report.sceneMap?.scenes[sceneIndex].start ?? scene.start
    const baseline = path.join(event.sourcePackage, 'scenes', `${sceneIndex}.mp4`)
    const cues = audio ? audio.scenes.find((s: any) => s.id === scene.id).cues : scene.cues
    for (const cue of cues) {
      const samples = []
      for (const [label, time, expected] of [
        ['before', sceneStart + cue.start - 0.08, false], ['during', sceneStart + cue.start + 0.08, true],
        ['last', sceneStart + cue.end - 0.08, true], ['after', sceneStart + cue.end + 0.08, false],
      ] as [string, number, boolean][]) {
        const file = path.join(folder, `${mode}-${scene.id}-${cue.id}-${label}.png`)
        await runTool(process.env.DEMO_FFMPEG ?? 'ffmpeg', ['-v', 'error', '-ss', String(Math.max(0, time)), '-i', output, '-vf', 'crop=1920:180:0:900', '-frames:v', '1', file])
        const baseFile = path.join(folder, `${mode}-${scene.id}-${cue.id}-${label}-baseline.png`)
        await runTool(process.env.DEMO_FFMPEG ?? 'ffmpeg', ['-v', 'error', '-ss', String(Math.max(0, time - sceneStart)), '-i', baseline, '-vf', 'crop=1920:180:0:900', '-frames:v', '1', baseFile])
        const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
        const original = await sharp(baseFile).removeAlpha().raw().toBuffer()
        assert.equal(original.length, data.length)
        let changedPixels = 0
        for (let i = 0; i < data.length; i += info.channels) {
          if (Math.max(...[0, 1, 2].map((c) => Math.abs(data[i + c] - original[i + c]))) > 50) changedPixels++
        }
        const present = changedPixels > 50
        assert.equal(present, expected, `${mode}/${scene.id}/${label}: caption compositing mismatch`)
        samples.push({ label, time, changedPixels, present })
      }
      results.push({ mode, scene: scene.id, method: 'final minus normalized baseline; max-channel delta >50 on >50 pixels', start: cue.start, end: cue.end, samples, boundaryToleranceSeconds: 0.08 })
    }
  }
}
fs.writeFileSync(path.join(root, 'subtitle-boundaries.json'), JSON.stringify(results, null, 2))
console.log(JSON.stringify({ passedCues: results.length, boundaryToleranceSeconds: 0.08, evidence: folder }))
