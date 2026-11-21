import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDir } from '../helpers/tmp'

/** The macOS install script verifies the release archive and installs without quarantine. */
const ROOT = path.resolve(import.meta.dirname, '../..')
const mac = process.platform === 'darwin'
let server: http.Server
let base = ''
let files: Record<string, Buffer> = {}

function fakeApp(): Buffer {
  const dir = testDir('alice-fake-app-')
  const app = path.join(dir, 'Alice.app/Contents')
  fs.mkdirSync(path.join(app, 'MacOS'), { recursive: true })
  fs.writeFileSync(path.join(app, 'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>alice-desktop</string><key>CFBundleIdentifier</key><string>app.alice.test</string></dict></plist>')
  fs.copyFileSync('/usr/bin/true', path.join(app, 'MacOS/alice-desktop'))
  execFileSync('codesign', ['--force', '--sign', '-', path.join(dir, 'Alice.app')])
  execFileSync('tar', ['-czf', path.join(dir, 'a.tgz'), '-C', dir, 'Alice.app'])
  return fs.readFileSync(path.join(dir, 'a.tgz'))
}

beforeAll(async () => {
  if (!mac) return
  const archive = fakeApp()
  files = {
    'Alice_aarch64.app.tar.gz': archive,
    SHA256SUMS: Buffer.from(`${createHash('sha256').update(archive).digest('hex')}  Alice_aarch64.app.tar.gz\n`),
  }
  server = http.createServer((req, res) => {
    const body = files[req.url!.slice(1)]
    if (!body) return res.writeHead(404).end()
    res.end(body)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(() => server?.close())

/** Async: the release folder is served from this same process, so a blocking spawn would deadlock. */
function install(dest: string): Promise<{ status: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', [path.join(ROOT, 'scripts/install-macos.sh')], { env: { PATH: '/usr/bin:/bin:/usr/sbin', HOME: os.tmpdir(), ALICE_DOWNLOAD_BASE: base, ALICE_INSTALL_DIR: dest, ALICE_INSTALL_ANY_ARCH: '1' } })
    let stderr = ''
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
    child.on('close', (status) => resolve({ status, stderr }))
  })
}

describe.skipIf(!mac)('install-macos.sh', () => {
  it('installs a checksum-verified, signed app with no quarantine attribute and without sudo', async () => {
    const dest = testDir('alice-apps-')
    const res = await install(dest)
    expect(res.status, res.stderr).toBe(0)
    expect(fs.existsSync(path.join(dest, 'Alice.app/Contents/MacOS/alice-desktop'))).toBe(true)
    expect(spawnSync('codesign', ['--display', path.join(dest, 'Alice.app')]).status).toBe(0)
    const quarantine = spawnSync('xattr', ['-p', 'com.apple.quarantine', path.join(dest, 'Alice.app')])
    expect(quarantine.status).not.toBe(0)
    expect(fs.readFileSync(path.join(ROOT, 'scripts/install-macos.sh'), 'utf8')).not.toMatch(/\bsudo\b(?! and)|spctl --master-disable/)
  })

  it('refuses a tampered archive and leaves the installed app untouched', async () => {
    const dest = testDir('alice-apps-')
    expect((await install(dest)).status).toBe(0)
    const before = fs.statSync(path.join(dest, 'Alice.app')).ino
    const good = files['Alice_aarch64.app.tar.gz']
    files['Alice_aarch64.app.tar.gz'] = Buffer.concat([good, Buffer.from('tampered')])
    const res = await install(dest)
    files['Alice_aarch64.app.tar.gz'] = good
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('checksum mismatch')
    expect(fs.statSync(path.join(dest, 'Alice.app')).ino).toBe(before)
  })
})
