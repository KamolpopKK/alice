// ฝั่ง client (CLI และ Desktop runtime): หา daemon ที่ใช้งานได้ หรือสตาร์ทใหม่แบบ detached แล้วรอจน health ผ่าน
// ห้ามฆ่า process ที่ไม่ใช่ของเรา: locator ค้างจะถูกลบเฉพาะเมื่อ process ตายแล้วและไม่มีใคร lock อยู่
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { AliceError } from '../shared/errors'
import { APP_VERSION } from '../shared/version'
import { isProcessAlive, workspacePaths } from './paths'
import { locatorProcessAlive, readLocator, type LocalHealth, type Locator } from './locator'
import type { LocalWorkspace } from './registry'

export interface DaemonEndpoint {
  baseUrl: string
  locator: Locator
  /** True when this call started the daemon. */
  started: boolean
}

export interface EnsureOptions {
  env?: NodeJS.ProcessEnv
  /** Command that runs `alice-server`; defaults to the runtime next to this CLI. */
  command?: string[]
  timeoutMs?: number
  /** Progress messages (stderr in the CLI; never stdout). */
  progress?: (message: string) => void
  /** Expected runtime version; defaults to this build's version. */
  version?: string
}

/** The `alice-server` command of this installation: `ALICE_RUNTIME_SERVER`, else `alice-server.js` beside this script. */
export function defaultServerCommand(env: NodeJS.ProcessEnv = process.env): string[] {
  const script = env.ALICE_RUNTIME_SERVER || path.join(path.dirname(process.argv[1] ?? '.'), 'alice-server.js')
  return [process.execPath, script]
}

async function fetchHealth(port: number, timeoutMs = 1_500): Promise<LocalHealth | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/local/health`, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok ? ((await res.json()) as LocalHealth) : null
  } catch {
    return null
  }
}

export type ProbeResult = { ok: true; locator: Locator } | { ok: false; reason: 'missing' | 'dead' | 'unhealthy' | 'mismatch' | 'version'; locator: Locator | null; detail?: string }

/** Validates a locator against the live process and its health identity. Never trusts the file alone. */
export async function probeDaemon(root: string, workspaceId: string, version = APP_VERSION): Promise<ProbeResult> {
  const locator = readLocator(workspacePaths(root, workspaceId).locator)
  if (!locator) return { ok: false, reason: 'missing', locator: null }
  if (locator.workspaceId !== workspaceId) return { ok: false, reason: 'mismatch', locator }
  if (!locatorProcessAlive(locator)) return { ok: false, reason: 'dead', locator }
  const health = await fetchHealth(locator.port)
  if (!health || health.status !== 'ok') return { ok: false, reason: 'unhealthy', locator }
  if (health.workspaceId !== workspaceId || health.generation !== locator.generation) return { ok: false, reason: 'mismatch', locator }
  // '*' = ยอมรับทุกเวอร์ชัน (ใช้ตอนสลับ runtime ที่ตรวจเวอร์ชันจาก manifest แทน)
  if (version !== '*' && health.version !== version) return { ok: false, reason: 'version', locator, detail: health.version }
  return { ok: true, locator }
}

/** Removes a locator whose process is gone and whose lock nobody alive holds. */
export function cleanStaleState(root: string, workspaceId: string): void {
  const paths = workspacePaths(root, workspaceId)
  const locator = readLocator(paths.locator)
  let holder = NaN
  try {
    holder = Number(fs.readFileSync(paths.lock, 'utf8').trim())
  } catch {
    /* no lock */
  }
  const lockLive = Number.isInteger(holder) && holder > 0 && isProcessAlive(holder)
  if (lockLive) return
  if (Number.isInteger(holder) && holder > 0) fs.rmSync(paths.lock, { force: true })
  if (locator && !locatorProcessAlive(locator)) fs.rmSync(paths.locator, { force: true })
}

function versionError(found: string | undefined, expected: string): AliceError {
  return new AliceError(
    'CLIENT_INCOMPATIBLE',
    `The running Local workspace uses Alice ${found ?? 'unknown'} but this client is ${expected}. Update or repair the Alice installation (alice doctor).`,
    { found, expected },
  )
}

/** Returns a validated daemon for the workspace, starting one when none is running. */
export async function ensureDaemon(root: string, workspace: LocalWorkspace, options: EnsureOptions = {}): Promise<DaemonEndpoint> {
  const env = options.env ?? process.env
  const version = options.version ?? APP_VERSION
  const first = await probeDaemon(root, workspace.id, version)
  if (first.ok) return { baseUrl: `http://127.0.0.1:${first.locator.port}`, locator: first.locator, started: false }
  if (first.reason === 'version') throw versionError(first.detail, version)
  if (workspace.state !== 'active') throw new AliceError('INVALID_STATE', `The workspace "${workspace.alias}" is ${workspace.state} and cannot be opened`)
  cleanStaleState(root, workspace.id)

  const [cmd, ...args] = options.command ?? defaultServerCommand(env)
  options.progress?.(`Starting Local workspace "${workspace.alias}"…`)
  const child = spawn(cmd, [...args, 'local-daemon', '--workspace', workspace.id], {
    env: { ...env, ALICE_HOME: root },
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  let exitCode: number | null = null
  child.on('exit', (code) => (exitCode = code))
  child.on('error', () => (exitCode = -1))
  child.unref()

  const deadline = Date.now() + (options.timeoutMs ?? 20_000)
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 75))
    const probe = await probeDaemon(root, workspace.id, version)
    if (probe.ok) return { baseUrl: `http://127.0.0.1:${probe.locator.port}`, locator: probe.locator, started: exitCode === null }
    if (probe.reason === 'version') throw versionError(probe.detail, version)
    // 75 = มี daemon ตัวอื่นชนะ lock ไปแล้ว: รอ locator ของตัวนั้นต่อ
    if (exitCode !== null && exitCode !== 75) {
      throw new AliceError('INTERNAL_ERROR', `The Local workspace "${workspace.alias}" could not start (exit ${exitCode}). Run "alice doctor" for details.`)
    }
  }
  throw new AliceError('INTERNAL_ERROR', `The Local workspace "${workspace.alias}" did not become ready in time. Run "alice doctor" for details.`)
}
