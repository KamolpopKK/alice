import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { testDir } from '../helpers/tmp'

const ROOT = path.resolve(import.meta.dirname, '../..')
const load = (f: string) => {
  const text = fs.readFileSync(path.join(ROOT, '.github/workflows', f), 'utf8')
  return { text, doc: parse(text) as any }
}

describe('client release workflow', () => {
  const { text, doc } = load('release.yml')

  it('builds every supported desktop target and the standalone CLI', () => {
    const platforms = doc.jobs.desktop.strategy.matrix.include.map((m: { platform: string }) => m.platform)
    expect(platforms.sort()).toEqual(['darwin-aarch64', 'darwin-x86_64', 'linux-aarch64', 'linux-x86_64', 'windows-x86_64'])
    expect(doc.jobs.cli.steps.some((s: { run?: string }) => s.run?.includes('node alice.js version'))).toBe(true)
    expect(doc.jobs.publish.needs).toEqual(['desktop', 'cli', 'image-manifest'])
  })

  it('builds macOS on runner images GitHub still offers (macos-13/14 are retired and never start)', () => {
    const runners = Object.fromEntries(doc.jobs.desktop.strategy.matrix.include.map((m: { platform: string; runner: string }) => [m.platform, m.runner]))
    expect(runners['darwin-aarch64']).toBe('macos-15')
    expect(runners['darwin-x86_64']).toBe('macos-15-intel')
  })

  it('hands Tauri only the Apple secrets that are actually set (empty ones would override the self-signed identity)', () => {
    const build = doc.jobs.desktop.steps.find((s: { name?: string }) => s.name === 'Build and sign')
    expect(build.shell).toBe('bash')
    // รัน script จริงของขั้นนี้ แต่แทน tauri build ด้วย env เพื่อดูว่าส่งตัวแปรอะไรต่อ
    const script = (build.run as string).replace(/npx tauri build.*/, 'env')
    const env = { PATH: process.env.PATH ?? '', APPLE_CERTIFICATE: '', APPLE_CERTIFICATE_PASSWORD: '', APPLE_SIGNING_IDENTITY: '', APPLE_ID: 'dev@example.com', APPLE_PASSWORD: '', APPLE_TEAM_ID: '' }
    const out = execFileSync('bash', ['-c', script], { env, encoding: 'utf8' })
    const names = out.split('\n').map((l) => l.split('=')[0])
    expect(names).toContain('APPLE_ID')
    for (const name of ['APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_SIGNING_IDENTITY', 'APPLE_PASSWORD', 'APPLE_TEAM_ID']) expect(names).not.toContain(name)
  })

  it('puts only user downloads in the draft release (no image digests or .dockerbuild records)', () => {
    const downloads = doc.jobs.publish.steps.filter((s: { uses?: string }) => s.uses?.startsWith('actions/download-artifact'))
    // ไม่ดึงทุก artifact ของ run: .dockerbuild ดาวน์โหลดไม่ได้ (v0.2.0 ครั้งแรกล้มตรงนี้) และ digest ไม่ใช่ไฟล์ให้ผู้ใช้
    expect(downloads.length).toBeGreaterThan(0)
    for (const step of downloads) expect(step.with.pattern ?? step.with.name, 'download names an artifact or pattern').toBeTruthy()
    expect(downloads.map((s: { with: { pattern?: string; name?: string } }) => s.with.pattern ?? s.with.name).sort()).toEqual(['cli', 'desktop-*'])
    const build = doc.jobs.image.steps.find((s: { uses?: string }) => s.uses?.startsWith('docker/build-push-action'))
    expect(build.env.DOCKER_BUILD_RECORD_UPLOAD).toBe('false')
  })

  it('verifies contents and launches every desktop artifact', () => {
    const runs = doc.jobs.desktop.steps.map((s: { run?: string }) => s.run ?? '').join('\n')
    expect(runs).toContain('desktop-verify-artifacts.mjs')
    expect(runs).toContain('desktop-launch-smoke.mjs')
    expect(runs).toContain('desktop-collect.mjs') // fails when updater signatures are missing
  })

  it('reads signing secrets only as step environment and never prints them', () => {
    const lines = text.split('\n').filter((l) => l.includes('secrets.'))
    for (const line of lines) expect(line.trim()).toMatch(/^[A-Z_]+: \$\{\{ secrets\.[A-Z_]+ \}\}$/)
    expect(text).not.toMatch(/echo[^\n]*secrets\./)
    const build = doc.jobs.desktop.steps.find((s: { name?: string }) => s.name === 'Build and sign')
    expect(Object.keys(build.env)).toContain('TAURI_SIGNING_PRIVATE_KEY')
    // release config ได้แค่ public key + URL
    expect(fs.readFileSync(path.join(ROOT, 'scripts/desktop-release-config.mjs'), 'utf8')).not.toMatch(/process\.env\.\w*PRIVATE/)
    expect(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')).toContain('tauri.release.conf.json')
  })

  it('macOS arm64 ships the signed Local runtime without an Apple Developer ID, plus the install script', () => {
    const arm = doc.jobs.desktop.strategy.matrix.include.find((m: { platform: string }) => m.platform === 'darwin-aarch64')
    expect(arm.local).toBe(true)
    const steps = doc.jobs.desktop.steps
    const runs = steps.map((s: { run?: string }) => s.run ?? '').join('\n')
    expect(runs).toContain('npm run build:runtime -- --target darwin-arm64')
    expect(runs).toContain('runtime-stage-desktop.mjs')
    expect(runs).toContain('macos-import-certificate.mjs')
    expect(runs).toContain('--local-runtime')
    // ลายเซ็นของ release ไม่ต้องใช้ Apple ID หรือ notarization
    const identity = steps.find((s: { name?: string }) => s.name?.startsWith('Release signing identity'))
    expect(Object.keys(identity.env)).toEqual(['ALICE_MACOS_CERTIFICATE', 'ALICE_MACOS_CERTIFICATE_PASSWORD'])
    expect(doc.jobs.publish.steps.map((s: { run?: string }) => s.run ?? '').join('\n')).toContain('install-macos.sh')
    const config = fs.readFileSync(path.join(ROOT, 'scripts/desktop-release-config.mjs'), 'utf8')
    expect(config).toContain("signingIdentity: process.env.ALICE_MACOS_SIGNING_IDENTITY || '-'")
    expect(config).not.toContain('externalBin')
  })

  it('every macOS build is signed with the release identity, including x64 without the Local runtime', () => {
    const identity = doc.jobs.desktop.steps.find((s: { name?: string }) => s.name?.startsWith('Release signing identity'))
    expect(identity.if).toBe("runner.os == 'macOS'")
    // Intel linker ไม่ ad-hoc sign ให้เอง: config ที่ไม่มี runtime ก็ต้องมี signingIdentity
    const dir = testDir('alice-release-config-')
    const out = path.join(dir, 'release.json')
    const env = { PATH: process.env.PATH ?? '', ALICE_UPDATER_PUBKEY: 'pub', ALICE_UPDATE_URL: 'https://example.com/latest.json', ALICE_MACOS_SIGNING_IDENTITY: 'ABC123' }
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/desktop-release-config.mjs'), out], { cwd: dir, env })
    const written = JSON.parse(fs.readFileSync(out, 'utf8'))
    expect(written.bundle.resources).toBeUndefined()
    expect(written.bundle.macOS).toEqual({ signingIdentity: 'ABC123', hardenedRuntime: false })
  })

  it('preflight gates every build, and the draft carries only this version notes', () => {
    for (const job of ['desktop', 'cli', 'image']) expect(doc.jobs[job].needs, job).toBe('preflight')
    expect(doc.jobs.preflight.steps.map((s: { run?: string }) => s.run ?? '').join('\n')).toContain('release-preflight.mjs')
    const publish = doc.jobs.publish.steps.map((s: { run?: string }) => s.run ?? '').join('\n')
    expect(publish).toContain('release-notes.mjs')
    expect(publish).toContain('--draft')
    expect(publish).not.toContain('--notes-file CHANGELOG.md')
    expect(text).not.toContain('WINDOWS_CERTIFICATE')
    expect(load('ci.yml').text).toContain('release-preflight.mjs --dry-run')
  })

  it('CI runs Node suites and the Rust core tests', () => {
    const ci = load('ci.yml').doc
    expect(Object.keys(ci.jobs)).toEqual(['node', 'desktop-core'])
    expect(JSON.stringify(ci.jobs['desktop-core'].steps)).toContain('cargo test')
  })
})
