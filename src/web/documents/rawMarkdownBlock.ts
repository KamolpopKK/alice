import { Extension, Node, mergeAttributes } from '@tiptap/core'

/**
 * A block of Markdown the rich editor cannot represent safely (raw HTML, comments, reference
 * definitions, footnotes, images, or a list/table/quote that contains any of them). It keeps its
 * original source untouched and shows it as plain text: it is never turned into live DOM, and the
 * toolbar cannot change it. People edit it in Markdown source mode.
 */
export const RawMarkdownBlock = Node.create({
  name: 'rawMarkdownBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      source: { default: '', rendered: false },
      reason: { default: '', rendered: false },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-raw-markdown]', getAttrs: (el) => ({ source: (el as HTMLElement).textContent ?? '' }) }]
  },
  renderHTML({ node, HTMLAttributes }) {
    // แสดงเป็นข้อความล้วนใน <pre> เท่านั้น: HTML ใน source จะไม่ถูกตีความ
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-raw-markdown': '', class: 'doc-raw-block', title: 'Edit this block in Markdown source' }),
      ['pre', {}, node.attrs.source as string],
    ]
  },
  renderText({ node }) {
    return node.attrs.source as string
  },
  renderMarkdown: (node) => (node.attrs?.source as string | undefined) ?? '',
})

/** Top-level node types that can carry the id of the source block they came from. */
export const SOURCE_BLOCK_TYPES = ['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock', 'horizontalRule', 'table', 'rawMarkdownBlock']

/**
 * Remembers which source block a top-level node came from. Never rendered and not kept when a block
 * is split, so only an untouched block can match its original and reuse its exact source.
 */
export const SourceBlockId = Extension.create({
  name: 'sourceBlockId',
  addGlobalAttributes() {
    return [{ types: SOURCE_BLOCK_TYPES, attributes: { sourceBlock: { default: null, rendered: false, keepOnSplit: false } } }]
  },
})
