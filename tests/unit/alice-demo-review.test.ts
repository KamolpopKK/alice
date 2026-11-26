import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { testDir } from '../helpers/tmp'
// @ts-expect-error standalone distributable
import { runTool, hash, writeJson } from '../../skill/alice-demo/demo-core.mjs'
// @ts-expect-error standalone distributable
import { normalizedSceneMap, reviewPositions, createContactSheets, verifyReviewPackage } from '../../skill/alice-demo/demo-review.mjs'

const setup = async () => {
  const root = testDir('contact-sheet-', path.resolve('.alice-test/demo-visual'))
  fs.symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'))
  const m = { video: { width: 320, height: 180, fps: 10 }, scenes: [
    { id: 'a', title: 'First', duration: 0.31 }, { id: 'b', title: 'Second', duration: 0.51 },
  ] }
  for (const [i, color] of ['blue', 'green'].entries()) await runTool('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=320x180:r=10`, '-frames:v', i === 0 ? '4' : '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(root, `${i}.mp4`)])
  fs.writeFileSync(path.join(root, 'concat.txt'), "file '0.mp4'\nfile '1.mp4'\n")
  await runTool('ffmpeg', ['-v', 'error', '-f', 'concat', '-safe', '1', '-i', path.join(root, 'concat.txt'), '-c', 'copy', path.join(root, 'final.mp4')])
  const sceneMap = await normalizedSceneMap(root, m, ['0.mp4', '1.mp4'])
  return { root, m, sceneMap }
}

describe('final-video contact sheets', () => {
  it('maps actual fractional-duration normalized frames and samples both sides of cuts', async () => {
    const { root, sceneMap } = await setup()
    expect(sceneMap.scenes[1].start).toBe(0.4)
    const samples = reviewPositions(sceneMap)
    expect(samples.find((s: any) => s.frame === 3).roles).toContain('a:before-cut')
    expect(samples.find((s: any) => s.frame === 4).roles).toContain('b:after-cut')
    const review = await createContactSheets(root, { output: 'final.mp4', sceneMap })
    expect(await verifyReviewPackage(root, review)).toBe(true)
    expect(review.samples.map((s: any) => s.frame)).toEqual([0, 1, 3, 4, 6, 9])
    expect(review.samples[0].hash).not.toBe(review.samples.at(-1).hash)
    expect(review.samples.find((s: any) => s.frame === 3).hash).toBe(review.samples[0].hash)
    expect(review.samples.find((s: any) => s.frame === 4).hash).toBe(review.samples.at(-1).hash)
    writeJson(root, 'sheet-evidence.json', review)
    fs.appendFileSync(path.join(root, 'final.mp4'), 'changed')
    await expect(verifyReviewPackage(root, review)).rejects.toMatchObject({ code: 'STALE_REVIEW' })
    await expect(createContactSheets(root, { output: 'final.mp4', sceneMap, expectedHash: review.videoHash })).rejects.toMatchObject({ code: 'STALE_REVIEW' })
  })

  it('splits readable sheets without losing short-scene or seam coverage', async () => {
    const { root } = await setup()
    const scenes = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, title: `Scene <${i}>`, startFrame: i * 2, endFrame: i * 2 + 2, count: 2 }))
    expect(reviewPositions({ fps: 10, frameCount: 10, scenes })).toHaveLength(10)
    await runTool('ffmpeg', ['-v', 'error', '-stream_loop', '-1', '-i', path.join(root, '0.mp4'), '-frames:v', '25', '-c:v', 'libx264', path.join(root, 'long.mp4')])
    const sceneMap = { fps: 10, frameCount: 25, scenes: scenes.map((s, i) => ({ ...s, startFrame: i * 5, endFrame: i * 5 + 5, count: 5 })) }
    const review = await createContactSheets(root, { output: 'long.mp4', sceneMap })
    expect(review.samples).toHaveLength(15)
    expect(review.sheets).toHaveLength(2)
    expect(await verifyReviewPackage(root, review)).toBe(true)
    const html = fs.readFileSync(path.join(root, review.sheets[0].file.replace('.png', '.html')), 'utf8')
    expect(html).toContain('Scene &lt;0&gt;')
    fs.writeFileSync(path.join(root, review.sheets[0].file), 'tampered sheet')
    await expect(verifyReviewPackage(root, review)).rejects.toMatchObject({ code: 'STALE_REVIEW' })
  })

  it('preserves the final MP4 when extraction fails and rejects inconsistent maps', async () => {
    const { root, sceneMap } = await setup()
    const before = hash(fs.readFileSync(path.join(root, 'final.mp4')))
    await expect(createContactSheets(root, { output: 'final.mp4', sceneMap }, { run: async () => { throw new Error('extraction failed') } })).rejects.toMatchObject({ code: 'REVIEW_INCOMPLETE' })
    expect(hash(fs.readFileSync(path.join(root, 'final.mp4')))).toBe(before)
    expect(fs.readdirSync(path.join(root, 'reviews')).length).toBe(1)
    expect(() => reviewPositions({ ...sceneMap, frameCount: 99 })).toThrow()
    await expect(createContactSheets(root, { output: 'final.mp4', sceneMap: { ...sceneMap, frameCount: 99 } })).rejects.toMatchObject({ code: 'INVALID_SCENE_MAP' })
  })
})
