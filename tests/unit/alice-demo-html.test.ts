import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { testDir } from '../helpers/tmp'
// @ts-expect-error standalone distributable
import { snapshotSource, hash } from '../../skill/alice-demo/demo-core.mjs'
// @ts-expect-error standalone distributable
import { renderHtmlScene } from '../../skill/alice-demo/demo-html.mjs'

const manifest = () => ({ version: 1, source: snapshotSource({ id: 'doc_demo', title: 'Story', body: 'HTML', revision: 1 }), video: { width: 640, height: 360, fps: 10 }, narration: null, subtitles: false, scenes: [{ id: 'html', title: 'อธิบายโฟลว์', onScreenText: 'ข้อความภาษาไทยและ API 123', type: 'html', html: 'scene.html', start: 0, duration: 0.4, disclosure: 'Concept' }] })
const setup = () => {
  const root = testDir('demo-html-')
  fs.symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'))
  fs.copyFileSync('skill/alice-demo/scene-template.html', path.join(root, 'scene.html'))
  return root
}

describe('explicit HTML frame rendering', () => {
  it('exports correct frame count and repeats explicit frame times', async () => {
    const root = setup(), m = manifest()
    const a = await renderHtmlScene(root, m, 'html'), b = await renderHtmlScene(root, m, 'html')
    expect(a.count).toBe(4)
    for (const frame of ['000000.png', '000002.png', '000003.png']) {
      expect(hash(fs.readFileSync(path.join(root, a.directory, frame)))).toBe(hash(fs.readFileSync(path.join(root, b.directory, frame))))
    }
    expect(a.provenance).toBe('Concept')
  })

  it('rejects missing assets and a missing explicit timeline', async () => {
    const root = setup(), m = manifest()
    fs.writeFileSync(path.join(root, 'scene.html'), '<meta charset="utf-8"><img src="missing.png"><script>window.renderAt=()=>{}</script>')
    await expect(renderHtmlScene(root, m, 'html')).rejects.toMatchObject({ code: 'SCENE_NOT_READY' })
    fs.writeFileSync(path.join(root, 'scene.html'), '<p>Not a timed scene</p>')
    await expect(renderHtmlScene(root, m, 'html')).rejects.toMatchObject({ code: 'SCENE_NOT_READY' })
    await expect(renderHtmlScene(root, { ...m, font: 'absent.ttf' }, 'html')).rejects.toThrow()
  })
})
