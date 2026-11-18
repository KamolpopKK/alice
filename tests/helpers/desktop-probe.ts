import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { testDir } from './tmp'

const ROOT = path.resolve(import.meta.dirname, '../..')
const BIN = path.join(ROOT, 'src-tauri/target/debug/examples/desktop_probe')

/** True when the Rust toolchain can build the real Desktop core for this story. */
export function probeAvailable(): boolean {
  if (process.env.ALICE_SKIP_DESKTOP_PROBE === '1') return false
  if (fs.existsSync(BIN)) return true
  return spawnSync('cargo', ['--version'], { stdio: 'ignore' }).status === 0
}

export function buildProbe(): void {
  const res = spawnSync('cargo', ['build', '--example', 'desktop_probe', '--manifest-path', path.join(ROOT, 'src-tauri/Cargo.toml')], { stdio: 'inherit' })
  if (res.status !== 0) throw new Error('could not build the desktop probe')
}

export interface ProbeEvent {
  event: string
  payload: any
}

/** Drives the real Alice Desktop Rust core through JSON lines (src-tauri/examples/desktop_probe.rs). */
export class DesktopProbe {
  readonly events: ProbeEvent[] = []
  private replies = new Map<number, (v: any) => void>()
  private nextId = 1
  private waiters: Array<{ pred: (e: ProbeEvent) => boolean; resolve: (e: ProbeEvent) => void }> = []
  readonly stdout: string[] = []

  private constructor(private readonly child: ChildProcess) {
    let buffer = ''
    child.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      let idx: number
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        this.stdout.push(line)
        const msg = JSON.parse(line)
        if ('reply' in msg) this.replies.get(msg.reply)?.(msg)
        else if ('event' in msg) {
          this.events.push(msg)
          for (const w of [...this.waiters]) if (w.pred(msg)) (this.waiters.splice(this.waiters.indexOf(w), 1), w.resolve(msg))
        }
      }
    })
  }

  static async start(): Promise<DesktopProbe> {
    // probe เขียน profile ลง temp_dir() ของ Rust (อ่าน TMPDIR): ชี้ไป directory ที่ test ลบเองได้
    const child = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, TMPDIR: testDir('alice-probe-') } })
    const probe = new DesktopProbe(child)
    await new Promise<void>((resolve) => child.stdout!.once('data', () => resolve()))
    return probe
  }

  async send(cmd: Record<string, unknown>): Promise<any> {
    const id = this.nextId++
    const reply = new Promise<any>((resolve) => this.replies.set(id, resolve))
    this.child.stdin!.write(JSON.stringify({ ...cmd, id }) + '\n')
    const res = await reply
    if (!res.ok) throw Object.assign(new Error(`${cmd.cmd} failed: ${res.error.code} ${res.error.message}`), res.error)
    return res.value
  }

  async request(method: string, p: string, body?: unknown) {
    return this.send({ cmd: 'request', method, path: p, body: body ?? null })
  }

  waitFor(pred: (e: ProbeEvent) => boolean, timeoutMs = 15_000): Promise<ProbeEvent> {
    const found = this.events.find(pred)
    if (found) return Promise.resolve(found)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`probe event not seen; got ${JSON.stringify(this.events.slice(-10))}`)), timeoutMs)
      this.waiters.push({ pred, resolve: (e) => (clearTimeout(timer), resolve(e)) })
    })
  }

  invalidations(): Array<{ position: number; kind: string; id: string; mutation: string }> {
    return this.events.filter((e) => e.event === 'alice://events' && e.payload.type === 'invalidate').map((e) => e.payload.data)
  }

  stop() {
    this.child.stdin!.end(JSON.stringify({ cmd: 'quit' }) + '\n')
    this.child.kill()
  }
}
