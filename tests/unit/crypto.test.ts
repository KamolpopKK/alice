import { describe, expect, it } from 'vitest'
import { AGENT_TOKEN_PREFIX, generateSecret, hashPassword, safeEqual, sha256, verifyPassword } from '../../src/server/auth/crypto'

describe('password and token primitives', () => {
  it('hashes passwords with a per-hash salt and verifies them', async () => {
    const a = await hashPassword('correct horse battery')
    const b = await hashPassword('correct horse battery')
    expect(a).not.toBe(b)
    expect(a.startsWith('scrypt$')).toBe(true)
    expect(await verifyPassword('correct horse battery', a)).toBe(true)
    expect(await verifyPassword('wrong horse battery', a)).toBe(false)
    expect(await verifyPassword('anything', 'garbage')).toBe(false)
  })

  it('generates unique prefixed secrets and deterministic hashes', () => {
    const t1 = generateSecret(AGENT_TOKEN_PREFIX)
    const t2 = generateSecret(AGENT_TOKEN_PREFIX)
    expect(t1).not.toBe(t2)
    expect(t1.startsWith(AGENT_TOKEN_PREFIX)).toBe(true)
    expect(t1.length).toBe(AGENT_TOKEN_PREFIX.length + 40)
    expect(sha256(t1)).toBe(sha256(t1))
    expect(sha256(t1)).not.toContain(t1)
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'ab')).toBe(false)
  })
})
