// Instance lock ของ Local workspace: เจ้าของ SQLite ได้ทีละ process เดียว (daemon, restore หรือการลบ)
import fs from 'node:fs'
import { isProcessAlive, type WorkspacePaths } from './paths'

export class LocalDaemonError extends Error {
  override name = 'LocalDaemonError'
}

/**
 * Takes the workspace's instance lock with an exclusive create, so two daemons can never both win.
 * A lock left by a dead process is removed; a live one is never broken.
 */
export function acquireWorkspaceLock(paths: WorkspacePaths): () => void {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const fd = fs.openSync(paths.lock, 'wx', 0o600)
      fs.writeSync(fd, String(process.pid))
      fs.closeSync(fd)
      return () => {
        try {
          if (fs.readFileSync(paths.lock, 'utf8').trim() === String(process.pid)) fs.rmSync(paths.lock)
        } catch {
          /* already gone */
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      let holder = NaN
      try {
        holder = Number(fs.readFileSync(paths.lock, 'utf8').trim())
      } catch {
        /* the holder is still writing its pid */
      }
      if (Number.isInteger(holder) && holder > 0 && isProcessAlive(holder)) {
        throw new LocalDaemonError(`already running (pid ${holder})`)
      }
      if (!Number.isInteger(holder) || holder <= 0) {
        // อีก process เพิ่งสร้าง lock และยังเขียน pid ไม่เสร็จ — รอสั้น ๆ แล้วลองใหม่
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
        continue
      }
      fs.rmSync(paths.lock, { force: true })
    }
  }
  throw new LocalDaemonError('could not acquire the workspace lock')
}

