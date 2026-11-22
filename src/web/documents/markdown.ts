import { getSchema, type AnyExtension, type JSONContent } from '@tiptap/core'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { MarkdownManager } from '@tiptap/markdown'
import type { Schema } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import type { Nodes, Root, RootContent } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { RawMarkdownBlock, SourceBlockId } from './rawMarkdownBlock'

/**
 * Markdown compatibility bridge for the rich document editor.
 *
 * Markdown stays the stored format that agents and the CLI read and write. The editor only gets a
 * projection: every top-level block of the source becomes either rich content (when the editor can
 * represent it and convert it back without loss) or a raw block that keeps its source verbatim.
 * Exporting reuses the original source of every untouched block and serializes only changed ones,
 * so opening a document and saving it unchanged returns exactly the same text.
 */

/** Same ceiling as the server's `markdownSchema`. */
export const MARKDOWN_LIMIT = 100_000

/** Extensions of the document editor; the editor UI must use this same list. */
export const documentEditorExtensions: AnyExtension[] = [
  // Markdown ไม่มี underline: ปิดไว้เพื่อไม่ให้เกิดเนื้อหาที่แปลงกลับเป็น Markdown ไม่ได้
  StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: true } }),
  TableKit,
  TaskList,
  TaskItem.configure({ nested: true }),
  RawMarkdownBlock,
  SourceBlockId,
]

export class MarkdownConversionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MarkdownConversionError'
  }
}

interface SourceBlock {
  id: string
  source: string
  /** Separator between this block and the next one in the original source. */
  after: string
  /** Normalized editor JSON of the block, used to tell whether it was edited. */
  json: JSONContent
}

/** What an import produced; pass it back to `exportMarkdown`. Lives in memory only. */
export interface MarkdownSession {
  doc: JSONContent
  blocks: Map<string, SourceBlock>
  /** Block ids in source order. */
  order: string[]
  /** Text before the first block (usually empty). */
  leading: string
  /** Text after the last block, such as the final newline. */
  trailing: string
}

// ชนิด mdast ที่ editor แสดงและแปลงกลับได้ อย่างอื่น (html, definition, reference, footnote, image, ...) เป็น raw
const SUPPORTED = new Set([
  'paragraph', 'heading', 'list', 'listItem', 'blockquote', 'code', 'table', 'tableRow', 'tableCell', 'thematicBreak',
  'text', 'emphasis', 'strong', 'delete', 'inlineCode', 'link', 'break',
])

let manager: MarkdownManager | null = null
let schema: Schema | null = null
let generation = 0

function tiptap() {
  manager ??= new MarkdownManager({ extensions: documentEditorExtensions })
  schema ??= getSchema(documentEditorExtensions)
  return { manager, schema }
}

function parseMdast(source: string): Root {
  return unified().use(remarkParse).use(remarkGfm).parse(source)
}

function unsupported(node: Nodes): string | null {
  if (!SUPPORTED.has(node.type)) return node.type
  if ('children' in node) {
    for (const child of node.children) {
      const found = unsupported(child)
      if (found) return found
    }
  }
  return null
}

/** mdast without positions, for comparing meaning rather than spelling. */
function shape(source: string): string {
  return JSON.stringify(parseMdast(source).children, (key, value) => (key === 'position' ? undefined : value))
}

/** Editor JSON as the editor itself would hold it (default attributes filled in), without the block id. */
function normalize(node: JSONContent): JSONContent {
  const { schema: s } = tiptap()
  const json = s.nodeFromJSON(node).toJSON() as JSONContent
  if (json.attrs && 'sourceBlock' in json.attrs) {
    const { sourceBlock: _id, ...attrs } = json.attrs
    json.attrs = attrs
  }
  return json
}

function sameJson(a: JSONContent, b: JSONContent): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function serializeNode(node: JSONContent): string {
  const { manager: m } = tiptap()
  return m.serialize({ type: 'doc', content: [node] }).replace(/^\n+|\s+$/g, '')
}

function rawNode(id: string, source: string, reason: string): JSONContent {
  return { type: 'rawMarkdownBlock', attrs: { source, reason, sourceBlock: id } }
}

/**
 * Converts one top-level block, or returns why it must stay raw. A block is rich only when it holds
 * supported content, becomes exactly one editor node, and that node serializes back to Markdown with
 * the same meaning as the original.
 */
