import { useEffect, useId, useRef, useState } from 'react'

type CopyState = 'idle' | 'copied' | 'failed'

/**
 * Preformatted text with a Copy button. The text stays selectable, so a denied clipboard falls back
 * to manual selection; the outcome is announced through a polite live region.
 */
export function CodeBlock({ code, label, primary = false }: { code: string; label: string; primary?: boolean }) {
  const [state, setState] = useState<CopyState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const preId = useId()
  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async () => {
    clearTimeout(timer.current)
    let outcome: CopyState = 'copied'
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(code)
    } catch {
      outcome = 'failed'
    }
    setState(outcome)
    // ข้อความ fallback ค้างไว้นานกว่าเพื่อให้มีเวลาอ่าน
    timer.current = setTimeout(() => setState('idle'), outcome === 'failed' ? 6000 : 2000)
  }

  return (
    <div className={`codeblock${primary ? ' codeblock-primary' : ''}`}>
      <div className="codeblock-bar">
        <span className="codeblock-label">{label}</span>
        <button type="button" className={primary ? 'primary' : undefined} aria-controls={preId} onClick={() => void copy()}>
          {state === 'copied' ? 'Copied' : `Copy${primary ? ' prompt' : ''}`}
        </button>
      </div>
      <pre id={preId} tabIndex={0} aria-label={label}>
        <code>{code}</code>
      </pre>
      <p className="codeblock-status" role="status" aria-live="polite">
        {state === 'copied' ? 'Copied to clipboard.' : state === 'failed' ? 'Copy failed — select the text manually.' : ''}
      </p>
    </div>
  )
}
