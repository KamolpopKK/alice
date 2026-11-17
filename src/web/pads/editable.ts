import type { PadSegment } from '../../shared/pads'
import type { MentionMap } from './store'

// Plain-text contentEditable helpers for Text and Heading lines. The DOM only ever holds text nodes
// and non-editable mention chips; anything else (pasted formatting, browser line wrappers) is
// flattened back into text when read.

export function mentionLabel(mentions: MentionMap, taskId: string): string {
  return `@${mentions[taskId]?.title ?? 'Unavailable task'}`
}

export function renderSegments(el: HTMLElement, segments: PadSegment[], mentions: MentionMap): void {
  el.textContent = ''
  for (const s of segments) {
    if (s.type === 'text') el.append(document.createTextNode(s.text))
    else el.append(mentionNode(s.taskId, mentions))
  }
}

export function mentionNode(taskId: string, mentions: MentionMap): HTMLElement {
  const span = document.createElement('span')
  span.className = `mention${mentions[taskId]?.archivedAt ? ' is-archived' : ''}`
  span.contentEditable = 'false'
  span.dataset.mention = taskId
  span.textContent = mentionLabel(mentions, taskId)
  return span
}

/** Reads segments back from an editable element (or a cloned fragment of it). */
export function readSegments(root: Node): PadSegment[] {
  const out: PadSegment[] = []
  const pushText = (text: string) => {
    if (!text) return
    const last = out[out.length - 1]
    if (last?.type === 'text') last.text += text
    else out.push({ type: 'text', text })
  }
  const walk = (node: Node, first: boolean) => {
    node.childNodes.forEach((child, i) => {
      if (child.nodeType === Node.TEXT_NODE) {
        pushText(child.textContent ?? '')
      } else if (child instanceof HTMLElement) {
        if (child.dataset.mention) {
          out.push({ type: 'mention', taskId: child.dataset.mention })
        } else if (child.tagName === 'BR') {
          pushText('\n')
        } else {
          // div/p ที่เบราว์เซอร์แทรกเองเมื่อขึ้นบรรทัด
          const block = child.tagName === 'DIV' || child.tagName === 'P'
          if (block && (i > 0 || !first)) pushText('\n')
          walk(child, false)
        }
      }
    })
  }
  walk(root, true)
  const last = out[out.length - 1]
  if (last?.type === 'text' && last.text.endsWith('\n') && root instanceof HTMLElement) last.text = last.text.replace(/\n$/, '')
  return out.filter((s) => s.type !== 'text' || s.text.length > 0)
}

function selectionIn(el: HTMLElement): Range | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  return el.contains(range.startContainer) ? range : null
}

/** Segments before and after the caret (selection is collapsed first). */
export function splitAtCaret(el: HTMLElement): { before: PadSegment[]; after: PadSegment[] } {
  const range = selectionIn(el)
  if (!range) return { before: readSegments(el), after: [] }
  const before = document.createRange()
  before.selectNodeContents(el)
  before.setEnd(range.startContainer, range.startOffset)
  const after = document.createRange()
  after.selectNodeContents(el)
  after.setStart(range.endContainer, range.endOffset)
  const wrap = (r: Range) => {
    const div = document.createElement('div')
    div.append(r.cloneContents())
    return readSegments(div)
  }
  return { before: wrap(before), after: wrap(after) }
}

export function caretAtStart(el: HTMLElement): boolean {
  const range = selectionIn(el)
  if (!range || !range.collapsed) return false
  const r = document.createRange()
  r.selectNodeContents(el)
  r.setEnd(range.startContainer, range.startOffset)
  return r.toString().length === 0 && !r.cloneContents().querySelector?.('[data-mention]')
}

export function caretAtEnd(el: HTMLElement): boolean {
  const range = selectionIn(el)
  if (!range || !range.collapsed) return false
  const r = document.createRange()
  r.selectNodeContents(el)
  r.setStart(range.endContainer, range.endOffset)
  return r.toString().replace(/\n$/, '').length === 0 && !r.cloneContents().querySelector?.('[data-mention]')
}

export function placeCaret(el: HTMLElement, at: 'start' | 'end' | number): void {
  el.focus({ preventScroll: false })
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  if (at === 'start') {
    range.selectNodeContents(el)
    range.collapse(true)
  } else if (at === 'end') {
    range.selectNodeContents(el)
    range.collapse(false)
  } else {
    // ตำแหน่งตามจำนวนตัวอักษร (mention นับเป็นหนึ่ง)
    let remaining = at
    let placed = false
    for (const node of Array.from(el.childNodes)) {
      const len = node.nodeType === Node.TEXT_NODE ? (node.textContent ?? '').length : 1
      if (remaining <= len) {
        if (node.nodeType === Node.TEXT_NODE) range.setStart(node, remaining)
        else range.setStartAfter(node)
        placed = true
        break
      }
      remaining -= len
    }
    if (!placed) {
      range.selectNodeContents(el)
      range.collapse(false)
    } else range.collapse(true)
  }
  sel.removeAllRanges()
  sel.addRange(range)
}

/** The `@query` typed right before the caret, if any. */
export function mentionQuery(el: HTMLElement): { query: string; node: Text; start: number; end: number } | null {
  const range = selectionIn(el)
  if (!range || !range.collapsed || range.startContainer.nodeType !== Node.TEXT_NODE) return null
  const node = range.startContainer as Text
  const before = (node.textContent ?? '').slice(0, range.startOffset)
  const match = /(^|\s)@([^@\n]{0,40})$/.exec(before)
  if (!match) return null
  const start = range.startOffset - match[2].length - 1
  return { query: match[2], node, start, end: range.startOffset }
}

/** Replaces the `@query` with a mention chip followed by a space, leaving the caret after it. */
export function insertMention(el: HTMLElement, at: { node: Text; start: number; end: number }, taskId: string, mentions: MentionMap): void {
  const range = document.createRange()
  range.setStart(at.node, at.start)
  range.setEnd(at.node, at.end)
  range.deleteContents()
  const chip = mentionNode(taskId, mentions)
  const space = document.createTextNode(' ')
  range.insertNode(space)
  range.insertNode(chip)
  const sel = window.getSelection()
  const caret = document.createRange()
  caret.setStartAfter(space)
  caret.collapse(true)
  sel?.removeAllRanges()
  sel?.addRange(caret)
  el.normalize()
}

/** Inserts plain text at the caret (formatting from the clipboard is never kept). */
export function insertPlainText(text: string): void {
  // execCommand ยังเป็นวิธีเดียวที่รักษา caret และ native undo ของ contentEditable ได้
  if (!document.execCommand('insertText', false, text)) {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    range.deleteContents()
    const node = document.createTextNode(text)
    range.insertNode(node)
    range.setStartAfter(node)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  }
}

/** Non-blank lines of pasted text, or null when the paste is a single line. */
export function pastedLines(text: string): string[] | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const nonBlank = lines.filter((l) => l.trim())
  return nonBlank.length > 1 ? lines : null
}
