/** Controlled qualification, not an independent agent/user evaluation. Online calls use synthetic text only. */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { startApp } from '../helpers/app'
import { bootstrapOwner } from '../helpers/client'
import { testDir } from '../helpers/tmp'
// @ts-expect-error standalone distributable
import { snapshotSource, assertSourceRevision, writeJson, preflight, runTool } from '../../skill/alice-demo/demo-core.mjs'
// @ts-expect-error standalone distributable
import { generateSample, generateNarration, listVoices } from '../../skill/alice-demo/demo-audio.mjs'
// @ts-expect-error standalone distributable
import { captureScene } from '../../skill/alice-demo/demo-capture.mjs'
// @ts-expect-error standalone distributable
import { renderHtmlScene } from '../../skill/alice-demo/demo-html.mjs'
// @ts-expect-error standalone distributable
import { renderVideo, verifyVideo } from '../../skill/alice-demo/demo-render.mjs'

const destination = process.env.DEMO_EVIDENCE_DIR ?? '/private/tmp/alice-demo-evidence'
const root = testDir('qualification-', destination)
fs.writeFileSync(path.join(destination, 'latest.txt'), root)
const tools = { ffmpeg: process.env.DEMO_FFMPEG ?? 'ffmpeg', ffprobe: process.env.DEMO_FFPROBE ?? 'ffprobe', python: process.env.DEMO_PYTHON ?? 'python3' }
const transcript: object[] = []
const record = (event: string, detail: object = {}) => {
  transcript.push({ at: new Date().toISOString(), event, ...detail })
  fs.writeFileSync(path.join(root, 'transcript.json'), JSON.stringify(transcript, null, 2))
  console.log(JSON.stringify({ event, ...detail }))
}
const phrases = ['อลิซช่วยให้ทีมทำงานร่วมกันผ่านบอร์ดเดียว', 'เลือกงาน ตรวจ API แล้วเริ่มทำตามลำดับ 1 2 3', 'ตรวจผลงานก่อนส่งมอบ พร้อมเก็บต้นฉบับไว้ใช้ซ้ำ']
const app = await startApp()
const site = http.createServer((req, res) => {
  const index = Number(new URL(req.url!, 'http://localhost').searchParams.get('scene') ?? 0)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><html lang="th"><meta charset="utf-8"><style>body{background:#14213a;color:#fff;font:42px sans-serif;padding:90px}button{padding:24px;font-size:36px}p{line-height:1.7}</style><h1>ตัวอย่างเว็บสำหรับทดสอบ capture</h1><p>${phrases[index]}</p><button onclick="this.textContent='บันทึกแล้ว';document.querySelector('#state').textContent='พร้อมทำ → กำลังทำ'">เริ่มทำงาน</button><p id="state">พร้อมทำ</p><small>ข้อมูลสังเคราะห์ ไม่ใช่ระบบ production</small></html>`)
}).listen(0, '127.0.0.1')
await once(site, 'listening')
try {
  const owner = await bootstrapOwner(app)
  const address = site.address() as import('node:net').AddressInfo
  record('environment', { platform: os.platform(), arch: os.arch(), release: os.release(), cpu: os.cpus()[0].model, node: process.version, tools,
    method: 'Codex-controlled scenario fixture with simulated user choices and sample approval; not an independent agent evaluation or real user approval.' })
  const voices = await listVoices({ python: tools.python })
  const thai = voices.filter((v: any) => v.Locale === 'th-TH')
  assert(thai.length > 0)
  record('thai-voices', { voices: thai.map((v: any) => v.ShortName) })
  const chosen = thai.find((v: any) => v.Gender === 'Female') ?? thai[0]
  for (const mode of ['capture', 'html', 'mixed']) {
    const job = path.join(root, mode)
    fs.mkdirSync(job)
    fs.mkdirSync(path.join(job, 'assets'))
    fs.symlinkSync(path.resolve('node_modules'), path.join(job, 'node_modules'))
    fs.copyFileSync(process.env.DEMO_FONT_FILE ?? '/System/Library/Fonts/Supplemental/Ayuthaya.ttf', path.join(job, 'assets/ThaiFont.ttf'))
    const license = process.env.DEMO_FONT_LICENSE
    if (license) fs.copyFileSync(license, path.join(job, 'assets/OFL.txt'))
    const reuse = process.env.DEMO_REUSE_MEDIA_DIR
    const audioReuse = process.env.DEMO_REUSE_AUDIO_DIR
    if (audioReuse && fs.existsSync(path.join(audioReuse, mode, 'media/audio'))) {
      fs.cpSync(path.join(audioReuse, mode, 'media/audio'), path.join(job, 'media/audio'), { recursive: true })
    }
    if (reuse) {
      for (const kind of ['audio', 'capture']) {
        const previous = path.join(reuse, mode, 'media', kind)
        if (fs.existsSync(previous)) fs.cpSync(previous, path.join(job, 'media', kind), { recursive: true })
      }
    }
    fs.copyFileSync('skill/alice-demo/scene-template.html', path.join(job, 'scene.html'))
    fs.writeFileSync(path.join(job, 'actions.mjs'), `export async function perform(page) { await page.getByRole('button',{name:'เริ่มทำงาน'}).click(); await page.getByText('พร้อมทำ → กำลังทำ').waitFor() }\n`)
    const provider = mode === 'capture' ? 'gtts' : mode === 'html' ? 'edge-tts' : null
    const body = `# ${mode} storyboard\nAudience: product teammates. Goal: understand one shared board.\nLanguage: Thai. Tone: clear walkthrough. Destination: local preview. Duration: 30s. 16:9, 1920x1080 at 30fps. Subtitles: yes, Thai.\nCapture is a synthetic interactive test app, not production. HTML is a concept presentation.\nScenes: ${phrases.map((p, i) => `${i + 1}: purpose=${['shared board', 'context then work', 'review and deliver'][i]}; on-screen/narration/subtitle=${p}; start=${i * 10}; end=${(i + 1) * 10}; duration=10s; source=${mode === 'html' || (mode === 'mixed' && i === 1) ? 'scene.html with explicit fade-in' : `http://127.0.0.1:${address.port}/?scene=${i}`}; initial state=ready with synthetic data; action=click Start, expect in-progress; emphasis=state and sentence; transition=cut`).join('\n')}\nNarration: ${provider ?? 'none'}, language=th${provider === 'edge-tts' ? `, voice=${chosen.ShortName}, rate=+0%, volume=+0%, pitch=+0Hz` : ''}. User may choose another tool; no provider switch. Pronunciation substitutions: none. Font supplied locally. No publication.`
    const created = await owner.post('/api/documents', { title: `Demo ${mode} qualification storyboard`, body: body + '\nDraft wording.' })
    assert.equal(created.status, 201)
    const doc = created.body.document
    await owner.patch(`/api/documents/${doc.id}`, { body: body + '\nUser fixture edit: use the final agreed wording.' })
    const fresh = async () => {
      const result = await owner.get(`/api/documents/${doc.id}`)
      assert.equal(result.status, 200)
      return result.body.document
    }
    const source = snapshotSource(await fresh())
    assert.equal(source.revision, 2)
    assert(source.body.includes('final agreed wording'))
    writeJson(job, 'source.json', source)
    record('fresh-read-after-simulated-approval', { mode, revision: source.revision, sourceHash: source.hash })
    const m = { version: 1, source, video: { width: 1920, height: 1080, fps: 30 },
      narration: provider ? { provider, language: 'th', ...(provider === 'edge-tts' ? { voice: chosen.ShortName } : {}) } : null,
      subtitles: true, font: 'assets/ThaiFont.ttf', assets: license ? ['assets/OFL.txt'] : [],
      scenes: phrases.map((text, i) => {
        const type = mode === 'html' || (mode === 'mixed' && i === 1) ? 'html' : 'capture'
        return { id: `scene${i + 1}`, title: ['บอร์ดเดียวของทีม', 'เริ่มทำงานอย่างมีบริบท', 'ตรวจและส่งมอบ'][i], type,
          ...(type === 'html' ? { html: 'scene.html' } : { url: `http://127.0.0.1:${address.port}/?scene=${i}`, actions: 'actions.mjs' }),
          start: i * 10, duration: 10, onScreenText: text, disclosure: 'ภาพประกอบแนวคิด / ข้อมูลสังเคราะห์',
          cues: [{ id: 'speech', text, ...(!provider ? { start: 1, end: 9 } : {}) }] }
      }) }
    writeJson(job, 'manifest.json', m)
    const versions = await preflight(job, m, tools)
    record('preflight', { mode, versions })
    if (provider) {
      const sample = await generateSample(job, m, { python: tools.python })
      record('sample-generated', { mode, provider, file: path.join(job, sample.file), duration: sample.duration, listening: 'pending actual listening; sample approval here is a controlled fixture input' })
      await generateNarration(job, m, { python: tools.python, sampleApproved: true })
    }
    for (const scene of m.scenes) {
      assertSourceRevision(source, await fresh())
      if (scene.type === 'capture' && reuse && fs.existsSync(path.join(job, `media/capture/${scene.id}.json`))) {
        record('reuse-saved-capture', { mode, scene: scene.id, note: 'Re-rendering retained real fixture footage, not a new capture' })
      } else if (scene.type === 'capture') await captureScene(job, m, scene.id, { actionsReviewed: true })
      else await renderHtmlScene(job, m, scene.id)
      record('scene-ready', { mode, scene: scene.id, type: scene.type })
    }
    const result = await renderVideo(job, m, { readSource: fresh, tools })
    const packageDir = path.join(job, result.sourcePackage)
    await runTool(process.execPath, [path.join(packageDir, 'reproduce.mjs')], { env: { ...process.env, DEMO_FFMPEG: tools.ffmpeg }, timeoutMs: 3_600_000 })
    await verifyVideo(path.join(packageDir, 'reproduced.mp4'), m)
    const documentBefore = await fresh()
    assert.equal(documentBefore.revision, 2)
    const list = await owner.get('/api/documents')
    record('render-and-reproduce', { mode, output: path.join(job, result.output), sourcePackage: packageDir, metadata: result.metadata, elapsedMs: result.elapsedMs,
      storyboardUnchanged: documentBefore.revision === 2, deliveryDocumentsCreated: 0, visualAndListening: 'pending actual review', currentDocumentCount: list.body.items?.length ?? list.body.documents?.length })
    await owner.patch(`/api/documents/${doc.id}`, { body: documentBefore.body + '\nChanged during production fixture.' })
    assert.throws(() => assertSourceRevision(source, { ...source, revision: 3 }))
    const changed = await fresh()
    await assert.rejects(renderVideo(job, m, { readSource: async () => changed, tools }), { code: 'SOURCE_CHANGED' })
    record('source-change-stops-production', { mode, latestRevision: changed.revision })
  }
  record('automated-media-complete', { root, note: 'Visual/listening and measured subtitle edge review still required. No claim of independent evaluation.' })
} catch (error: any) {
  record('failed', { code: error.code ?? 'ERROR', message: error.message })
  process.exitCode = 1
} finally {
  site.close()
  await app.stop()
}
