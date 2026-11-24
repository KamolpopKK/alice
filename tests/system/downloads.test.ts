import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { APP_VERSION, MCP_CONTRACT_VERSION } from '../../src/shared/version'
import { startApp, tempDataDir, type RunningApp } from '../helpers/app'
// @ts-expect-error build script เป็น .mjs ไม่มี type declaration
import { buildDownloads } from '../../scripts/downloads-build.mjs'
import { testDir } from '../helpers/tmp'

const ROOT = path.resolve(import.meta.dirname, '../..')
const SKILL = fs.readFileSync(path.join(ROOT, 'skill/alice/SKILL.md'), 'utf8')

interface Manifest {
  version: string
  files: Array<{ name: string; path: string; bytes: number; sha256: string }>
}

let app: RunningApp
let bare: RunningApp

beforeAll(async () => {
  const downloads = tempDataDir('downloads')
  await buildDownloads(downloads, ROOT)
  ;[app, bare] = await Promise.all([
    startApp({ env: { ALICE_DOWNLOADS_DIR: downloads } }),
    startApp({ env: { ALICE_DOWNLOADS_DIR: tempDataDir('no-downloads') } }),
  ])
}, 120_000)
afterAll(async () => Promise.all([app?.stop(), bare?.stop()]))

async function fetchManifest(base: string): Promise<Manifest> {
  const res = await fetch(`${base}/downloads/manifest.json`)
  expect(res.status).toBe(200)
  return (await res.json()) as Manifest
}

describe('agent tooling downloads', () => {
  it('publishes a manifest whose checksums match the served bytes, without a session', async () => {
    const manifest = await fetchManifest(app.url)
    expect(manifest.version).toBe(APP_VERSION)
    expect(manifest.files.map((f) => f.name).sort()).toEqual(['alice-mcp-stdio.js', 'alice.js'])
    for (const file of manifest.files) {
      const res = await fetch(`${app.url}${file.path}`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('application/javascript')
      expect(res.headers.get('content-disposition')).toBe(`attachment; filename="${file.name}"`)
      expect(res.headers.get('set-cookie')).toBeNull()
      const body = Buffer.from(await res.arrayBuffer())
      expect(body.length).toBe(file.bytes)
      expect(createHash('sha256').update(body).digest('hex')).toBe(file.sha256)
      expect(body.subarray(0, 19).toString()).toBe('#!/usr/bin/env node')

      const again = await fetch(`${app.url}${file.path}`, { headers: { 'If-None-Match': res.headers.get('etag')! } })
      expect(again.status).toBe(304)
    }
  })

  it('downloaded tools run standalone with Node only', async () => {
    // ต้องอยู่นอก repo: ถ้าอยู่ใต้ repo Node จะไปเจอ node_modules ของ repo และพิสูจน์ไม่ได้ว่า standalone
    const dir = testDir('alice-fetched-')
    const home = tempDataDir('home')
    for (const name of ['alice.js', 'alice-mcp-stdio.js']) {
      fs.writeFileSync(path.join(dir, name), Buffer.from(await (await fetch(`${app.url}/downloads/${name}`)).arrayBuffer()))
    }
    const env = { PATH: process.env.PATH, HOME: home }
    const cli = spawnSync(process.execPath, [path.join(dir, 'alice.js'), 'install-skill', '--client', 'claude-code'], { env, encoding: 'utf8' })
    expect(cli.status).toBe(0)
    expect(fs.readFileSync(path.join(home, '.claude/skills/alice/SKILL.md'), 'utf8')).toBe(SKILL)
    // ทุก skill ต้องถูกฝังมาใน alice.js ด้วย โดยไม่ต้องมี source อยู่ข้าง ๆ
    for (const skill of ['alice-plan', 'alice-think', 'alice-spec', 'alice-curate']) {
      for (const file of fs.readdirSync(path.join(ROOT, 'skill', skill))) {
        expect(fs.readFileSync(path.join(home, '.claude/skills', skill, file), 'utf8')).toBe(fs.readFileSync(path.join(ROOT, 'skill', skill, file), 'utf8'))
      }
    }

    const adapter = spawnSync(process.execPath, [path.join(dir, 'alice-mcp-stdio.js'), '--version'], { env, encoding: 'utf8' })
    expect(adapter.status).toBe(0)
    expect(adapter.stdout).toContain(APP_VERSION)
    expect(adapter.stdout).toContain(`v${MCP_CONTRACT_VERSION}`)
  })

  it('answers JSON 404 for unknown files and never falls back to the HTML shell', async () => {
    for (const p of ['/downloads/alice-server.js', '/downloads/..%2Fpackage.json', '/downloads/nested/alice.js']) {
      const res = await fetch(`${app.url}${p}`)
      expect(res.status).toBe(404)
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND')
    }
  })

  it('reports downloads as unavailable when the server has no bundles', async () => {
    for (const p of ['/downloads/manifest.json', '/downloads/alice.js']) {
      const res = await fetch(`${bare.url}${p}`)
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('NOT_FOUND')
      expect(body.error.message).toMatch(/not available/)
    }
  })
})
