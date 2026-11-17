import { describe, expect, it } from 'vitest'
import { ContextBudget } from '../../src/server/domain/context-budget'

const cont = { tool: 'get_task', args: { id: 't' } }

describe('ContextBudget', () => {
  it('passes small text through without truncation records', () => {
    const b = new ContextBudget(100)
    expect(b.text('a', 'hello', 50, cont)).toBe('hello')
    expect(b.usedChars).toBe(5)
    expect(b.truncations).toEqual([])
  })

  it('cuts to the per-field cap and records the truncation', () => {
    const b = new ContextBudget(1000)
    expect(b.text('task.description', 'x'.repeat(300), 100, cont)).toHaveLength(100)
    expect(b.truncations).toEqual([{ path: 'task.description', kind: 'text', total: 300, returned: 100, continuation: cont }])
  })

  it('never exceeds the total budget, even when caps are generous', () => {
    const b = new ContextBudget(250)
    b.charge(50)
    const first = b.text('a', 'y'.repeat(150), 1000, cont)
    const second = b.text('b', 'z'.repeat(150), 1000, cont)
    expect(first).toHaveLength(150)
    expect(second).toHaveLength(50)
    expect(b.usedChars).toBe(250)
    expect(b.text('c', 'more', 1000, cont)).toBe('')
    expect(b.truncations.map((t) => [t.path, t.returned])).toEqual([
      ['b', 50],
      ['c', 0],
    ])
  })

  it('is deterministic and records omitted collection items', () => {
    const run = () => {
      const b = new ContextBudget(120)
      b.text('a', 'q'.repeat(200), 80, cont)
      b.collection('comments', 30, 10, { tool: 'list_comments', args: { cursor: 'c' } })
      b.collection('documents', 2, 2, cont)
      return b.truncations
    }
    expect(run()).toEqual(run())
    expect(run().map((t) => t.path)).toEqual(['a', 'comments'])
  })
})
