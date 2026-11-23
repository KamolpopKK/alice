import { Component, Suspense, lazy, useId, useRef, useState, type ReactNode } from 'react'
import { Markdown } from '../components/Markdown'
import { Banner, SegmentedControl, Skeleton } from '../ui'
import type { RichEditorHandle } from './RichDocumentEditor'

// โหลด rich editor เมื่อเปิดฟอร์มเอกสารเท่านั้น
const RichDocumentEditor = lazy(() => import('./RichDocumentEditor'))

class RichEditorBoundary extends Component<{ fallback: ReactNode; onFail: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override componentDidCatch() {
    this.props.onFail()
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

type Mode = 'rich' | 'source'

/**
 * Document body editor: rich text by default, Markdown source on request. Markdown stays the value
 * (`value`/`onChange`), so agents and the CLI see exactly what people write. Blocks the rich editor cannot
 * show safely stay as written and are edited in Markdown. If the rich editor cannot load, the Markdown
 * source stays available.
 */
export function DocumentEditor({ label, value, onChange, rows = 12 }: { label: string; value: string; onChange: (markdown: string) => void; rows?: number }) {
  const id = useId()
  const labelId = `${id}-label`
  const [mode, setMode] = useState<Mode>('rich')
  const [richFailed, setRichFailed] = useState(false)
  const [switchError, setSwitchError] = useState('')
  // เปลี่ยน key เมื่อกลับจาก Markdown เพื่อสร้าง mapping ใหม่จากข้อความล่าสุด
  const [generation, setGeneration] = useState(0)
  const rich = useRef<RichEditorHandle>(null)

  const switchTo = (next: Mode) => {
    if (next === mode) return
    if (next === 'source' && rich.current) {
      const result = rich.current.flush()
      // แปลงไม่ได้: อยู่ในโหมดเดิม เนื้อหาที่เขียนไว้ไม่หาย
      if (!result.ok) return setSwitchError(result.error)
      onChange(result.markdown)
    }
    if (next === 'rich') setGeneration((g) => g + 1)
    setSwitchError('')
    setMode(next)
  }

  const source = (
    <div className="doc-source">
      <textarea id={`${id}-source`} aria-labelledby={labelId} value={value} rows={rows} onChange={(e) => onChange(e.target.value)} spellCheck />
      {value.trim() && (
        <details className="preview">
          <summary>Preview</summary>
          <Markdown source={value} />
        </details>
      )}
    </div>
  )

  return (
    <div className="field doc-body-field">
      <div className="doc-body-head">
        <span id={labelId} className="doc-body-label">
          {label}
        </span>
        {!richFailed && (
          <SegmentedControl
            label="Editor mode"
            value={mode}
            onValueChange={(v) => switchTo(v as Mode)}
            options={[
              { value: 'rich', label: 'Rich text' },
              { value: 'source', label: 'Markdown' },
            ]}
          />
        )}
      </div>
      {switchError && (
        <Banner tone="danger" title="Still in rich text">
          {switchError}
        </Banner>
      )}
      {mode === 'source' || richFailed ? (
        <>
          {richFailed && (
            <Banner tone="warning" title="Rich text editor unavailable">
              The rich text editor could not load. You can keep editing the Markdown source.
            </Banner>
          )}
          {source}
        </>
      ) : (
        <RichEditorBoundary
          fallback={null}
          onFail={() => {
            setRichFailed(true)
            setMode('source')
          }}
        >
          <Suspense fallback={<Skeleton lines={4} />}>
            <RichDocumentEditor key={generation} labelId={labelId} initial={value} onChange={onChange} onEditSource={() => switchTo('source')} handle={rich} />
          </Suspense>
        </RichEditorBoundary>
      )}
    </div>
  )
}
