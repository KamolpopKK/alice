import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(import.meta.dirname, '../..')
const TAURI = path.join(ROOT, 'src-tauri')
const read = (p: string) => fs.readFileSync(path.join(TAURI, p), 'utf8')

describe('Alice Desktop security configuration', () => {
  const conf = JSON.parse(read('tauri.conf.json'))
  const caps = fs.readdirSync(path.join(TAURI, 'capabilities')).map((f) => JSON.parse(read(`capabilities/${f}`)))
  const declared = [...read('build.rs').matchAll(/"([a-z_]+)",/g)].map((m) => m[1])

  it('grants the WebView only Alice commands and event listening', () => {
    const permissions = caps.flatMap((c) => c.permissions as string[])
    const allowed = new Set(['core:event:allow-listen', 'core:event:allow-unlisten', ...declared.map((c) => `allow-${c.replace(/_/g, '-')}`)])
    for (const p of permissions) expect(allowed.has(p), p).toBe(true)
    expect(permissions.some((p) => /shell|fs:|http:|opener|process|dialog|clipboard/.test(p))).toBe(false)
    expect(caps.every((c) => !c.remote)).toBe(true) // no remote origin may call commands
  })

  it('bundles no sidecar or server and loads only local assets under a strict CSP', () => {
    expect(conf.bundle.externalBin).toBeUndefined()
    expect(conf.bundle.resources).toBeUndefined()
    expect(conf.app.withGlobalTauri).toBe(false)
    const csp: string = conf.app.security.csp
    expect(csp).toMatch(/connect-src ipc: http:\/\/ipc\.localhost;/)
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("object-src 'none'")
    const cargo = read('Cargo.toml')
    for (const plugin of ['tauri-plugin-shell', 'tauri-plugin-fs', 'tauri-plugin-http', 'tauri-plugin-sql']) expect(cargo).not.toContain(plugin)
  })

  it('bundle verifier with --local-runtime requires exactly the verified runtime of the app version', async () => {
    const { createHash } = await import('node:crypto')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-bundle-local-'))
    fs.mkdirSync(path.join(dir, 'MacOS'))
    fs.mkdirSync(path.join(dir, 'Resources/runtime'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'MacOS/alice-desktop'), 'binary', { mode: 0o755 })
    const put = (rel: string, body: string, mode = 0o644) => fs.writeFileSync(path.join(dir, rel), body, { mode })
    put('MacOS/alice-node', 'node-binary', 0o755)
    put('Resources/runtime/alice.js', 'cli', 0o755)
    put('Resources/runtime/alice-server.js', 'server', 0o755)
    put('Resources/runtime/better_sqlite3.node', 'sqlite')
    const sha = (s: string) => createHash('sha256').update(s).digest('hex')
    const manifest = { format: 'alice-runtime', version: '1.2.3', files: [['node', 'node-binary'], ['alice.js', 'cli'], ['alice-server.js', 'server'], ['better_sqlite3.node', 'sqlite']].map(([p, b]) => ({ path: p, bytes: b.length, sha256: sha(b) })) }
    put('Resources/runtime/manifest.json', JSON.stringify(manifest))
    const run = (...extra: string[]) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/verify-desktop-bundle.mjs'), dir, '--local-runtime', ...extra], { encoding: 'utf8' })
    expect(run('--version', '1.2.3').status).toBe(0)
    expect(run('--version', '1.2.4').stderr).toContain('does not match the app 1.2.4')
    put('Resources/runtime/alice-server.js', 'foreign server', 0o755)
    expect(run().stderr).toContain('alice-server.js does not match its manifest')
    put('Resources/runtime/alice-server.js', 'server', 0o755)
    fs.rmSync(path.join(dir, 'MacOS/alice-node'))
    expect(run().stderr).toContain('expected exactly one runtime Node binary')
    // แบบที่ release ใช้จริง: node อยู่ใน Resources/runtime (ลงลายเซ็นก่อน bundle)
    put('Resources/runtime/node', 'node-binary', 0o755)
    expect(run('--version', '1.2.3').status).toBe(0)
    // แอปที่ลงลายเซ็นแล้วมี CodeResources ที่ระบุชื่อไฟล์ runtime (รวม better_sqlite3.node) — ไม่ใช่ของต้องห้าม
    fs.mkdirSync(path.join(dir, '_CodeSignature'))
    put('_CodeSignature/CodeResources', '<key>Resources/runtime/better_sqlite3.node</key>')
    expect(run('--version', '1.2.3').status).toBe(0)
    put('Resources/data.db', '')
    expect(run().stderr).toContain('forbidden file: Resources/data.db')
  })

  it('bundle verifier rejects Node runtimes, SQLite and sidecars', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-bundle-'))
    fs.mkdirSync(path.join(dir, 'MacOS'))
    fs.writeFileSync(path.join(dir, 'MacOS/alice-desktop'), 'binary', { mode: 0o755 })
    const run = () => spawnSync(process.execPath, [path.join(ROOT, 'scripts/verify-desktop-bundle.mjs'), dir], { encoding: 'utf8' })
    expect(run().status).toBe(0)
    fs.writeFileSync(path.join(dir, 'MacOS/node'), 'node', { mode: 0o755 })
    fs.writeFileSync(path.join(dir, 'alice.db'), '')
    const bad = run()
    expect(bad.status).toBe(1)
    expect(bad.stderr).toContain('forbidden file: MacOS/node')
    expect(bad.stderr).toContain('forbidden file: alice.db')
    expect(bad.stderr).toContain('expected one app executable')
  })
})
