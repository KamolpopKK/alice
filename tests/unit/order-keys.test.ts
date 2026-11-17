import { describe, expect, it } from 'vitest'
import { MAX_KEY_LENGTH, evenKeys, isValidKey, keyBetween, keysBetween } from '../../src/server/domain/order-keys'

describe('fractional order keys', () => {
  it('produces strictly ordered, valid keys between any neighbours', () => {
    const keys: string[] = [keyBetween(null, null)]
    // สุ่มแทรกตำแหน่งต่าง ๆ แล้วตรวจลำดับทุกครั้ง
    let seed = 7
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647
    for (let i = 0; i < 2000; i++) {
      const at = Math.floor(rand() * (keys.length + 1))
      const k = keyBetween(at === 0 ? null : keys[at - 1], at === keys.length ? null : keys[at])
      expect(isValidKey(k)).toBe(true)
      keys.splice(at, 0, k)
    }
    expect([...keys].sort()).toEqual(keys)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('grows slowly for appends and prepends', () => {
    let last: string | null = null
    for (let i = 0; i < 1000; i++) last = keyBetween(last, null)
    expect(last!.length).toBeLessThan(MAX_KEY_LENGTH)
    let first: string | null = null
    for (let i = 0; i < 200; i++) first = keyBetween(null, first)
    expect(isValidKey(first!)).toBe(true)
  })

  it('creates batches and even rebalanced keys in order', () => {
    const batch = keysBetween('a', 'b', 50)
    expect([...batch].sort()).toEqual(batch)
    expect(batch[0] > 'a' && batch[49] < 'b').toBe(true)
    const even = evenKeys(5000)
    expect(even.every(isValidKey)).toBe(true)
    expect([...even].sort()).toEqual(even)
    expect(new Set(even).size).toBe(5000)
  })

  it('rejects inverted neighbours', () => {
    expect(() => keyBetween('b', 'a')).toThrow()
  })
})
