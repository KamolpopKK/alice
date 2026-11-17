import { describe, expect, it } from 'vitest'
import { wouldCreateCycle } from '../../src/server/domain/graph'

const graph = (edges: Array<[string, string]>) => (id: string) => edges.filter(([a]) => a === id).map(([, b]) => b)

describe('wouldCreateCycle', () => {
  it('rejects self edges', () => {
    expect(wouldCreateCycle('a', 'a', graph([]))).toBe(true)
  })

  it('detects direct and indirect cycles', () => {
    const g = graph([
      ['b', 'a'],
      ['c', 'b'],
    ])
    expect(wouldCreateCycle('a', 'b', g)).toBe(true) // a→b, b→a
    expect(wouldCreateCycle('a', 'c', g)).toBe(true) // a→c→b→a
    expect(wouldCreateCycle('c', 'a', g)).toBe(false) // already implied direction
  })

  it('allows diamonds and disconnected edges', () => {
    const g = graph([
      ['b', 'a'],
      ['c', 'a'],
      ['d', 'b'],
      ['d', 'c'],
    ])
    expect(wouldCreateCycle('e', 'd', g)).toBe(false)
    expect(wouldCreateCycle('c', 'b', g)).toBe(false)
    expect(wouldCreateCycle('a', 'd', g)).toBe(true)
  })

  it('terminates on existing cycles and long chains', () => {
    expect(wouldCreateCycle('x', 'a', graph([['a', 'b'], ['b', 'a']]))).toBe(false)
    const chain: Array<[string, string]> = Array.from({ length: 10_000 }, (_, i) => [`n${i + 1}`, `n${i}`])
    expect(wouldCreateCycle('n0', 'n10000', graph(chain))).toBe(true)
  })
})
