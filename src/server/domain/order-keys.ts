// Fractional order keys: strings over [0-9a-z] compared byte-wise, never ending in '0'.
// Inserting between two neighbours never renumbers other rows; keys only grow when the same gap
// is split repeatedly, and callers rebalance a sibling list when a key gets too long.

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length
/** Keys longer than this trigger a transparent rebalance of their sibling list. */
export const MAX_KEY_LENGTH = 48

function digit(c: string | undefined): number {
  if (c === undefined) return 0
  const n = DIGITS.indexOf(c)
  if (n < 0) throw new Error(`invalid order key character ${c}`)
  return n
}

export function isValidKey(key: string): boolean {
  return key.length > 0 && /^[0-9a-z]+$/.test(key) && !key.endsWith('0')
}

/** A key strictly between `a` and `b`. `a = null` means "before everything", `b = null` "after everything". */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) throw new Error(`order keys out of order: ${a} >= ${b}`)
  if (b === null) return keyAfter(a ?? '')
  return midpoint(a ?? '', b)
}

/** Successor that fills two-digit space densely before growing (the common "append" case). */
function keyAfter(a: string): string {
  if (a === '') return DIGITS[Math.floor(BASE / 2)]
  if (a.length === 1) return a + DIGITS[1]
  const last = digit(a[a.length - 1])
  if (last < BASE - 1) return a.slice(0, -1) + DIGITS[last + 1]
  const rest = a.replace(/z+$/, '')
  if (rest.length > 0) return rest.slice(0, -1) + DIGITS[digit(rest[rest.length - 1]) + 1]
  return a + DIGITS[1]
}

function midpoint(a: string, b: string): string {
  // ตัด prefix ร่วมออกก่อน แล้วหาค่ากลางของตำแหน่งที่ต่างกัน
  let n = 0
  while ((a[n] ?? '0') === b[n]) n++
  if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
  const da = digit(a[0])
  const db = digit(b[0])
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)]
  if (b.length > 1) return b[0]
  return DIGITS[da] + keyAfter(a.slice(1))
}

/** `count` increasing keys strictly between `a` and `b`. */
export function keysBetween(a: string | null, b: string | null, count: number): string[] {
  const out: string[] = []
  let prev = a
  for (let i = 0; i < count; i++) {
    const k = keyBetween(prev, b)
    out.push(k)
    prev = k
  }
  return out
}

/** Evenly spaced fixed-width keys for `count` items, used when rebalancing a sibling list. */
export function evenKeys(count: number): string[] {
  let width = 1
  while (BASE ** width < (count + 1) * 4) width++
  const span = BASE ** width
  const out: string[] = []
  for (let i = 1; i <= count; i++) {
    let value = Math.floor((i * span) / (count + 1))
    let key = ''
    for (let w = 0; w < width; w++) {
      key = DIGITS[value % BASE] + key
      value = Math.floor(value / BASE)
    }
    out.push(key.replace(/0+$/, ''))
  }
  return out
}
