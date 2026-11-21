import { useEffect, useState } from 'react'
import { useTheme } from '../ui/theme'

// Mermaid has global configuration; serialize initialization and rendering across blocks/themes.
let pending: Promise<unknown> = Promise.resolve()
let nextId = 0

async function renderDiagram(source: string, dark: boolean): Promise<string> {
  const { default: mermaid } = await import('mermaid')
  // Diagrams are self-contained. Do not let source styles or image nodes fetch remote resources.
  const decoded = source.replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\/\*[\s\S]*?\*\//g, '')
  if (/url\s*\(|@import|\bimg\s*:/i.test(decoded)) throw new Error('External resources are not supported in diagrams.')
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    htmlLabels: false,
    look: 'classic',
    theme: dark ? 'dark' : 'default',
    // Lock configuration against both front matter and init directives in user content.
    secure: ['secure', ...Object.keys(mermaid.mermaidAPI.getConfig())],
  })
  const { svg } = await mermaid.render(`alice-mermaid-${++nextId}`, source)
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
  const bounds = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
  if (bounds && bounds.length === 4 && bounds[2] > 0 && bounds[3] > 0) {
    root.setAttribute('width', String(bounds[2]))
    root.setAttribute('height', String(bounds[3]))
  }
  // SVG in an image cannot execute scripts or load external resources, unlike inline SVG.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`
}

export function MermaidDiagram({ source }: { source: string }) {
  const { resolved } = useTheme()
  const [result, setResult] = useState<{ source: string; theme: string; image?: string; error?: string }>()
  useEffect(() => {
    let active = true
    const job = pending.then(() => active ? renderDiagram(source, resolved === 'dark') : undefined)
    pending = job.catch(() => {})
    void job.then(
      (image) => { if (active) setResult({ source, theme: resolved, image }) },
      () => { if (active) setResult({ source, theme: resolved, error: 'Unable to render Mermaid diagram. Check the syntax; external resources are not supported.' }) },
    )
    return () => { active = false }
  }, [source, resolved])
  const current = result?.source === source && result.theme === resolved ? result : undefined
  return (
    <figure className="mermaid-diagram" aria-label="Mermaid diagram" aria-busy={!current}>
      {current?.image ? <img src={current.image} alt="Mermaid diagram" /> : <p role="status">{current?.error ?? 'Rendering diagram…'}</p>}
      <details open={Boolean(current?.error)}>
        <summary>Diagram source</summary>
        <pre><code>{source}</code></pre>
      </details>
    </figure>
  )
}
