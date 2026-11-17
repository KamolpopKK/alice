import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// react-markdown ไม่ render raw HTML และกรอง URL อันตราย (javascript: ฯลฯ) ตั้งแต่ต้น
export function Markdown({ source, className = '' }: { source: string; className?: string }) {
  if (!source.trim()) return <p className="muted">No description.</p>
  return (
    <div className={`markdown ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer nofollow" /> }}
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
