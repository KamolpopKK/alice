// ย้ายข้อมูลไปถังขยะของ OS แทนการลบถาวร: การลบจากถังขยะเป็นเรื่องของ OS
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface TrashResult {
  /** Where the data now is. */
  location: string
  /** True when it went to the OS Trash; false when the platform has none and Alice kept it aside. */
  osTrash: boolean
}

function freeName(dir: string, base: string): string {
  let name = base
  for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${base} ${n}`
  return name
}

function move(from: string, to: string): void {
  try {
    fs.renameSync(from, to)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    // คนละ volume: คัดลอกให้ครบก่อนแล้วจึงลบต้นทาง
    fs.cpSync(from, to, { recursive: true, preserveTimestamps: true })
    fs.rmSync(from, { recursive: true, force: true })
  }
}

/** Moves `dir` to the OS Trash (macOS ~/.Trash, freedesktop Trash on Linux); elsewhere into `fallback`. */
export function moveToTrash(dir: string, label: string, fallback: string, env: NodeJS.ProcessEnv = process.env): TrashResult {
  const home = env.HOME || os.homedir()
  const safe = label.replace(/[/\\\u0000-\u001f]/g, '-').slice(0, 100) || 'Alice workspace'
  if (process.platform === 'darwin') {
    const trash = env.ALICE_TRASH_DIR || path.join(home, '.Trash')
    fs.mkdirSync(trash, { recursive: true })
    const target = path.join(trash, freeName(trash, safe))
    move(dir, target)
    return { location: target, osTrash: true }
  }
  if (process.platform === 'linux') {
    const trash = env.ALICE_TRASH_DIR || path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'Trash')
    const files = path.join(trash, 'files')
    const info = path.join(trash, 'info')
    fs.mkdirSync(files, { recursive: true })
    fs.mkdirSync(info, { recursive: true })
    const name = freeName(files, safe)
    fs.writeFileSync(path.join(info, `${name}.trashinfo`), `[Trash Info]\nPath=${encodeURI(dir)}\nDeletionDate=${new Date().toISOString().slice(0, 19)}\n`)
    const target = path.join(files, name)
    move(dir, target)
    return { location: target, osTrash: true }
  }
  fs.mkdirSync(fallback, { recursive: true })
  const target = path.join(fallback, freeName(fallback, safe))
  move(dir, target)
  return { location: target, osTrash: false }
}
