import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { testDir } from '../helpers/tmp'
// @ts-expect-error standalone distributable
import { snapshotSource, hash } from '../../skill/alice-demo/demo-core.mjs'
// @ts-expect-error standalone distributable
import { renderHtmlScene, htmlInputHash, openHtmlScene } from '../../skill/alice-demo/demo-html.mjs'

const manifest = () => ({ version: 1, source: snapshotSource({ id: 'doc_demo', title: 'Story', body: 'HTML', revision: 1 }), video: { width: 640, height: 360, fps: 10 }, narration: null, subtitles: false, scenes: [{ id: 'html', title: 'อธิบายโฟลว์', onScreenText: 'ข้อความภาษาไทยและ API 123', type: 'html', html: 'scene.html', start: 0, duration: 0.4, disclosure: 'Concept' }] })
const setup = () => {
  const root = testDir('demo-html-', path.resolve('.alice-test/demo-visual'))
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
    expect(a.inputHash).not.toBe(htmlInputHash(root, m, { ...m.scenes[0], onScreenText: 'Changed storyboard text' }))
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

// @ts-expect-error standalone distributable
import { stylePresets, directionSceneHtml } from '../../skill/alice-demo/demo-styles.mjs'
// @ts-expect-error standalone distributable
import { writeJson } from '../../skill/alice-demo/demo-core.mjs'
const v2 = () => ({ ...manifest(), version: 2, purpose: 'sample', visual: structuredClone(stylePresets[0].visual),
  review: { mode: 'video5', sceneId: 'html', start: 0 }, render: { seed: 12, localTime: true, toolVersions: { chromium: 'fixture' } },
  scenes: [{ ...manifest().scenes[0], dependencies: [] }] })
const permit = async (b: any) => ({ stage: b.stage, sourceHash: b.source.hash, inputHash: b.inputHash, reference: 'controlled fixture, not user approval' })

describe('native time-derived motion', () => {
  it('renders repeated and out-of-order frames identically for every motion vocabulary', async () => {
    const root = setup(), m = v2()
    const evidence: any[] = []
    for (const motion of ['reveal', 'stagger', 'focus', 'handoff', 'none']) {
      const visual = { ...m.visual, motion }
      fs.writeFileSync(path.join(root, 'scene.html'), directionSceneHtml(visual, { ...m.scenes[0], duration: 5, seed: 12 }))
      const { browser, page, render } = await openHtmlScene(root, m, m.scenes[0])
      try {
        const pixels = new Map<number, string>()
        let sample = 0
        for (const t of [0.3, 2.4, 0, 2.4, 0.3, 0]) {
          await render(t)
          const file = `${motion}-${sample++}.png`
          const current = hash(await page.screenshot({ path: path.join(root, file), animations: 'disabled' }))
          evidence.push({ motion, t, file, hash: current, chromium: browser.version() })
          if (pixels.has(t)) expect(current, `${motion} at ${t}`).toBe(pixels.get(t))
          pixels.set(t, current)
        }
        if (motion !== 'none') expect(pixels.get(0)).not.toBe(pixels.get(2.4))
      } finally { await browser.close() }
    }
    writeJson(root, 'motion-evidence.json', evidence)
    if (process.env.ALICE_KEEP_TEST_DIRS === '1') console.log(`Motion evidence: ${root}`)
  })

  it('rejects hidden history and independent CSS time while preserving prior frame metadata', async () => {
    const root = setup(), m = v2()
    writeJson(root, 'source.json', m.source)
    writeJson(root, 'media/frames/html.json', { previous: true })
    const options = { readSource: async () => m.source, authorize: permit }
    fs.writeFileSync(path.join(root, 'scene.html'), '<div id="x">ไทย</div><script>let n=0;window.renderAt=()=>{document.querySelector("#x").style.paddingLeft=(++n)+"px"}</script>')
    await expect(renderHtmlScene(root, m, 'html', options)).rejects.toMatchObject({ code: 'NONDETERMINISTIC_SCENE' })
    expect(JSON.parse(fs.readFileSync(path.join(root, 'media/frames/html.json'), 'utf8'))).toEqual({ previous: true })
    fs.writeFileSync(path.join(root, 'scene.html'), '<style>@keyframes move{to{opacity:0}}div{animation:move 1s infinite}</style><div>ไทย</div><script>window.renderAt=()=>{}</script>')
    await expect(renderHtmlScene(root, m, 'html', options)).rejects.toMatchObject({ code: 'WALL_CLOCK_ANIMATION' })
  })
})

describe('approved dependency-aware HTML reuse', () => {
  it('rebinds unchanged frames to fresh source and invalidates only affected dependencies', async () => {
    const root = setup(), m: any = v2(), matrix: any[] = []
    writeJson(root, 'source.json', m.source)
    m.scenes.push({ ...m.scenes[0], id: 'second', start: 0.4, title: 'Second' })
    const options = { readSource: async () => m.source, authorize: permit }
    const first = await renderHtmlScene(root, m, 'html', options), second = await renderHtmlScene(root, m, 'second', options)
    m.source = snapshotSource({ ...m.source, body: 'Approved revision; unchanged media inputs', revision: 2 })
    writeJson(root, 'source.json', m.source)
    const reused = await renderHtmlScene(root, m, 'html', options)
    expect(reused.cached).toBe(true)
    expect(reused.directory).toBe(first.directory)
    expect(reused.createdFrom.revision).toBe(1)
    expect(reused.validatedFor.revision).toBe(2)
    matrix.push({ case: 'fresh source, equivalent media', before: first, after: reused })
    m.scenes[0].onScreenText = 'Changed only first scene'
    const changed = await renderHtmlScene(root, m, 'html', options), intact = await renderHtmlScene(root, m, 'second', options)
    expect(changed.cached).toBe(false)
    expect(intact.directory).toBe(second.directory)
    matrix.push({ case: 'one scene', changed, intact })
    m.visual.palette.accent = '#cc0000'
    const global = await renderHtmlScene(root, m, 'second', options)
    expect(global.cached).toBe(false)
    matrix.push({ case: 'shared style', after: global })
    fs.writeFileSync(path.join(root, global.directory, '000000.png'), 'corrupt')
    expect((await renderHtmlScene(root, m, 'second', options)).cached).toBe(false)
    const old = htmlInputHash(root, m, m.scenes[1])
    expect(old).toBe(htmlInputHash(root, m, { ...m.scenes[1], start: 100 }))
    expect(old).not.toBe(htmlInputHash(root, { ...m, render: { ...m.render, localTime: false } }, m.scenes[1]))
    expect(old).not.toBe(htmlInputHash(root, { ...m, render: { ...m.render, toolVersions: { chromium: 'new-version' } } }, m.scenes[1]))
    expect(old).not.toBe(htmlInputHash(root, m, { ...m.scenes[1], duration: 1 }))
    fs.writeFileSync(path.join(root, 'shared.css'), 'body{color:green}')
    m.visual.dependencies = ['shared.css']
    const shared = htmlInputHash(root, m, m.scenes[1])
    fs.writeFileSync(path.join(root, 'shared.css'), 'body{color:red}')
    expect(shared).not.toBe(htmlInputHash(root, m, m.scenes[1]))
    writeJson(root, 'cache-evidence.json', matrix)
  })

  it('blocks undeclared imports instead of reusing HTML-only fingerprints', async () => {
    const root = setup(), m = v2()
    writeJson(root, 'source.json', m.source)
    fs.writeFileSync(path.join(root, 'extra.css'), 'body{background:red}')
    fs.appendFileSync(path.join(root, 'scene.html'), '<link rel="stylesheet" href="extra.css">')
    const options = { readSource: async () => m.source, authorize: permit }
    await expect(renderHtmlScene(root, m, 'html', options)).rejects.toMatchObject({ code: 'UNDECLARED_DEPENDENCY' })
    const declared = { ...m, scenes: [{ ...m.scenes[0], dependencies: ['extra.css'] }] }
    expect((await renderHtmlScene(root, declared, 'html', options)).dependenciesComplete).toBe(true)
  })
})

it('keeps native disclosure text above the caption region', async () => {
  const root = setup(), m = v2()
  fs.writeFileSync(path.join(root, 'scene.html'), directionSceneHtml(m.visual, { ...m.scenes[0], disclosure: 'Concept / synthetic fixture', duration: 5 }))
  const { browser, page, render } = await openHtmlScene(root, m, m.scenes[0])
  try {
    await render(2)
    const bounds = await page.locator('footer').boundingBox()
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(m.video.height * 0.86 + 1)
  } finally { await browser.close() }
})

it('retains every approved flow label instead of truncating after four steps', async () => {
  const root = setup(), m = v2()
  const steps = ['Research', 'Planning', 'Specification', 'Implementation', 'Verification', 'Delivery']
  fs.writeFileSync(path.join(root, 'scene.html'), directionSceneHtml({ ...m.visual, layout: 'diagram' }, { ...m.scenes[0], steps }))
  const { browser, page, render } = await openHtmlScene(root, m, m.scenes[0])
  try {
    await render(2)
    expect(await page.locator('.step span').allTextContents()).toEqual(steps)
    expect(await page.locator('.step').last().isVisible()).toBe(true)
  } finally { await browser.close() }
})
