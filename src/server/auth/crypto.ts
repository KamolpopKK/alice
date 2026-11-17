import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { randomBase32 } from '../ids'

// scrypt เป็น memory-hard hash ที่มากับ Node — ไม่ต้องพึ่ง native dependency เพิ่ม
const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 }

function scrypt(password: string, salt: Buffer, params: { N: number; r: number; p: number; keylen: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFKC'), salt, params.keylen, { N: params.N, r: params.r, p: params.p, maxmem: SCRYPT.maxmem }, (err, key) =>
      err ? reject(err) : resolve(key),
    )
  })
}

/** Format: scrypt$N$r$p$<salt b64url>$<hash b64url> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, SCRYPT)
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join('$')
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, saltB64, hashB64] = parts
  const expected = Buffer.from(hashB64, 'base64url')
  const key = await scrypt(password, Buffer.from(saltB64, 'base64url'), { N: Number(n), r: Number(r), p: Number(p), keylen: expected.length })
  return key.length === expected.length && timingSafeEqual(key, expected)
}

// ใช้ verify กับ hash หลอกเมื่อไม่พบผู้ใช้ เพื่อให้เวลาตอบสนองใกล้เคียงกัน
let dummyHash: Promise<string> | null = null
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'))
  return dummyHash
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** High-entropy bearer secret. Only its SHA-256 is ever stored. */
export function generateSecret(prefix: string, length = 40): string {
  return `${prefix}${randomBase32(length)}`
}

export const AGENT_TOKEN_PREFIX = 'alice_at_'
export const SESSION_PREFIX = 'alice_s_'
export const INVITE_PREFIX = 'alice_inv_'

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}