function convertBlock(node: RootContent, source: string): { json: JSONContent } | { reason: string } {
  const kind = unsupported(node)
  if (kind) return { reason: kind }
  try {
    const { manager: m } = tiptap()
    const content = m.parse(source).content ?? []
    if (content.length !== 1) return { reason: 'ambiguous' }
    const json = normalize(content[0])
    if (shape(serializeNode(json)) !== shape(source)) return { reason: 'lossy' }
    return { json }
  } catch {
    return { reason: 'unconvertible' }
  }
}

/** Builds the editor document and its source mapping. Never throws: anything doubtful stays raw. */
export function importMarkdown(source: string): MarkdownSession {
  const gen = ++generation
  const blocks = new Map<string, SourceBlock>()
  const order: string[] = []
  const content: JSONContent[] = []
  let children: RootContent[]
  try {
    children = parseMdast(source).children
  } catch {
    children = []
  }
  const spans = children.flatMap((node) => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    return start === undefined || end === undefined ? [] : [{ node, start, end }]
  })
  if (spans.length === 0 && source.trim()) {
    // parse ไม่ได้หรือไม่มีตำแหน่ง: เก็บทั้งเอกสารเป็น raw block เดียว
    spans.push({ node: { type: 'html', value: source }, start: 0, end: source.length })
  }
  spans.forEach(({ node, start, end }, i) => {
    const id = `b${gen}-${i}`
    const text = source.slice(start, end)
    const after = i + 1 < spans.length ? source.slice(end, spans[i + 1].start) : ''
    const converted = convertBlock(node, text)
    const json = 'json' in converted ? converted.json : normalize(rawNode(id, text, converted.reason))
    blocks.set(id, { id, source: text, after, json })
    order.push(id)
    content.push({ ...json, attrs: { ...json.attrs, sourceBlock: id } })
  })
  const leading = spans.length ? source.slice(0, spans[0].start) : ''
  const trailing = spans.length ? source.slice(spans[spans.length - 1].end) : source
  return { doc: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }, blocks, order, leading, trailing }
}

/**
 * Turns the edited document back into Markdown. Untouched blocks keep their exact source and the
 * separators around them; raw blocks always do. Throws `MarkdownConversionError` instead of
 * returning partial or oversized text, so the caller can keep what the person wrote.
 */
export function exportMarkdown(doc: JSONContent, session: MarkdownSession): string {
  const nodes = (doc.content ?? []).filter((n, i, all) => !(all.length === 1 && n.type === 'paragraph' && !n.content?.length))
  const counts = new Map<string, number>()
  for (const n of nodes) {
    const id = n.attrs?.sourceBlock as string | undefined
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const parts: Array<{ text: string; id: string | null }> = []
  try {
    for (const n of nodes) {
      const id = (n.attrs?.sourceBlock as string | undefined) ?? null
      const block = id ? session.blocks.get(id) : undefined
      if (n.type === 'rawMarkdownBlock') {
        parts.push({ text: (n.attrs?.source as string | undefined) ?? '', id: block && counts.get(id!) === 1 ? id : null })
      } else if (block && counts.get(id!) === 1 && sameJson(normalize(n), block.json)) {
        parts.push({ text: block.source, id })
      } else {
        parts.push({ text: serializeNode(normalize(n)), id: null })
      }
    }
  } catch (error) {
    throw new MarkdownConversionError(`The document could not be converted to Markdown (${(error as Error).message}). Your changes are still here; switch to Markdown source to keep editing.`)
  }
  if (parts.length === 0) return ''
  const first = session.order[0]
  const last = session.order[session.order.length - 1]
  let out = parts[0].id === first ? session.leading : ''
  parts.forEach((part, i) => {
    out += part.text
    const next = parts[i + 1]
    if (!next) return
    const a = part.id ? session.order.indexOf(part.id) : -1
    const b = next.id ? session.order.indexOf(next.id) : -1
    // บล็อกเดิมที่ยังติดกันเหมือนเดิม: ใช้ตัวคั่นเดิม (เช่น บรรทัดว่างหลายบรรทัด)
    out += a >= 0 && b === a + 1 ? session.blocks.get(part.id!)!.after : '\n\n'
  })
  out += parts[parts.length - 1].id === last ? session.trailing : '\n'
  if (out.length > MARKDOWN_LIMIT) {
    throw new MarkdownConversionError(`The document would be ${out.length.toLocaleString('en-US')} characters, over the ${MARKDOWN_LIMIT.toLocaleString('en-US')}-character limit. Nothing was cut; shorten it before saving.`)
  }
  return out
}
