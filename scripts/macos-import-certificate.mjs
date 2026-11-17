#!/usr/bin/env node
// นำเข้าใบรับรอง self-signed ของ release (ไม่ใช่ Apple Developer ID) เข้า keychain ชั่วคราวของ CI
// ไม่มี secret = ใช้ ad-hoc signature ("-"); ไม่พิมพ์ค่าใบรับรองหรือรหัสผ่านออก log ใด ๆ
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const cert = process.env.ALICE_MACOS_CERTIFICATE
const password = process.env.ALICE_MACOS_CERTIFICATE_PASSWORD ?? ''
const githubEnv = process.env.GITHUB_ENV
const setIdentity = (value) => {
  if (githubEnv) fs.appendFileSync(githubEnv, `ALICE_MACOS_SIGNING_IDENTITY=${value}\n`)
}

if (!cert) {
  console.log('No release certificate configured: the app is signed ad-hoc.')
  setIdentity('-')
  process.exit(0)
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-signing-'))
const p12 = path.join(dir, 'release.p12')
fs.writeFileSync(p12, Buffer.from(cert, 'base64'), { mode: 0o600 })
const keychain = path.join(dir, 'release.keychain-db')
const keychainPassword = crypto.randomBytes(24).toString('hex')
const run = (args) => execFileSync('security', args, { stdio: ['ignore', 'pipe', 'inherit'] })
run(['create-keychain', '-p', keychainPassword, keychain])
run(['set-keychain-settings', '-lut', '21600', keychain])
run(['unlock-keychain', '-p', keychainPassword, keychain])
run(['import', p12, '-k', keychain, '-P', password, '-T', '/usr/bin/codesign'])
run(['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', keychainPassword, keychain])
const existing = execFileSync('security', ['list-keychains', '-d', 'user'], { encoding: 'utf8' }).split('\n').map((l) => l.trim().replace(/"/g, '')).filter(Boolean)
run(['list-keychains', '-d', 'user', '-s', keychain, ...existing])
fs.rmSync(p12)
// self-signed ไม่มี CA รับรอง: `find-identity -v` จึงไม่แสดงมัน (CSSMERR_TP_NOT_TRUSTED)
// ให้เชื่อถือใบรับรองนี้สำหรับ code signing เฉพาะบนเครื่อง build (runner มี sudo แบบไม่ถามรหัส)
// แล้วเลือก identity ด้วย SHA-1 hash ซึ่ง codesign รับได้เสมอ และเป็นค่าเดียวกันทุก release
const identity = () => /^\s*\d+\)\s+([0-9A-F]{40})\s+"([^"]+)"(.*)$/m.exec(execFileSync('security', ['find-identity', '-p', 'codesigning', keychain], { encoding: 'utf8' }))
let found = identity()
if (!found) {
  console.error('The release certificate has no code-signing identity (it needs extendedKeyUsage=codeSigning)')
  process.exit(1)
}
if (found[3].includes('CSSMERR_TP_NOT_TRUSTED')) {
  const certFile = path.join(dir, 'release.cert.pem')
  fs.writeFileSync(certFile, execFileSync('security', ['find-certificate', '-a', '-p', keychain]))
  try {
    execFileSync('sudo', ['-n', 'security', 'add-trusted-cert', '-d', '-r', 'trustRoot', '-p', 'codeSign', '-k', keychain, certFile], { stdio: ['ignore', 'ignore', 'inherit'] })
  } catch {
    console.log('Could not mark the self-signed certificate as trusted on this machine; signing by hash anyway.')
  }
  found = identity()
}
setIdentity(found[1])
console.log(`Imported the release signing identity "${found[2]}" (self-signed, not notarized).`)
