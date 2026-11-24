import { afterEach, describe, expect, it, vi } from 'vitest'
import { canonicalDocumentLink, parseDocumentMarkdown } from '../../src/shared/document-links'
import { exportMarkdown, importMarkdown } from '../../src/web/documents/markdown'

afterEach(() => vi.unstubAllGlobals())

describe('canonical document links', () => {
  it('recognizes only workspace-relative Document IDs with safe fragments', () => {
    expect(canonicalDocumentLink('/documents/doc_account#เริ่มต้น')).toEqual({ documentId: 'doc_account', fragment: '#เริ่มต้น', href: '/documents/doc_account#เริ่มต้น' })
    expect(canonicalDocumentLink(' /documents/doc_account ')).toMatchObject({ href: '/documents/doc_account' })
    for (const value of ['https://alice.test/documents/doc_account', '//evil.test/documents/doc_account', 'alice://open/document/doc_account', 'javascript:/documents/doc_account', '/documents/tsk_task', '/documents/doc_a/extra', '/documents/doc_%61', '/documents/doc_a?workspace=other', '/documents/doc_a#bad\nfragment', '/documents/doc_'+'a'.repeat(61)]) {
      expect(canonicalDocumentLink(value), value).toBeNull()
    }
  })

  it('deduplicates links, resolves definitions and leaves typed relation IDs alone', () => {
    const body = '[First](/documents/doc_a#one) [Second](/documents/doc_a#two) [Reference][ref]\n\n[ref]: /documents/doc_b\n\n[ref]: /documents/doc_ignored\n\ndoc_plain [Self](/documents/doc_self)'
    expect(parseDocumentMarkdown(body, 'doc_self').targets).toEqual(['doc_a', 'doc_b'])
    expect(parseDocumentMarkdown('[missing][unknown]').targets).toEqual([])
  })

  it('does not derive links from code, images, raw HTML or external URLs', () => {
    const fetch = vi.fn(() => { throw new Error('Unexpected external access') })
    vi.stubGlobal('fetch', fetch)
    const body = '`[inline](/documents/doc_code)`\n\n```md\n[code](/documents/doc_fence)\n# Not an outline heading\n```\n\n![Image](/documents/doc_image)\n\n<a href="/documents/doc_html">Raw HTML</a>\n\n[Outside](https://example.test/documents/doc_external)'
    expect(parseDocumentMarkdown(body)).toEqual({ targets: [], outline: [] })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('supports shortcut/collapsed references and ignores unused definitions', () => {
    const body = '[Account][] and [ACCOUNT] and [custom][ Account ]\n\n[account]: /documents/doc_account\n[unused]: /documents/doc_unused\n'
    expect(parseDocumentMarkdown(body).targets).toEqual(['doc_account'])
  })

  it('preserves exact Markdown and handles links embedded in ordinary blocks', () => {
    const body = '# คู่มือ 🚀\n\n- [บัญชี](/documents/doc_account)\n\n> [แผน](/documents/doc_plan)\n\n| เรื่อง | เอกสาร |\n|---|---|\n| บัญชี | [ข้อกำหนด](/documents/doc_spec) |\n\n~~~\n[ignore](/documents/doc_code)\n~~~\n'
    expect(parseDocumentMarkdown(body).targets).toEqual(['doc_account', 'doc_plan', 'doc_spec'])
    const session = importMarkdown(body)
    expect(exportMarkdown(session.doc, session)).toBe(body)
  })

  it('keeps UTF-16 heading and section offsets valid for Thai, emoji and nested headings', () => {
    const body = 'คำนำ 🚀\n\n# **บัญชี** และ `OTP`\n\nเนื้อหา\n\n## รายละเอียด [ระบบ](/documents/doc_system)\n\nข้อความ\n\n# จบ\n'
    const result = parseDocumentMarkdown(body)
    expect(result.outline.map((h) => [h.text, h.level])).toEqual([['บัญชี และ OTP', 1], ['รายละเอียด ระบบ', 2], ['จบ', 1]])
    for (const h of result.outline) {
      expect(body.slice(h.offset, h.headingEndOffset)).toMatch(/^#{1,2} /)
      expect(h.offset).toBeLessThan(h.headingEndOffset)
      expect(h.headingEndOffset).toBeLessThanOrEqual(h.endOffset)
    }
    expect(result.outline[0].endOffset).toBe(result.outline[2].offset)
    expect(result.outline[1].endOffset).toBe(result.outline[2].offset)
    expect(result.outline[2].endOffset).toBe(body.length)
    expect(result.targets).toEqual(['doc_system'])
  })

  it('handles setext headings, empty input and headings near the Markdown size boundary', () => {
    expect(parseDocumentMarkdown('')).toEqual({ targets: [], outline: [] })
    const source = 'Heading\n=======\n\nSubheading\n----------\n'
    expect(parseDocumentMarkdown(source).outline.map((h) => h.level)).toEqual([1, 2])
    const long = 'ก'.repeat(99_970)+'\n\n## ท้ายเรื่อง 🚀\n'
    const h = parseDocumentMarkdown(long).outline[0]
    expect(long.slice(h.offset, h.headingEndOffset)).toBe('## ท้ายเรื่อง 🚀')
    expect(h.endOffset).toBe(long.length)
  })
})
