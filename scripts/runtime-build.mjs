// Local runtime: Node ทางการที่ pin เวอร์ชันไว้ + bundle ของ server และ CLI
// + better_sqlite3.node ของ target นั้น + manifest.json ที่มี SHA-256 ของทุกไฟล์
//
//   node scripts/runtime-build.mjs [--target darwin-arm64] [--node PATH] [--out dist/runtime/<target>]
//
// --node ใช้ไบนารี Node ที่มีอยู่แล้ว (dev/test); ไม่ระบุ = ดาวน์โหลดเวอร์ชันที่ pin จาก nodejs.org
// และตรวจกับ SHASUMS256.txt ก่อนใช้
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { cliBuildOptions } from './cli-build.mjs'

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

export function readPins(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  return { version: pkg.version, node: pkg.alice?.runtimeNode }
}

/** Downloads the pinned official Node.js binary for a target and verifies it against SHASUMS256.txt. */
export async function fetchNode(version, target, cacheDir) {
  const [platform, arch] = target.split('-')
  const name = `node-v${version}-${platform}-${arch}`
  const dir = path.join(cacheDir, name)
  const binary = path.join(dir, 'bin', 'node')
  if (fs.existsSync(binary)) return binary
  fs.mkdirSync(cacheDir, { recursive: true })
  const base = `https://nodejs.org/dist/v${version}`
  const archive = `${name}.tar.gz`
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text()
  const expected = sums.split('\n').find((l) => l.endsWith(`  ${archive}`))?.split(/\s+/)[0]
  if (!expected) throw new Error(`No checksum for ${archive} in SHASUMS256.txt`)
  const bytes = Buffer.from(await (await fetch(`${base}/${archive}`)).arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`${archive} does not match SHASUMS256.txt`)
  const file = path.join(cacheDir, archive)
  fs.writeFileSync(file, bytes)
  const res = spawnSync('tar', ['-xzf', file, '-C', cacheDir], { stdio: 'inherit' })
  if (res.status !== 0) throw new Error(`Could not extract ${archive}`)
  return binary
}

/**
 * Builds one runtime directory. The result runs with only its own files: no repository, no
 * node_modules, no system Node.js.
 */
export async function buildRuntime({ root = process.cwd(), outdir, target = `${process.platform}-${process.arch}`, nodeBinary, version } = {}) {
  const pins = readPins(root)
  version ??= pins.version
  outdir ??= path.join(root, 'dist', 'runtime', target)
  fs.rmSync(outdir, { recursive: true, force: true })
  fs.mkdirSync(outdir, { recursive: true })

  // server: ทุก dependency อยู่ในไฟล์เดียว; require() ของ CommonJS ใช้ createRequire ของ ESM
  await build({
    entryPoints: { 'alice-server': path.join(root, 'src/server/cli.ts') },
    outdir,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'bundle',
    banner: { js: "#!/usr/bin/env node\nimport { createRequire as __aliceCreateRequire } from 'node:module';\nconst require = __aliceCreateRequire(import.meta.url);" },
    logLevel: 'warning',
  })
  await build({ ...cliBuildOptions(outdir, root), logLevel: 'warning' })

  const prebuild = path.join(root, 'node_modules', 'better-sqlite3', 'prebuilds', `${target}.node`)
  if (!fs.existsSync(prebuild)) throw new Error(`No better-sqlite3 prebuild for ${target}`)
  fs.copyFileSync(prebuild, path.join(outdir, 'better_sqlite3.node'))

  const node = nodeBinary ?? (pins.node ? await fetchNode(pins.node, target, path.join(os.homedir(), '.cache', 'alice-runtime-node')) : process.execPath)
  const nodeName = target.startsWith('win32') ? 'node.exe' : 'node'
  fs.copyFileSync(node, path.join(outdir, nodeName))
  fs.chmodSync(path.join(outdir, nodeName), 0o755)
  for (const f of ['alice.js', 'alice-server.js']) fs.chmodSync(path.join(outdir, f), 0o755)

  // ABI ของ native module ต้องโหลดได้กับ Node ที่แจกจริง (ตรวจเฉพาะเมื่อ target ตรงกับเครื่องที่ build)
  const runnable = target === `${process.platform}-${process.arch}`
  let nodeInfo = { version: 'unknown', modules: 'unknown', napi: 'unknown' }
  if (runnable) {
    const info = spawnSync(path.join(outdir, nodeName), ['-p', 'JSON.stringify({version: process.version, modules: process.versions.modules, napi: process.versions.napi})'], { encoding: 'utf8' })
    if (info.status !== 0) throw new Error('The runtime Node binary does not run on this machine')
    nodeInfo = JSON.parse(info.stdout)
    const load = spawnSync(path.join(outdir, nodeName), ['-e', `process.dlopen({ exports: {} }, ${JSON.stringify(path.join(outdir, 'better_sqlite3.node'))})`], { encoding: 'utf8' })
    if (load.status !== 0) throw new Error(`better_sqlite3.node does not load with Node ${nodeInfo.version}: ${load.stderr.trim().split('\n')[0]}`)
  }

  const migrations = fs.readFileSync(path.join(root, 'src/server/db/migrations.ts'), 'utf8')
  const schemaVersion = Math.max(...[...migrations.matchAll(/\n\s+version:\s*(\d+),\n\s+name:/g)].map((m) => Number(m[1])))
  const files = [nodeName, 'alice.js', 'alice-server.js', 'better_sqlite3.node'].map((f) => {
    const file = path.join(outdir, f)
    return { path: f, bytes: fs.statSync(file).size, sha256: sha256(file), executable: f !== 'better_sqlite3.node' }
  })
  const manifest = { format: 'alice-runtime', version, target, schemaVersion, node: nodeInfo, files }
  fs.writeFileSync(path.join(outdir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  return { outdir, manifest }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  const opt = (name) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const { outdir, manifest } = await buildRuntime({ target: opt('--target'), nodeBinary: opt('--node'), outdir: opt('--out') })
  console.log(`Alice runtime ${manifest.version} for ${manifest.target} (Node ${manifest.node.version}) → ${outdir}`)
}
