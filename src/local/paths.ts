// ตำแหน่งไฟล์ของ Local workspaces — ใช้ร่วมกันโดย daemon, CLI และ Desktop runtime
// โมดูลใน src/local ห้าม import โค้ด server หรือ SQLite เพราะ CLI bundle ใช้ด้วย
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * The per-OS-account application-data root. `ALICE_HOME` overrides it (tests, portable setups).
 * macOS: ~/Library/Application Support/Alice · Windows: %APPDATA%\Alice · Linux: $XDG_DATA_HOME/alice
 */
export function appDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ALICE_HOME) return path.resolve(env.ALICE_HOME)
  const home = env.HOME || os.homedir()
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Alice')
  if (process.platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Alice')
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'alice')
}

export interface WorkspacePaths {
  dir: string
  /** The data directory handed to the daemon (holds alice.db and its WAL files). */
  dataDir: string
  db: string
  locator: string
  lock: string
  backups: string
  logs: string
}

export function workspacePaths(root: string, id: string): WorkspacePaths {
  const dir = path.join(root, 'workspaces', id)
  const dataDir = path.join(dir, 'data')
  return {
    dir,
    dataDir,
    db: path.join(dataDir, 'alice.db'),
    locator: path.join(dir, 'daemon.json'),
    lock: path.join(dir, 'daemon.lock'),
    backups: path.join(dir, 'backups'),
    logs: path.join(dir, 'logs'),
  }
}

/** Creates a directory readable only by the current OS account and tightens an existing one. */
export function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') fs.chmodSync(dir, 0o700)
}

/** Atomic owner-only file write: temp file, fsync, rename. A crash leaves the old or the new file, never half. */
export function writeFileAtomic(file: string, content: string): void {
  ensurePrivateDir(path.dirname(file))
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  const fd = fs.openSync(tmp, 'w', 0o600)
  try {
    fs.writeFileSync(fd, content)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, file)
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}
