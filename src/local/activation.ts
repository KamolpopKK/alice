// ติดตั้งและสลับ runtime แบบ atomic พร้อม rollback
// ลำดับ: รอให้งานที่กำลังทำเสร็จ (ไม่ฆ่างาน CLI) → หยุด daemon แบบ graceful → สลับ pointer
//        → เปิด workspace ด้วย runtime ใหม่ (pre-migration backup + migrate) → ตรวจ health
//        ล้มเหลว = ชี้ pointer กลับ, กู้ฐานข้อมูลจาก pre-migration backup เมื่อ schema ใหม่เกินกว่า runtime เดิมรับได้
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { capabilityAccount, localCredentialStore } from './capabilities'
import { ensureDaemon, probeDaemon } from './daemon-client'
import { listBackupDirs } from './backup-list'
import { liveLockHolder, readRegistry, type LocalWorkspace } from './registry'
import { readRuntimeManifest, runtimeRoot, setPointer, verifyRuntimeDir, type RuntimeManifest } from './runtime-install'

export type ActivationResult =
  | { status: 'activated'; from: string | null; to: string; reopened: string[] }
  | { status: 'unchanged'; to: string }
  | { status: 'deferred'; to: string; busy: string[] }
  | { status: 'rolled-back'; from: string | null; to: string; failed: string; message: string; restored: boolean }

const versionDir = (root: string, version: string) => path.join(runtimeRoot(root), version)
const nodeIn = (dir: string) => path.join(dir, process.platform === 'win32' ? 'node.exe' : 'node')
export const serverCommandIn = (dir: string) => [nodeIn(dir), path.join(dir, 'alice-server.js')]

function currentVersion(root: string): string | null {
  try {
    return path.basename(fs.realpathSync(path.join(runtimeRoot(root), 'current')))
  } catch {
    return null
  }
}

/**
 * Copies a bundled runtime into `runtime/<version>` (verified before it is visible) unless an intact
 * copy is already installed. `nodeBinary` supplies the Node executable when it ships separately
 * (the Tauri sidecar).
 */
export function installRuntime(root: string, sourceDir: string, nodeBinary?: string): RuntimeManifest {
  const manifest = readRuntimeManifest(sourceDir)
  const dest = versionDir(root, manifest.version)
  if (fs.existsSync(dest) && verifyRuntimeDir(dest, manifest.version).length === 0) return manifest
  fs.mkdirSync(runtimeRoot(root), { recursive: true, mode: 0o700 })
  const staging = `${dest}.partial-${process.pid}`
  fs.rmSync(staging, { recursive: true, force: true })
  fs.mkdirSync(staging, { mode: 0o755 })
  try {
    for (const f of manifest.files) {
      const isNode = f.path === 'node' || f.path === 'node.exe'
      const from = isNode && nodeBinary && !fs.existsSync(path.join(sourceDir, f.path)) ? nodeBinary : path.join(sourceDir, f.path)
      fs.copyFileSync(from, path.join(staging, f.path))
      fs.chmodSync(path.join(staging, f.path), f.executable ? 0o755 : 0o644)
    }
    fs.copyFileSync(path.join(sourceDir, 'manifest.json'), path.join(staging, 'manifest.json'))
    const problems = verifyRuntimeDir(staging, manifest.version)
    if (problems.length) throw new Error(`The bundled runtime failed verification: ${problems.join('; ')}`)
    if (fs.existsSync(dest)) fs.renameSync(dest, `${dest}.broken-${Date.now()}`)
    fs.renameSync(staging, dest)
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true })
    throw err
  }
  return manifest
}

async function daemonStatus(root: string, ws: LocalWorkspace, env: NodeJS.ProcessEnv) {
  const probe = await probeDaemon(root, ws.id, '*')
  if (!probe.ok && probe.reason !== 'version') return null
  const port = probe.locator!.port
  const token = localCredentialStore(root, env).get(capabilityAccount(ws.id, 'owner'))
  if (!token) return { port, token: null, busy: false }
  try {
    const res = await fetch(`http://127.0.0.1:${port}/local/v1/status`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000) })
    const s = (await res.json()) as { active: number; protectedOperations: number }
    // คำขอ status นี้เองนับเป็น 1
    return { port, token, busy: s.active > 1 || s.protectedOperations > 0 }
  } catch {
    return { port, token, busy: false }
  }
}

