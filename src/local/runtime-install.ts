// Runtime ที่ติดตั้งแบบมีเวอร์ชัน
//   <root>/runtime/<version>/{node, alice.js, alice-server.js, better_sqlite3.node, manifest.json}
//   <root>/runtime/current  -> <version>   (symlink; เปลี่ยนแบบ atomic ด้วย rename)
//   <root>/runtime/previous -> <version>   (เก็บไว้ rollback)
// launcher ~/.local/bin/alice เป็น shell script เล็ก ๆ ที่ exec runtime/current เสมอ
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const RUNTIME_FORMAT = 'alice-runtime'

export interface RuntimeManifest {
  format: typeof RUNTIME_FORMAT
  version: string
  target: string
  /** Latest database schema this runtime migrates to (rollback decides on restore from it). */
  schemaVersion?: number
  node: { version: string; modules?: string; napi?: string }
  files: Array<{ path: string; bytes: number; sha256: string; executable?: boolean }>
}

export interface InstalledRuntime {
  version: string
  dir: string
  previous: string | null
  manifest: RuntimeManifest | null
  problems: string[]
}

export const runtimeRoot = (root: string) => path.join(root, 'runtime')

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export function readRuntimeManifest(dir: string): RuntimeManifest {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as RuntimeManifest
  if (manifest.format !== RUNTIME_FORMAT || !Array.isArray(manifest.files)) throw new Error('Not an Alice runtime manifest')
  return manifest
}

/** Every file listed in the manifest exists with its exact checksum, and no listed path escapes the directory. */
export function verifyRuntimeDir(dir: string, expectedVersion?: string): string[] {
  const problems: string[] = []
  let manifest: RuntimeManifest
  try {
    manifest = readRuntimeManifest(dir)
  } catch (err) {
    return [`manifest: ${(err as Error).message}`]
  }
  if (expectedVersion && manifest.version !== expectedVersion) problems.push(`version ${manifest.version} does not match ${expectedVersion}`)
  for (const f of manifest.files) {
    const file = path.resolve(dir, f.path)
    if (!file.startsWith(path.resolve(dir) + path.sep)) {
      problems.push(`${f.path}: outside the runtime`)
      continue
    }
    if (!fs.existsSync(file)) problems.push(`${f.path}: missing`)
    else if (sha256(file) !== f.sha256) problems.push(`${f.path}: checksum mismatch`)
  }
  return problems
}

function pointer(root: string, name: 'current' | 'previous'): string | null {
  try {
    return path.basename(fs.realpathSync(path.join(runtimeRoot(root), name)))
  } catch {
    return null
  }
}

export function installedRuntime(root: string): InstalledRuntime | null {
  const version = pointer(root, 'current')
  if (!version) return null
  const dir = path.join(runtimeRoot(root), version)
  let manifest: RuntimeManifest | null = null
  try {
    manifest = readRuntimeManifest(dir)
  } catch {
    /* reported below */
  }
  return { version, dir, previous: pointer(root, 'previous'), manifest, problems: verifyRuntimeDir(dir, version) }
}

/** Atomically points `runtime/<name>` at `version`: a new symlink is renamed over the old one. */
export function setPointer(root: string, name: 'current' | 'previous', version: string | null): void {
  const link = path.join(runtimeRoot(root), name)
  if (version === null) {
    fs.rmSync(link, { force: true })
    return
  }
  const tmp = `${link}.${process.pid}.${Date.now()}.tmp`
  fs.symlinkSync(version, tmp)
  fs.renameSync(tmp, link)
}

export function launcherPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.ALICE_LAUNCHER_PATH || path.join(env.HOME || os.homedir(), '.local', 'bin', 'alice')
}

/** The launcher resolves `runtime/current` on every run, so runtime updates never rewrite it. */
export function launcherScript(root: string): string {
  const current = path.join(runtimeRoot(root), 'current')
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  return [
    '#!/bin/sh',
    '# Alice CLI launcher (installed by Alice Desktop). It runs the active Local runtime.',
    `RUNTIME=${q(current)}`,
    'if [ ! -x "$RUNTIME/node" ] || [ ! -f "$RUNTIME/alice.js" ]; then',
    '  echo "alice: the Alice runtime is missing. Reinstall Alice Desktop, then run: alice doctor" >&2',
    '  exit 1',
    'fi',
    `export ALICE_HOME=${q(root)}`,
    'exec "$RUNTIME/node" "$RUNTIME/alice.js" "$@"',
    '',
  ].join('\n')
}

export function installLauncher(root: string, env: NodeJS.ProcessEnv = process.env): string {
  const file = launcherPath(env)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, launcherScript(root), { mode: 0o755 })
  fs.renameSync(tmp, file)
  return file
}
