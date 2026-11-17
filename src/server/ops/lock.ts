import fs from 'node:fs'
import path from 'node:path'

const LOCK_FILE = 'alice.pid'

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** PID of a live Alice server using this data directory, or null. */
export function runningServerPid(dataDir: string): number | null {
  try {
    const pid = Number(fs.readFileSync(path.join(dataDir, LOCK_FILE), 'utf8').trim())
    return Number.isInteger(pid) && pid > 0 && pid !== process.pid && isAlive(pid) ? pid : null
  } catch {
    return null
  }
}

export class InstanceLockError extends Error {}

/** Enforces the single-instance rule for a data directory. Stale locks from dead processes are replaced. */
export function acquireInstanceLock(dataDir: string): () => void {
  const file = path.join(dataDir, LOCK_FILE)
  const other = runningServerPid(dataDir)
  if (other) {
    throw new InstanceLockError(`Another Alice server (pid ${other}) is already using ${dataDir}. Alice supports exactly one instance per database.`)
  }
  fs.writeFileSync(file, String(process.pid), { mode: 0o644 })
  return () => {
    try {
      if (fs.readFileSync(file, 'utf8').trim() === String(process.pid)) fs.rmSync(file)
    } catch {
      /* already gone */
    }
  }
}
