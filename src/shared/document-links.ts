import type { Nodes, Root } from 'mdast'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { canonicalDocumentLink } from './document-link-url'

export { canonicalDocumentLink } from './document-link-url'
export const DOCUMENT_LINK_PARSER_VERSION = 1

/** Offsets use the same UTF-16 units as JS strings and existing document windows. */
export interface DocumentHeading {
  text: string
  level: number
  offset: number
  headingEndOffset: number
  endOffset: number
}

const processor = unified().use(remarkParse).use(remarkGfm)
const referenceKey = (s: string) => s.trim().replace(/\s+/g, ' ').toUpperCase()

function walk(node: Nodes, visitor: (node: Nodes) => void) {
  visitor(node)
  if ('children' in node) for (const child of node.children) walk(child, visitor)
}

function headingText(node: Nodes): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value
  if (node.type === 'image' || node.type === 'imageReference') return node.alt ?? ''
  if (node.type === 'break') return ' '
  return 'children' in node ? node.children.map(headingText).join('') : ''
}

/** Pure, bounded by the caller's existing Markdown limit; no URL or file is fetched. */
export function parseDocumentMarkdown(body: string, sourceDocumentId?: string): { targets: string[]; outline: DocumentHeading[] } {
  const root: Root = processor.parse(body)
  const definitions = new Map<string, string>()
  walk(root, (node) => {
    if (node.type === 'definition') {
      const key = referenceKey(node.identifier)
      if (!definitions.has(key)) definitions.set(key, node.url)
    }
  })
  const targets = new Set<string>()
  const outline: DocumentHeading[] = []
  const open: DocumentHeading[] = []
  walk(root, (node) => {
    const url = node.type === 'link' ? node.url : node.type === 'linkReference' ? definitions.get(referenceKey(node.identifier)) : undefined
    if (url) {
      const link = canonicalDocumentLink(url)
      if (link && link.documentId !== sourceDocumentId) targets.add(link.documentId)
    }
    if (node.type === 'heading' && node.position?.start.offset !== undefined && node.position.end.offset !== undefined) {
      const heading: DocumentHeading = { text: headingText(node), level: node.depth, offset: node.position.start.offset,
        headingEndOffset: node.position.end.offset, endOffset: body.length }
      // Close sections at the next heading of equal or higher level in one pass.
      while (open.length && open.at(-1)!.level >= heading.level) open.pop()!.endOffset = heading.offset
      open.push(heading)
      outline.push(heading)
    }
  })
  return { targets: [...targets], outline }
}
