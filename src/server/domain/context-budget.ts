import type { Continuation, Truncation } from '../../shared/contracts'

/**
 * Deterministic character budget for agent context responses. Text is cut to the smaller of
 * its own cap and the remaining budget; every cut or omitted collection item is recorded
 * with a continuation that retrieves the rest.
 */
export class ContextBudget {
  private used = 0
  readonly truncations: Truncation[] = []

  constructor(readonly maxChars: number) {}

  get remaining(): number {
    return Math.max(0, this.maxChars - this.used)
  }

  get usedChars(): number {
    return this.used
  }

  /** Charges a fixed-size piece (ids, titles, metadata) that is never truncated. */
  charge(chars: number): void {
    this.used += chars
  }

  text(path: string, value: string, cap: number, continuation: Continuation): string {
    const allowed = Math.max(0, Math.min(cap, this.remaining))
    const out = value.length > allowed ? value.slice(0, allowed) : value
    this.used += out.length
    if (out.length < value.length) this.truncations.push({ path, kind: 'text', total: value.length, returned: out.length, continuation })
    return out
  }

  collection(path: string, total: number, returned: number, continuation: Continuation): void {
    if (returned < total) this.truncations.push({ path, kind: 'collection', total, returned, continuation })
  }
}
