// นับงานที่กำลังทำ (request, event stream, operation ที่ห้ามขัดจังหวะ) และการมีอยู่ของ Desktop
// daemon ที่ CLI เปิดไว้อย่างเดียวจะปิดตัวเองเมื่อว่างครบเวลา (ค่าเริ่มต้น 10 นาที)

export class IdleTracker {
  private active = 0
  private streams = 0
  private protectedOps = 0
  private presenceUntil = 0
  private lastActivity = Date.now()
  private timer: NodeJS.Timeout | null = null
  private listener: (() => void) | null = null

  constructor(
    readonly idleMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.lastActivity = now()
    this.timer = setInterval(() => this.check(), Math.min(1_000, Math.max(50, Math.floor(idleMs / 4))))
    this.timer.unref()
  }

  onIdle(fn: () => void): void {
    this.listener = fn
  }

  /** A request (or a long-lived event stream) started; call the returned function when it closes. */
  begin(stream = false): () => void {
    if (stream) this.streams++
    else this.active++
    this.lastActivity = this.now()
    let done = false
    return () => {
      if (done) return
      done = true
      if (stream) this.streams--
      else this.active--
      this.lastActivity = this.now()
    }
  }

  /** Resolves once no ordinary request or protected operation is running (event streams excluded). */
  async drained(timeoutMs = 30_000): Promise<boolean> {
    const deadline = this.now() + timeoutMs
    while (this.active > 0 || this.protectedOps > 0) {
      if (this.now() > deadline) return false
      await new Promise((r) => setTimeout(r, 25))
    }
    return true
  }

  /** Desktop keeps its active workspace alive by renewing a short presence lease. */
  presence(ms: number): void {
    this.presenceUntil = Math.max(this.presenceUntil, this.now() + ms)
    this.lastActivity = this.now()
  }

  /** Mutations, backups, restores, migrations and update activation must never be cut off. */
  async protect<T>(fn: () => Promise<T> | T): Promise<T> {
    this.protectedOps++
    try {
      return await fn()
    } finally {
      this.protectedOps--
      this.lastActivity = this.now()
    }
  }

  get busy(): boolean {
    return this.active > 0 || this.streams > 0 || this.protectedOps > 0 || this.presenceUntil > this.now()
  }

  status() {
    return { active: this.active, eventStreams: this.streams, protectedOperations: this.protectedOps, desktopPresent: this.presenceUntil > this.now() }
  }

  check(): void {
    if (!this.listener || this.busy) return
    if (this.now() - this.lastActivity >= this.idleMs) {
      const fn = this.listener
      this.listener = null
      fn()
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.listener = null
  }
}
