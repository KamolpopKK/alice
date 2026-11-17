#!/usr/bin/env node
// เปิดแอปที่ build แล้วจริง: production UI ต้องโหลดและเรียก Rust ได้ และ deep link ที่ผิดต้องถูกปฏิเสธ
// usage: desktop-launch-smoke.mjs <target release dir> <platform>
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [releaseDir, platform] = process.argv.slice(2)
let cmd
if (platform.startsWith('darwin')) {
  const app = fs.readdirSync(path.join(releaseDir, 'bundle', 'macos')).find((f) => f.endsWith('.app'))
  cmd = [path.join(releaseDir, 'bundle', 'macos', app, 'Contents', 'MacOS', 'alice-desktop')]
} else if (platform.startsWith('linux')) {
  cmd = ['xvfb-run', '-a', path.join(releaseDir, 'alice-desktop')]
} else {
  cmd = [path.join(releaseDir, 'alice-desktop.exe')]
}

function run(extraEnv, expect) {
  // ใช้ HOME/APPDATA ชั่วคราว เพื่อไม่แตะ profile จริงของเครื่อง build
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-smoke-home-'))
  const env = { ...process.env, HOME: home, APPDATA: home, XDG_CONFIG_HOME: home, ALICE_DESKTOP_SMOKE: 'exit', ...extraEnv }
  const res = spawnSync(cmd[0], cmd.slice(1), { env, encoding: 'utf8', timeout: 90_000 })
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`
  for (const line of expect) {
    if (!out.includes(line)) {
      console.error(`expected "${line}" from ${cmd.join(' ')}; got:\n${out}`)
      process.exit(1)
    }
  }
  console.log(`  ✓ ${expect.join(', ')}`)
}

run({}, ['alice-desktop: ui-ready'])
run({ ALICE_DESKTOP_OPEN_URL: 'alice://open/task/tsk_abcd1234?profile=work&server=https://evil.example' }, ['alice-desktop: deeplink rejected', 'alice-desktop: ui-ready'])
run({ ALICE_DESKTOP_OPEN_URL: 'alice://open/task/tsk_abcd1234?profile=nobody' }, ['alice-desktop: deeplink unknown_profile'])
