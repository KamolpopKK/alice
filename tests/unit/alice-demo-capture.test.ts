import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { testDir } from '../helpers/tmp'
// @ts-expect-error standalone distributable
import { snapshotSource } from '../../skill/alice-demo/demo-core.mjs'
// @ts-expect-error standalone distributable
import { captureScene, importCapture } from '../../skill/alice-demo/demo-capture.mjs'

const manifest = (url: string) => ({ version: 1, source: snapshotSource({ id: 'doc_demo', title: 'Story', body: 'Capture', revision: 1 }), video: { width: 640, height: 360, fps: 30 }, narration: null, subtitles: false, scenes: [{ id: 'real', title: 'Real flow', type: 'capture', url, actions: 'actions.mjs', start: 0, duration: 0.6 }] })

describe('real browser demo capture', () => {
  it('records actual actions, finalizes footage and keeps auth state out of metadata', async () => {
    const root = testDir('demo-capture-')
    fs.symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'))
    fs.writeFileSync(path.join(root, 'actions.mjs'), `export async function perform(page) { await page.getByRole('button').click(); await page.getByText('Done ไทย').waitFor() }`)
    const server = http.createServer((_, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<button onclick="this.textContent='Done ไทย'">Start</button>`) }).listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address() as import('node:net').AddressInfo
    try {
      const m = manifest(`http://127.0.0.1:${address.port}`)
      await expect(captureScene(root, m, 'real')).rejects.toMatchObject({ code: 'ACTIONS_NOT_REVIEWED' })
      const record = await captureScene(root, m, 'real', { actionsReviewed: true })
      expect(record.provenance).toBe('Real browser capture')
      expect(record.duration).toBeGreaterThan(0.5)
      expect(fs.statSync(path.join(root, record.file)).size).toBeGreaterThan(100)
      expect(record).not.toHaveProperty('storageState')
      await expect(captureScene(root, manifest('http://127.0.0.1:1'), 'real', { actionsReviewed: true })).rejects.toThrow()
    } finally { server.close() }
  })

  it('rejects supplied media without video', async () => {
    const root = testDir('demo-import-'), m = manifest('https://example.test')
    const supplied = { ...m, scenes: [{ ...m.scenes[0], media: 'input.mp3' }] }
    fs.writeFileSync(path.join(root, 'input.mp3'), 'audio')
    await expect(importCapture(root, supplied, 'real', { inspect: async () => ({ duration: 2, streams: [{ codec_type: 'audio' }] }) })).rejects.toMatchObject({ code: 'INVALID_CAPTURE' })
  })
})
