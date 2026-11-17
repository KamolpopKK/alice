import { randomBytes } from 'node:crypto'

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz' // Crockford base32, lowercase

export function randomBase32(length: number): string {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] & 31]
  return out
}

/** Opaque, immutable public identifier, e.g. `tsk_8f3k2...`. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBase32(20)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}
