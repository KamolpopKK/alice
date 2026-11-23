/** Fixture-specific visible caption boundary check; complements human audio review. */
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
  const output = events.find((e: any) => e.event === 'render-and-reproduce' && e.mode === mode)?.output
  assert(output, `Missing ${mode} output`)
  const m = readJson(path.join(root, mode, 'manifest.json'))
  const audio = m.narration ? readJson(path.join(root, mode, 'audio.json')) : null
  for (const scene of m.scenes) {
    const cues = audio ? audio.scenes.find((s: any) => s.id === scene.id).cues : scene.cues
    for (const cue of cues) {
      const samples = []
      for (const [label, time, expected] of [
        ['before', scene.start + cue.start - 0.08, false], ['during', scene.start + cue.start + 0.08, true],
        ['last', scene.start + cue.end - 0.08, true], ['after', scene.start + cue.end + 0.08, false],
      ] as [string, number, boolean][]) {
        const file = path.join(folder, `${mode}-${scene.id}-${cue.id}-${label}.png`)
        await runTool('ffmpeg', ['-v', 'error', '-ss', String(Math.max(0, time)), '-i', output, '-vf', 'crop=1920:180:0:900', '-frames:v', '1', file])
        const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
        let whitePixels = 0
        for (let i = 0; i < data.length; i += info.channels) if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) whitePixels++
        const present = whitePixels > 50
        assert.equal(present, expected, `${mode}/${scene.id}/${label}: caption presence mismatch`)
        samples.push({ label, time, whitePixels, present })
      }
      results.push({ mode, scene: scene.id, start: cue.start, end: cue.end, samples, boundaryToleranceSeconds: 0.08 })
    }
  }
}
fs.writeFileSync(path.join(root, 'subtitle-boundaries.json'), JSON.stringify(results, null, 2))
console.log(JSON.stringify({ passedCues: results.length, boundaryToleranceSeconds: 0.08, evidence: folder }))
