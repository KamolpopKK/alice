#!/usr/bin/env node
// สร้าง config สำหรับ release build ของ Alice Desktop จาก env (public key + URL ของ manifest)
// private key ไม่ผ่าน script นี้ — Tauri อ่านจาก TAURI_SIGNING_PRIVATE_KEY ตอน build เอง
import fs from 'node:fs'

const pubkey = process.env.ALICE_UPDATER_PUBKEY
const endpoint = process.env.ALICE_UPDATE_URL
const out = process.argv[2] ?? 'src-tauri/tauri.release.conf.json'
const missing = [!pubkey && 'ALICE_UPDATER_PUBKEY', !endpoint && 'ALICE_UPDATE_URL'].filter(Boolean)
if (missing.length) {
  console.error(`missing ${missing.join(', ')}`)
  process.exit(2)
}
if (!/^https:\/\//.test(endpoint) && !/^http:\/\/127\.0\.0\.1[:/]/.test(endpoint)) {
  console.error('ALICE_UPDATE_URL must use https:// (http://127.0.0.1 is allowed for local tests)')
  process.exit(2)
}
// เมื่อเตรียม runtime ไว้แล้ว (runtime-stage-desktop.mjs) ให้แอปพก Local runtime ไปด้วย
const localRuntime = fs.existsSync('dist/runtime-bundle/manifest.json')
const config = {
  bundle: {
    createUpdaterArtifacts: true,
    ...(localRuntime ? { resources: { '../dist/runtime-bundle/': 'runtime/' } } : {}),
    // ไม่มี Apple Developer ID: ทุก macOS build ใช้ self-signed identity ของ release หรือ ad-hoc ("-"), ไม่ notarize
    // ต้องตั้งเสมอ: บน Intel linker ไม่ ad-hoc sign ให้เอง ถ้าไม่ระบุ identity แอป x64 จะออกมาไม่มีลายเซ็นเลย
    macOS: { signingIdentity: process.env.ALICE_MACOS_SIGNING_IDENTITY || '-', hardenedRuntime: false },
  },
  plugins: {
    updater: {
      pubkey,
      endpoints: [endpoint],
      windows: { installMode: 'passive' },
      // อนุญาต http เฉพาะ loopback สำหรับทดสอบในเครื่องเท่านั้น
      ...(endpoint.startsWith('http://127.0.0.1') ? { dangerousInsecureTransportProtocol: true } : {}),
    },
  },
}
fs.writeFileSync(out, JSON.stringify(config, null, 2) + '\n')
console.log(`wrote ${out}`)
