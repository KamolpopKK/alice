import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MermaidDiagram } from './MermaidDiagram'

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
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer nofollow" />,
  // GFM task-list inputs are read-only, but still need an accessible name.
  input: ({ node: _node, type, ...props }) => <input {...props} type={type} aria-label={type === 'checkbox' ? 'Task list item' : undefined} />,
}

// react-markdown ไม่ render raw HTML และกรอง URL อันตราย (javascript: ฯลฯ) ตั้งแต่ต้น
export function Markdown({ source, className = '' }: { source: string; className?: string }) {
  if (!source.trim()) return <p className="muted">No description.</p>
  return (
    <div className={`markdown ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
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
