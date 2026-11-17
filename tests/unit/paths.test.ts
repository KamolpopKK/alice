import { describe, expect, it } from 'vitest'
import { exportFileName, slugify } from '../../src/server/ops/paths'

describe('export path sanitization', () => {
  it('produces readable slugs and keeps Thai text', () => {
    expect(slugify('Launch Checklist: Q4 / 2026')).toBe('launch-checklist-q4-2026')
    expect(slugify('คู่มือพนักงาน ใหม่')).toBe('คู่มือพนักงาน-ใหม่')
  })

  it('neutralizes traversal, separators, control and reserved names', () => {
    expect(slugify('../../etc/passwd')).toBe('etc-passwd')
    expect(slugify('..')).toBe('untitled')
    expect(slugify('a\\b\u0000c')).toBe('a-b-c')
    expect(slugify('   ')).toBe('untitled')
    expect(slugify('CON')).toBe('con-file')
    for (const name of ['../x', 'a/b', 'C:\\x', '.hidden']) expect(exportFileName(name, 'doc_1')).not.toMatch(/[\\/]|^\./)
  })

  it('bounds length and stays unique per id', () => {
    expect([...slugify('x'.repeat(500))]).toHaveLength(60)
    expect(exportFileName('Same', 'doc_a')).not.toBe(exportFileName('Same', 'doc_b'))
    expect(exportFileName('Same', '../doc_a')).toBe('same--doc_a.md')
  })
})
