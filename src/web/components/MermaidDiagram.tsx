import { useEffect, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import { useTheme } from '../ui/theme'
import { MermaidViewer } from './MermaidViewer'

// Mermaid has global configuration; serialize initialization and rendering across blocks/themes.
let pending: Promise<unknown> = Promise.resolve()
let nextId = 0

type Rendered = { image: string; width: number; height: number }

async function renderDiagram(source: string, dark: boolean): Promise<Rendered> {
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
  let width = 0
  let height = 0
  if (bounds && bounds.length === 4 && bounds[2] > 0 && bounds[3] > 0) {
    ;[width, height] = [bounds[2], bounds[3]]
    root.setAttribute('width', String(width))
    root.setAttribute('height', String(height))
  }
  // SVG in an image cannot execute scripts or load external resources, unlike inline SVG.
  return { image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`, width, height }
}

// บาง diagram ไม่มี viewBox: ใช้ขนาดตั้งต้นที่พอดูได้ แล้วผู้ใช้ซูมเองได้
const naturalSize = (r: Rendered) => (r.width > 0 && r.height > 0 ? { width: r.width, height: r.height } : { width: 800, height: 600 })

export function MermaidDiagram({ source }: { source: string }) {
  const { resolved } = useTheme()
  const [result, setResult] = useState<{ source: string; theme: string; rendered?: Rendered; error?: string }>()
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    let active = true
    const job = pending.then(() => active ? renderDiagram(source, resolved === 'dark') : undefined)
    pending = job.catch(() => {})
    void job.then(
      (rendered) => { if (active) setResult({ source, theme: resolved, rendered }) },
      () => { if (active) setResult({ source, theme: resolved, error: 'Unable to render Mermaid diagram. Check the syntax; external resources are not supported.' }) },
    )
    return () => { active = false }
  }, [source, resolved])
  const current = result?.source === source && result.theme === resolved ? result : undefined
  return (
    <figure className="mermaid-diagram" aria-label="Mermaid diagram" aria-busy={!current}>
      {current?.rendered ? (
        <>
          {/* ทั้งแผนภาพเป็นปุ่มเปิดตัวดูขยาย: คลิกตรงไหนก็ได้ หรือ Tab แล้ว Enter */}
          <button type="button" className="mermaid-diagram-open" onClick={() => setExpanded(true)} aria-haspopup="dialog" aria-label="Expand diagram" title="Expand diagram">
            <img src={current.rendered.image} alt="" />
            <span className="mermaid-diagram-open-hint" aria-hidden="true">
              <Maximize2 size={16} />
            </span>
          </button>
          <MermaidViewer open={expanded} onOpenChange={setExpanded} image={current.rendered.image} size={naturalSize(current.rendered)} />
        </>
      ) : (
        <p role="status">{current?.error ?? 'Rendering diagram…'}</p>
      )}
      <details open={Boolean(current?.error)}>
        <summary>Diagram source</summary>
        <pre><code>{source}</code></pre>
      </details>
    </figure>
  )
}
