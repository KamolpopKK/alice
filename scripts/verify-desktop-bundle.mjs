#!/usr/bin/env node
// ตรวจ bundle ของ Alice Desktop
//   ค่าเริ่มต้น (Remote-only): ต้องไม่มี Node runtime, SQLite, better-sqlite3, ฐานข้อมูล หรือ sidecar
//   --local-runtime [--version V]: ต้องมี runtime ครบชุดพอดี — sidecar alice-node และ
//   Resources/runtime/{manifest.json, alice.js, alice-server.js, better_sqlite3.node} ที่ checksum ตรง
//   manifest และเวอร์ชันตรงกับแอป; ไฟล์อื่นที่เป็น Node/SQLite/ฐานข้อมูล ยังห้ามเหมือนเดิม
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const target = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--version')
const localRuntime = args.includes('--local-runtime')
const expectedVersion = args.includes('--version') ? args[args.indexOf('--version') + 1] : null
if (!target || !fs.existsSync(target)) {
  console.error('usage: verify-desktop-bundle.mjs <Alice.app | AppImage dir | install dir> [--local-runtime [--version V]]')
  process.exit(2)
}

const problems = []
const files = []
const walk = (p) => {
  const st = fs.lstatSync(p)
  if (st.isDirectory()) for (const f of fs.readdirSync(p)) walk(path.join(p, f))
  else files.push({ path: p, size: st.size })
}
walk(target)
const rel = (f) => path.relative(target, f).split(path.sep).join('/')

const RUNTIME_FILES = ['manifest.json', 'alice.js', 'alice-server.js', 'better_sqlite3.node']
const isRuntimeFile = (r) => localRuntime && (/(^|\/)runtime\/(manifest\.json|alice\.js|alice-server\.js|better_sqlite3\.node|node(\.exe)?)$/.test(r) || /(^|\/)alice-node(\.exe)?$/.test(r))
const isRuntimeNode = (r) => /(^|\/)alice-node(\.exe)?$/.test(r) || /(^|\/)runtime\/node(\.exe)?$/.test(r)

const FORBIDDEN_NAMES = [/(^|\/)node(\.exe)?$/i, /\.node$/i, /\.(db|sqlite|sqlite3)(-wal|-shm)?$/i, /better[-_]sqlite3/i, /(^|\/)alice-server(\.js)?$/, /(^|\/)cli\.js$/, /node_modules/]
const FORBIDDEN_CONTENT = ['better-sqlite3', 'better_sqlite3', 'CREATE TABLE activity_events', 'ALICE_BOOTSTRAP_TOKEN']

for (const f of files) {
  const r = rel(f.path)
  if (isRuntimeFile(r)) continue
  if (localRuntime && /(^|\/)alice-node/.test(r)) continue
  for (const re of FORBIDDEN_NAMES) if (re.test(r)) problems.push(`forbidden file: ${r}`)
  // CodeResources ของ macOS คือรายชื่อ+hash ของทุกไฟล์ที่ลงลายเซ็น จึงมีชื่อไฟล์ runtime อยู่แล้วเมื่อพก runtime
  // ไฟล์จริงถูกตรวจทั้งชื่อและ checksum ด้านล่าง จึงไม่ต้องสแกนเนื้อหาของมัน
  const isSignatureIndex = localRuntime && /(^|\/)_CodeSignature\/CodeResources$/.test(r)
  if (!isSignatureIndex && f.size < 200 * 1024 * 1024) {
    const buf = fs.readFileSync(f.path)
    for (const needle of FORBIDDEN_CONTENT) if (buf.includes(needle)) problems.push(`forbidden content "${needle}" in ${r}`)
  }
}

const executables = files.filter((f) => {
  try {
    return (fs.statSync(f.path).mode & 0o111) !== 0 && !/\.(dylib|so(\.\d+)*|dll)$/.test(f.path) && !isRuntimeFile(rel(f.path)) || /(^|\/)alice-node(\.exe)?$/.test(rel(f.path))
  } catch {
    return false
  }
})
const sidecars = localRuntime ? files.filter((f) => isRuntimeNode(rel(f.path))) : executables.filter((f) => /(^|\/)alice-node(\.exe)?$/.test(rel(f.path)))
const others = executables.filter((f) => !sidecars.some((s) => s.path === f.path))
if (others.length > 1) problems.push(`expected one app executable, found: ${others.map((f) => rel(f.path)).join(', ')}`)

if (localRuntime) {
  const runtimeDir = files.map((f) => rel(f.path)).find((r) => /(^|\/)runtime\/manifest\.json$/.test(r))
  if (sidecars.length !== 1) problems.push(`expected exactly one runtime Node binary (runtime/node or the alice-node sidecar), found ${sidecars.length}`)
  if (!runtimeDir) problems.push('missing runtime/manifest.json')
  else {
    const dir = path.join(target, path.dirname(runtimeDir))
    let manifest = null
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
    } catch {
      problems.push('runtime/manifest.json is not valid JSON')
    }
    if (manifest) {
      if (manifest.format !== 'alice-runtime') problems.push('runtime/manifest.json is not an Alice runtime manifest')
      if (expectedVersion && manifest.version !== expectedVersion) problems.push(`runtime version ${manifest.version} does not match the app ${expectedVersion}`)
      for (const name of RUNTIME_FILES.slice(1)) if (!fs.existsSync(path.join(dir, name))) problems.push(`missing runtime/${name}`)
      for (const f of manifest.files ?? []) {
        const isNode = f.path === 'node' || f.path === 'node.exe'
        const file = isNode ? sidecars[0]?.path : path.join(dir, f.path)
        if (!file || !fs.existsSync(file)) {
          problems.push(`missing runtime file ${f.path}`)
          continue
        }
        if (createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== f.sha256) problems.push(`runtime file ${f.path} does not match its manifest (foreign or modified)`)
      }
      const listed = new Set((manifest.files ?? []).map((f) => f.path))
      for (const name of fs.readdirSync(dir)) if (name !== 'manifest.json' && !listed.has(name)) problems.push(`unexpected runtime file: ${name}`)
    }
  }
}

console.log(`checked ${files.length} files in ${target}`)
for (const f of executables) console.log(`  executable: ${rel(f.path)} (${(f.size / 1024 / 1024).toFixed(1)} MiB)`)
if (problems.length) {
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}
console.log(localRuntime ? '  ✓ exactly the verified Local runtime; no other Node, SQLite, server code or database files' : '  ✓ no Node runtime, SQLite, server code, database files or sidecars')
