#!/usr/bin/env node
// รวบรวม installer + updater artifact (+ .sig) ของ platform หนึ่ง ตั้งชื่อให้มี platform กำกับ
// usage: desktop-collect.mjs <bundle dir> <platform e.g. darwin-aarch64> <out dir>
import fs from 'node:fs'
import path from 'node:path'

const [bundleDir, platform, outDir] = process.argv.slice(2)
if (!bundleDir || !platform || !outDir) {
  console.error('usage: desktop-collect.mjs <bundle dir> <platform> <out dir>')
  process.exit(2)
}
const arch = platform.split('-')[1]
const WANTED = /\.(dmg|app\.tar\.gz|exe|msi|AppImage|deb|rpm)(\.sig)?$/
fs.mkdirSync(outDir, { recursive: true })
const found = []
const walk = (dir) => {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) {
      if (!name.endsWith('.app')) walk(p)
    } else if (WANTED.test(name)) found.push(p)
  }
}
walk(bundleDir)
for (const file of found) {
  let name = path.basename(file)
  // macOS updater archive ไม่มี arch ในชื่อ → เติมให้ (latest.json จับคู่ platform จากชื่อ)
  if (/^[^_]+\.app\.tar\.gz(\.sig)?$/.test(name)) name = name.replace('.app.tar.gz', `_${arch === 'x86_64' ? 'x64' : arch}.app.tar.gz`)
  fs.copyFileSync(file, path.join(outDir, name))
  console.log(`  ${name}`)
}
if (!found.some((f) => f.endsWith('.sig'))) {
  console.error('no updater signatures found — was TAURI_SIGNING_PRIVATE_KEY set?')
  process.exit(1)
}