async function stopGracefully(root: string, ws: LocalWorkspace, port: number, token: string | null): Promise<void> {
  if (token) {
    await fetch(`http://127.0.0.1:${port}/local/v1/shutdown`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
  }
  const deadline = Date.now() + 30_000
  while (liveLockHolder(root, ws.id)) {
    if (Date.now() > deadline) throw new Error(`The workspace ${ws.alias} did not stop in time`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

function runServer(command: string[], root: string, env: NodeJS.ProcessEnv, args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync(command[0], [...command.slice(1), ...args], { env: { ...env, ALICE_HOME: root }, encoding: 'utf8', timeout: 10 * 60_000 })
  return { status: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

export interface ActivateOptions {
  env?: NodeJS.ProcessEnv
  /** Extra environment for the new runtime's daemons (tests inject a failing migration here). */
  newDaemonEnv?: NodeJS.ProcessEnv
}

/** Makes `version` the active runtime without killing work, verifying it opens the workspaces that were open. */
export async function activateRuntime(root: string, version: string, options: ActivateOptions = {}): Promise<ActivationResult> {
  const env = options.env ?? process.env
  const target = versionDir(root, version)
  const problems = verifyRuntimeDir(target, version)
  if (problems.length) throw new Error(`Runtime ${version} is not installed correctly: ${problems.join('; ')}`)
  const from = currentVersion(root)
  if (from === version) return { status: 'unchanged', to: version }

  const workspaces = readRegistry(root).workspaces
  const running: Array<{ ws: LocalWorkspace; port: number; token: string | null }> = []
  const busy: string[] = []
  for (const ws of workspaces) {
    const s = await daemonStatus(root, ws, env)
    if (!s) continue
    if (s.busy) busy.push(ws.alias)
    running.push({ ws, ...s })
  }
  // งานที่กำลังทำอยู่ (คำสั่ง CLI, backup, migration) ห้ามถูกตัด: เลื่อนการสลับออกไป
  if (busy.length) return { status: 'deferred', to: version, busy }

  for (const r of running) await stopGracefully(root, r.ws, r.port, r.token)
  if (from) setPointer(root, 'previous', from)
  setPointer(root, 'current', version)

  // ตรวจด้วยการเปิด workspace ที่เคยเปิดอยู่ (หรืออันล่าสุด) ด้วย runtime ใหม่
  const probeSet = running.length ? running.map((r) => r.ws) : workspaces.slice(0, 1)
  const reopened: string[] = []
  for (const ws of probeSet) {
    try {
      await ensureDaemon(root, ws, { env: { ...env, ...options.newDaemonEnv }, command: serverCommandIn(target), version: '*' })
      reopened.push(ws.alias)
    } catch (err) {
      return rollback(root, from, version, ws, (err as Error).message, running.map((r) => r.ws), env)
    }
  }
  // เก็บ current และ previous ไว้ ลบรุ่นอื่นที่ไม่ได้ใช้แล้ว
  for (const name of fs.readdirSync(runtimeRoot(root))) {
    if ([version, from, 'current', 'previous'].includes(name)) continue
    if (!fs.statSync(path.join(runtimeRoot(root), name)).isDirectory()) continue
    fs.rmSync(path.join(runtimeRoot(root), name), { recursive: true, force: true })
  }
  return { status: 'activated', from, to: version, reopened }
}

async function rollback(root: string, from: string | null, to: string, failed: LocalWorkspace, message: string, wasRunning: LocalWorkspace[], env: NodeJS.ProcessEnv): Promise<ActivationResult> {
  // daemon ของ runtime ใหม่ (ถ้ายังค้าง) ต้องหยุดก่อนชี้กลับ
  for (const ws of wasRunning.concat(failed)) {
    const s = await daemonStatus(root, ws, env)
    if (s) await stopGracefully(root, ws, s.port, s.token).catch(() => undefined)
  }
  if (from) setPointer(root, 'current', from)
  else setPointer(root, 'current', null)
  let restored = false
  if (from) {
    // migration เป็น transaction ต่อขั้น: ถ้าฐานข้อมูลเลยรุ่นที่ runtime เดิมรู้จัก จึงกู้จาก pre-migration backup
    const oldManifest = readRuntimeManifest(versionDir(root, from))
    const inspect = runServer(serverCommandIn(versionDir(root, to)), root, env, ['local-inspect', '--workspace', failed.id])
    const schema = inspect.status === 0 ? (JSON.parse(inspect.stdout.trim().split('\n').pop()!) as { schemaVersion: number | null }).schemaVersion : null
    if (schema !== null && oldManifest.schemaVersion && schema > oldManifest.schemaVersion) {
      const backup = listBackupDirs(root, failed.id).find((b) => b.kind === 'pre-migration')
      if (backup) {
        const res = runServer(serverCommandIn(versionDir(root, to)), root, env, ['local-restore', '--from', backup.dir, '--replace', failed.id])
        restored = res.status === 0
      }
    }
    for (const ws of wasRunning) {
      await ensureDaemon(root, ws, { env, command: serverCommandIn(versionDir(root, from)), version: '*' }).catch(() => undefined)
    }
  }
  return { status: 'rolled-back', from, to, failed: failed.alias, message, restored }
}
