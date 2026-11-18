#!/usr/bin/env node
// รวม artifact ที่ลงนามแล้วเป็น latest.json สำหรับ updater
// usage: desktop-latest-json.mjs <version> <base download URL> <dir with updater artifacts and .sig files>
import fs from 'node:fs'
import path from 'node:path'

const [version, baseUrl, dir] = process.argv.slice(2)
if (!version || !baseUrl || !dir) {
  console.error('usage: desktop-latest-json.mjs <version> <base URL> <artifact dir>')
  process.exit(2)
}
// Client API ที่ build นี้ใช้ — client ตรวจกับ server ก่อนติดตั้ง
const clientApi = Number(/CLIENT_API_VERSION = (\d+)/.exec(fs.readFileSync('src/shared/version.ts', 'utf8'))[1])
const PLATFORM = [
  [/aarch64\.app\.tar\.gz$|_aarch64\.app\.tar\.gz$/, 'darwin-aarch64'],
  [/x64\.app\.tar\.gz$|_x64\.app\.tar\.gz$|x86_64\.app\.tar\.gz$/, 'darwin-x86_64'],
  [/universal\.app\.tar\.gz$/, 'darwin-universal'],
  // Windows อัปเดตผ่านตัวติดตั้ง NSIS (.exe) เท่านั้น: .msi เป็นทางเลือกสำหรับติดตั้งใหม่ ไม่ใช่ไฟล์อัปเดต
  [/x64-setup\.exe$/, 'windows-x86_64'],
  [/arm64-setup\.exe$/, 'windows-aarch64'],
  [/amd64\.AppImage$|x86_64\.AppImage$/, 'linux-x86_64'],
  [/aarch64\.AppImage$/, 'linux-aarch64'],
]
const platforms = {}
for (const file of fs.readdirSync(dir)) {
  if (file.endsWith('.sig')) continue
  const sigFile = path.join(dir, `${file}.sig`)
  if (!fs.existsSync(sigFile)) continue
  const match = PLATFORM.find(([re]) => re.test(file))
  if (!match) continue
  platforms[match[1]] = { signature: fs.readFileSync(sigFile, 'utf8').trim(), url: `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(file)}` }
}
if (Object.keys(platforms).length === 0) {
  console.error(`no signed updater artifacts in ${dir}`)
  process.exit(1)
}
const manifest = { version, notes: `Alice Desktop ${version}`, pub_date: new Date().toISOString(), aliceClientApi: clientApi, platforms }
process.stdout.write(JSON.stringify(manifest, null, 2) + '\n')
