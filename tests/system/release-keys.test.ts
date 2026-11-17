import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Release keys are generated outside the repository, owner-only, and usable
const ROOT = path.resolve(import.meta.dirname, '../..')
const SCRIPT = path.join(ROOT, 'scripts/release-keys.sh')
const run = (out: string) => spawnSync('bash', [SCRIPT, out], { encoding: 'utf8', cwd: ROOT })

describe.runIf(process.platform === 'darwin')('release keys script', () => {
  it('creates an updater key and a code-signing certificate, prints only commands, and leaves the repo clean', () => {
    const before = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' })
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'alice-keys-')), 'keys')
    const res = run(out)
    expect(res.status, res.stderr).toBe(0)
    const files = fs.readdirSync(out).sort()
    expect(files).toEqual(['macos-release.cert.pem', 'macos-release.p12', 'macos-release.password', 'updater.key', 'updater.key.pub', 'updater.password'])
    for (const f of files) expect(fs.statSync(path.join(out, f)).mode & 0o077, f).toBe(0)
    // ไม่พิมพ์ค่าลับออกมา มีแต่คำสั่งที่อ่านจากไฟล์
    for (const f of ['updater.key', 'updater.password', 'macos-release.password']) expect(res.stdout).not.toContain(fs.readFileSync(path.join(out, f), 'utf8').trim())
    expect(res.stdout).toContain('gh secret set TAURI_SIGNING_PRIVATE_KEY -R KamolpopKK/alice <')
    expect(res.stdout).toContain('releases/latest/download/latest.json')

    // ใบรับรองใช้ลงลายเซ็นโค้ดได้
    const cert = execFileSync('openssl', ['x509', '-in', path.join(out, 'macos-release.cert.pem'), '-noout', '-text'], { encoding: 'utf8' })
    expect(cert).toMatch(/Code Signing/)
    expect(cert).toMatch(/CN ?= ?Alice Release \(self-signed\)/)
    // updater key ใช้ลงนามไฟล์อัปเดตได้
    const file = path.join(path.dirname(out), 'update.bin')
    fs.writeFileSync(file, 'update')
    const signed = spawnSync('npx', ['--no-install', 'tauri', 'signer', 'sign', '-f', path.join(out, 'updater.key'), '-p', fs.readFileSync(path.join(out, 'updater.password'), 'utf8'), file], { cwd: ROOT, encoding: 'utf8' })
    expect(signed.status, signed.stderr).toBe(0)
    expect(fs.existsSync(`${file}.sig`)).toBe(true)

    // รันซ้ำต้องไม่ทับ key เดิม และห้ามเขียนลงใน repository
    expect(run(out).stderr).toContain('refusing to overwrite release keys')
    const inside = run('release-keys-test')
    expect(inside.stderr).toContain('choose a folder outside the repository')
    expect(fs.existsSync(path.join(ROOT, 'release-keys-test'))).toBe(false)
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' })).toBe(before)
  }, 120_000)
})
