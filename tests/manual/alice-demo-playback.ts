/** Observe normal muted browser playback; human listening evidence is recorded separately. */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { testDir } from '../helpers/tmp'
// @ts-expect-error standalone distributable
import { readJson, writeJson, loadPlaywright, hash } from '../../skill/alice-demo/demo-core.mjs'

const root = path.resolve(process.argv[2])
const events = readJson(path.join(root, 'transcript.json'))
const folder = testDir('playback-', root)
const browser = await loadPlaywright(path.join(root, 'html')).chromium.launch({ headless: true })
const observations = []
try {
  for (const mode of ['capture', 'html', 'mixed']) {
    const output = events.findLast((e: any) => e.event === 'render-and-reproduce' && e.mode === mode)?.output
    assert(output)
    const player = path.join(folder, `${mode}.html`)
    fs.writeFileSync(player, `<!doctype html><style>html,body{margin:0;background:#000}video{display:block;width:100vw;height:100vh;object-fit:contain}</style><video muted playsinline src="${pathToFileURL(output).href}"></video>`)
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
    await page.goto(pathToFileURL(player).href)
    await page.evaluate(async () => { const v = document.querySelector('video')!; v.muted = true; await v.play() })
    const points = [0.5, 3, 6, 9, 10.5, 13, 16, 19, 20.5, 23, 26, 29]
    const frames = []
    for (const [i, target] of points.entries()) {
      await page.waitForFunction((t: number) => document.querySelector('video')!.currentTime >= t, target, { timeout: 12_000 })
      const state = await page.evaluate(() => { const v = document.querySelector('video')!; return { time: v.currentTime, rate: v.playbackRate, width: v.videoWidth, height: v.videoHeight, paused: v.paused, muted: v.muted } })
      assert.equal(state.rate, 1)
      assert.equal(state.paused, false)
      assert.equal(state.width, 1920)
      assert.equal(state.height, 1080)
      const file = path.join(folder, `${mode}-${i}.png`)
      await page.screenshot({ path: file })
      frames.push({ ...state, file, hash: hash(fs.readFileSync(file)) })
      console.log(JSON.stringify({ event: 'playback-frame', mode, ...state, file }))
    }
    await page.waitForFunction(() => document.querySelector('video')!.ended, undefined, { timeout: 12_000 })
    observations.push({ mode, output, outputHash: hash(fs.readFileSync(output)), frames, ended: true, method: 'normal 1x muted browser playback, no seeking; observed screenshots; no agent listening claim' })
    await page.close()
  }
  writeJson(root, 'playback-observations.json', observations)
} finally { await browser.close() }
