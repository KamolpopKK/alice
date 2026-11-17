#!/usr/bin/env node
// เตรียม runtime ให้ Tauri bundle
//   ทุกไฟล์ของ runtime → dist/runtime-bundle/ (resources → Resources/runtime/)
//   macOS: ลงลายเซ็นโค้ดให้ node และ better_sqlite3.node ก่อน (Apple Silicon ไม่ยอมรันโค้ดที่ไม่มีลายเซ็น)
//          ด้วย identity ใน ALICE_MACOS_SIGNING_IDENTITY (self-signed ของ release) หรือ "-" (ad-hoc)
//          แล้วคำนวณ manifest ใหม่ เพื่อให้ checksum ตรงกับไฟล์ที่แจกจริง
//   node ไม่เป็น externalBin เพราะ Tauri จะลงลายเซ็นซ้ำตอน bundle และทำให้ checksum ไม่ตรง
//
//   node scripts/runtime-stage-desktop.mjs --runtime dist/runtime/darwin-arm64
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const runtime = path.resolve(opt('--runtime', `dist/runtime/${process.platform}-${process.arch}`))
const bundle = path.resolve(opt('--out', 'dist/runtime-bundle'))
const manifest = JSON.parse(fs.readFileSync(path.join(runtime, 'manifest.json'), 'utf8'))

fs.rmSync(bundle, { recursive: true, force: true })
fs.mkdirSync(bundle, { recursive: true })
for (const f of manifest.files) {
  fs.copyFileSync(path.join(runtime, f.path), path.join(bundle, f.path))
  fs.chmodSync(path.join(bundle, f.path), f.executable ? 0o755 : 0o644)
}

const signing = manifest.target.startsWith('darwin') && process.platform === 'darwin'
if (signing) {
  const identity = process.env.ALICE_MACOS_SIGNING_IDENTITY || '-'
  // ไม่ใช้ hardened runtime: ไม่มี notarization และ node ต้องโหลด native module ที่ลงลายเซ็นคนละ identity ได้
  for (const f of ['better_sqlite3.node', 'node']) execFileSync('codesign', ['--force', '--sign', identity, '--timestamp=none', path.join(bundle, f)], { stdio: 'inherit' })
  console.log(`signed runtime binaries with ${identity === '-' ? 'an ad-hoc signature' : 'the release identity'}`)
}

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const files = manifest.files.map((f) => ({ ...f, bytes: fs.statSync(path.join(bundle, f.path)).size, sha256: sha256(path.join(bundle, f.path)) }))
fs.writeFileSync(path.join(bundle, 'manifest.json'), JSON.stringify({ ...manifest, files, signed: signing }, null, 2) + '\n')
console.log(`staged runtime ${manifest.version} (${manifest.target}) → ${bundle}`)
