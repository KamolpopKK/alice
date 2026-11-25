import { useEffect, useMemo } from 'react'
import type { Nodes, Root } from 'mdast'
import { DocumentLink, scrollDocumentFragment } from './DocumentLink'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MermaidDiagram } from './MermaidDiagram'
import { MarkdownScopeContext, scopedAnchorId, type MarkdownScope } from './markdown-scope'

// Stable component identities keep diagrams mounted when surrounding content updates.
const components: Components = {
  pre: ({ node, children, ...props }) => {
    const code = node?.children[0]
    if (code?.type === 'element' && code.tagName === 'code' &&
      Array.isArray(code.properties.className) && code.properties.className.includes('language-mermaid')) {
      const source = code.children.map((child) => child.type === 'text' ? child.value : '').join('').replace(/\n$/, '')
      return <MermaidDiagram source={source} />
    }
    return <pre {...props}>{children}</pre>
  },
  a: ({ node: _node, ...props }) => <DocumentLink {...props} />,
  // GFM task-list inputs are read-only, but still need an accessible name.
  input: ({ node: _node, type, ...props }) => <input {...props} type={type} aria-label={type === 'checkbox' ? 'Task list item' : undefined} />,
}

// react-markdown ไม่ render raw HTML และกรอง URL อันตราย (javascript: ฯลฯ) ตั้งแต่ต้น
// slug เดิมเป็น canonical; instance ที่มี namespace เติม prefix ใน DOM เท่านั้น
function headingAnchors(namespace?: string) {
  return () => (tree: Root) => {
    const used = new Set<string>()
    const text = (node: Nodes): string => 'value' in node ? node.value : 'children' in node ? node.children.map(text).join('') : 'alt' in node ? node.alt ?? '' : ''
    const visit = (node: Nodes) => {
      if (node.type === 'heading') {
        const base = text(node).toLowerCase().trim().replace(/[^\p{L}\p{M}\p{N}_ -]/gu, '').replace(/ +/g, '-') || 'section'
        let id = base
        let count = 0
        while (used.has(id)) id = `${base}-${++count}`
        used.add(id)
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: namespace ? scopedAnchorId(namespace, id) : id } }
      }
      if ('children' in node) node.children.forEach(visit)
    }
    visit(tree)
  }
}
const plugins = [remarkGfm, headingAnchors()]

/**
 * Renders Markdown safely. With `scope`, heading IDs are namespaced for this instance and same-document
 * fragment links stay inside the scope's root; the page URL fragment is left to the unscoped page copy.
 */
export function Markdown({ source, className = '', scope }: { source: string; className?: string; scope?: MarkdownScope }) {
  const namespace = scope?.namespace
  const scoped = useMemo(() => (namespace ? [remarkGfm, headingAnchors(namespace)] : plugins), [namespace])
  useEffect(() => {
    if (!namespace) scrollDocumentFragment()
  }, [source, namespace])
  if (!source.trim()) return <p className="muted">No description.</p>
  const body = (
    <div className={`markdown ${className}`}>
      <ReactMarkdown
        remarkPlugins={scoped}
        skipHtml
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
  return scope ? <MarkdownScopeContext.Provider value={scope}>{body}</MarkdownScopeContext.Provider> : body
}

/** Markdown textarea with a write/preview toggle (no rich-text editing). */
export function MarkdownEditor({
  label,
  value,
  onChange,
  rows = 8,
  id,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  rows?: number
  id: string
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} value={value} rows={rows} onChange={(e) => onChange(e.target.value)} />
      {value.trim() && (
        <details className="preview">
          <summary>Preview</summary>
          <Markdown source={value} />
        </details>
      )}
    </div>
  )
}
