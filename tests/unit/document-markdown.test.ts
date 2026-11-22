import type { JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { MARKDOWN_LIMIT, MarkdownConversionError, exportMarkdown, importMarkdown } from '../../src/web/documents/markdown'

// ชุดเอกสารตัวอย่าง: เปิดแล้วบันทึกโดยไม่แก้ ต้องได้ข้อความเดิมทุกตัวอักษร
const CORPUS: Record<string, string> = {
  'headings, marks and links': '# Title\n\nSome *em*, __strong__, ~~gone~~, `code` and [a link](https://example.com "Example").\n\n## Next\n\nLine one  \nline two\n',
  'Thai and emoji': '# แผนงานไตรมาส 🚀\n\nทีมจะส่งงาน **ภายในวันศุกร์** 🎉 และทดสอบบน macOS\n',
  'nested and ordered lists': '- one\n  - nested *a*\n    - deeper\n- two\n\n3. three\n4. four\n',
  'loose list': '- first\n\n- second\n',
  'task list': '- [ ] todo\n- [x] done\n  - [ ] nested todo\n',
  'table with alignment': '| Name | Count | Note |\n|:-----|------:|:----:|\n| a    |     1 | ok   |\n| b    |    22 | `x`  |\n',
  'fences and Mermaid': '```ts\nconst a = 1\n```\n\n```mermaid\ngraph TD\n  A-->B\n```\n\n~~~\ntilde fence\n~~~\n',
  'quote and rule': '> quoted **text**\n> more\n\n***\n\nafter\n',
  'odd spacing between blocks': '\n\nFirst\n\n\n\nSecond\n\n',
  'no final newline': 'Just text',
  'raw HTML block and comment': '<div align="center">\n  <img src="logo.png" alt="Logo">\n</div>\n\n<!-- keep me -->\n\nText\n',
  'inline HTML': 'Press <kbd>Ctrl</kbd> and <b>go</b>.\n',
  'references and definitions': 'See [the spec][spec] and ![chart][img].\n\n[spec]: https://example.com/spec "Spec"\n[img]: https://example.com/c.png\n',
  'footnotes': 'Claim.[^1]\n\n[^1]: Source of the claim.\n',
  'image': '![Diagram](https://example.com/d.png)\n',
  'list containing HTML': '- plain\n- with <span>html</span>\n  - nested\n',
  'escaped characters': 'Not \\*emphasis\\* and 1\\. not a list\n',
  'code with info string': '```js title="x.js"\nlet x\n```\n',
  'empty': '',
}

function roundTrip(source: string): string {
  const session = importMarkdown(source)
  return exportMarkdown(session.doc, session)
}

function types(source: string): string[] {
  return (importMarkdown(source).doc.content ?? []).map((n) => n.type!)
}

/** Replaces the text of the top-level block at `index` (a paragraph or heading). */
function editText(doc: JSONContent, index: number, text: string): JSONContent {
  const content = structuredClone(doc.content!)
  content[index] = { ...content[index], content: [{ type: 'text', text }] }
  return { ...doc, content }
}

describe('Markdown bridge: opening and saving unchanged returns the same text', () => {
  for (const [name, source] of Object.entries(CORPUS)) {
    it(name, () => {
      expect(roundTrip(source)).toBe(source)
    })
  }

  it('keeps a document at the 100,000-character limit exactly', () => {
    const unit = '## Section ภาษาไทย 🎯\n\nParagraph with **bold**, a [link](https://example.com) and `code`.\n\n- item\n  - nested\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<!-- note -->\n\n'
    let source = ''
    while (source.length + unit.length <= MARKDOWN_LIMIT) source += unit
    source += 'x'.repeat(MARKDOWN_LIMIT - source.length)
    expect(source.length).toBe(MARKDOWN_LIMIT)
    expect(roundTrip(source)).toBe(source)
  })
})

describe('Markdown bridge: what becomes rich content and what stays raw', () => {
  it('shows supported blocks as rich content', () => {
    expect(types(CORPUS['headings, marks and links'])).toEqual(['heading', 'paragraph', 'heading', 'paragraph'])
    expect(types(CORPUS['table with alignment'])).toEqual(['table'])
    expect(types(CORPUS['task list'])).toEqual(['taskList'])
    expect(types(CORPUS['fences and Mermaid'])).toEqual(['codeBlock', 'codeBlock', 'codeBlock'])
  })

  it('keeps unsupported content, and the whole container around it, as raw blocks', () => {
    expect(types(CORPUS['raw HTML block and comment'])).toEqual(['rawMarkdownBlock', 'rawMarkdownBlock', 'paragraph'])
    expect(types(CORPUS['inline HTML'])).toEqual(['rawMarkdownBlock'])
    // definition แต่ละบรรทัดเป็นบล็อกของตัวเอง และย่อหน้าที่อ้างถึงก็ต้องเป็น raw
    expect(types(CORPUS['references and definitions'])).toEqual(['rawMarkdownBlock', 'rawMarkdownBlock', 'rawMarkdownBlock'])
    expect(types(CORPUS['footnotes'])).toEqual(['rawMarkdownBlock', 'rawMarkdownBlock'])
    expect(types(CORPUS['image'])).toEqual(['rawMarkdownBlock'])
    // HTML ใน list ย่อย: เก็บทั้ง list เป็น raw ไม่ตัดโครงสร้างข้างใน
    expect(types(CORPUS['list containing HTML'])).toEqual(['rawMarkdownBlock'])
    const raw = importMarkdown(CORPUS['list containing HTML']).doc.content![0]
    expect(raw.attrs).toMatchObject({ source: '- plain\n- with <span>html</span>\n  - nested', reason: 'html' })
  })

  it('keeps blocks raw when the editor would change their structure', () => {
    // list ที่ปน task กับ bullet: editor แยกเป็นสอง list จึงเก็บเป็น raw
    expect(types('- [ ] task\n- plain\n')).toEqual(['rawMarkdownBlock'])
  })

  it('keeps a code fence info string when the code is edited', () => {
    const session = importMarkdown(CORPUS['code with info string'])
    const doc = structuredClone(session.doc)
    doc.content![0].content = [{ type: 'text', text: 'let y' }]
    expect(exportMarkdown(doc, session)).toBe('```js title="x.js"\nlet y\n```\n')
  })

  it('keeps escaped markers escaped when an edited block is serialized', () => {
    const session = importMarkdown(CORPUS['escaped characters'])
    expect(types(CORPUS['escaped characters'])).toEqual(['paragraph'])
    const doc = editText(session.doc, 0, 'Literal *stars* and 1. text')
    const out = exportMarkdown(doc, session)
    expect(importMarkdown(out).doc.content![0].content).toEqual([{ type: 'text', text: 'Literal *stars* and 1. text' }])
  })
})

describe('Markdown bridge: editing', () => {
  it('serializes only the edited block and keeps every other block and separator as written', () => {
    const source = '# Title\n\nFirst __para__\n\n\n<!-- c -->\n\n| a | b |\n|:--|--:|\n| 1 | 2 |\n\n```mermaid\ngraph TD\n```\n'
    const session = importMarkdown(source)
    const edited = editText(session.doc, 0, 'New title ไทย')
    expect(exportMarkdown(edited, session)).toBe(source.replace('# Title', '# New title ไทย'))
  })

  it('adds new blocks with standard spacing and keeps raw blocks when others are removed', () => {
    const session = importMarkdown('Intro\n\n<div>raw</div>\n\nOutro\n')
    const [intro, raw] = session.doc.content!
    const doc = { type: 'doc', content: [raw, intro, { type: 'paragraph', content: [{ type: 'text', text: 'Added', marks: [{ type: 'bold' }] }] }] }
    expect(exportMarkdown(doc, session)).toBe('<div>raw</div>\n\nIntro\n\n**Added**\n')
  })

  it('serializes a split block instead of reusing the original source twice', () => {
    const session = importMarkdown('One two\n')
    const [p] = session.doc.content!
    const doc = { type: 'doc', content: [{ ...p, content: [{ type: 'text', text: 'One' }] }, { ...p, content: [{ type: 'text', text: 'two' }] }] }
    expect(exportMarkdown(doc, session)).toBe('One\n\ntwo\n')
  })

  it('rebuilds the mapping from edited source instead of reusing old offsets', () => {
    const first = importMarkdown('A\n\nB\n')
    const second = importMarkdown('Z\n\nA\n\nB changed\n')
    const firstIds = first.doc.content!.map((n) => n.attrs?.sourceBlock)
    const secondIds = second.doc.content!.map((n) => n.attrs?.sourceBlock)
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false)
    expect(exportMarkdown(second.doc, second)).toBe('Z\n\nA\n\nB changed\n')
    // เอกสารจาก import เก่าไม่ใช้ source ของ session ใหม่ผิดบล็อก
    expect(exportMarkdown(editText(second.doc, 1, 'A2'), second)).toBe('Z\n\nA2\n\nB changed\n')
  })

  it('refuses to produce text over the limit instead of cutting it', () => {
    const session = importMarkdown('Short\n')
    const doc = editText(session.doc, 0, 'y'.repeat(MARKDOWN_LIMIT + 1))
    expect(() => exportMarkdown(doc, session)).toThrow(MarkdownConversionError)
    expect(() => exportMarkdown(doc, session)).toThrow(/over the 100,000-character limit. Nothing was cut/)
  })

  it('reports a conversion failure with an actionable message', () => {
    const session = importMarkdown('Text\n')
    const doc = { type: 'doc', content: [{ type: 'notAType', content: [] }] }
    expect(() => exportMarkdown(doc, session)).toThrow(/switch to Markdown source/)
  })
})
