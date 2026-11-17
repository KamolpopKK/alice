#!/usr/bin/env node
// ตรวจ bundle ของแต่ละ platform ด้วย verify-desktop-bundle.mjs (แตกไฟล์ installer ที่จำเป็นก่อน)
// usage: desktop-verify-artifacts.mjs <target release dir> <platform>
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [releaseDir, platform, ...flags] = process.argv.slice(2)
// --local-runtime VERSION (macOS arm64): แอปต้องพก Local runtime ที่ตรงเวอร์ชันพอดีและลงลายเซ็นครบทุก Mach-O
const local = flags.includes('--local-runtime') ? flags[flags.indexOf('--local-runtime') + 1] : null
const verify = (dir) =>
  execFileSync(process.execPath, [path.join(import.meta.dirname, 'verify-desktop-bundle.mjs'), dir, ...(local ? ['--local-runtime', '--version', local] : [])], { stdio: 'inherit' })

/** Every Mach-O is code-signed (ad-hoc or the release's self-signed identity), arm64, and the app seal is intact. */
function verifyMacSignatures(app) {
  const machO = []
  const walk = (p) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, e.name)
      if (e.isDirectory()) walk(f)
      else if (fs.readFileSync(f).subarray(0, 4).readUInt32BE(0) === 0xcffaedfe) machO.push(f)
    }
  }
  walk(app)
  if (local && machO.length < 3) throw new Error(`expected the app, runtime node and better_sqlite3.node as Mach-O files, found ${machO.length}`)
  for (const f of machO) {
    execFileSync('codesign', ['--verify', '--strict', f], { stdio: 'inherit' })
    const archs = execFileSync('lipo', ['-archs', f], { encoding: 'utf8' }).trim()
    if (platform === 'darwin-aarch64' && !archs.split(' ').includes('arm64')) throw new Error(`${path.relative(app, f)} is not arm64 (${archs})`)
    console.log(`  ✓ signed ${archs}: ${path.relative(app, f)}`)
  }
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
  console.log('  ✓ app signature and sealed resources verify (not notarized: first launch needs one approval)')
}
const find = (dir, re) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => re.test(f)).map((f) => path.join(dir, f)) : [])
const bundle = path.join(releaseDir, 'bundle')

if (platform.startsWith('darwin')) {
  for (const app of find(path.join(bundle, 'macos'), /\.app$/)) {
    verify(app)
    verifyMacSignatures(app)
  }
} else if (platform.startsWith('linux')) {
  for (const deb of find(path.join(bundle, 'deb'), /\.deb$/)) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-deb-'))
    execFileSync('dpkg-deb', ['-x', deb, dir])
    verify(path.join(dir, 'usr', 'bin'))
  }
  for (const image of find(path.join(bundle, 'appimage'), /\.AppImage$/)) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-appimage-'))
    fs.chmodSync(image, 0o755)
    execFileSync(path.resolve(image), ['--appimage-extract'], { cwd: dir, stdio: 'ignore' })
    // AppImage รวม WebKit/GTK ไว้ด้วย: ตรวจเฉพาะ executable ของแอปและ resource ของแอป
    verify(path.join(dir, 'squashfs-root', 'usr', 'bin'))
  }
} else if (platform.startsWith('windows')) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-win-'))
  fs.copyFileSync(path.join(releaseDir, 'alice-desktop.exe'), path.join(dir, 'alice-desktop.exe'))
  verify(dir)
} else {
  console.error(`unknown platform ${platform}`)
  process.exit(2)
}
