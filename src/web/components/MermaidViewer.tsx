import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react'
import { Button, Dialog, IconButton } from '../ui'
import { fitScale, scrollAfterZoom, zoomBounds, zoomIn, zoomOut, zoomPercent, type Size } from './mermaid-viewer-geometry'
import './MermaidViewer.css'

/**
 * Expanded view of a diagram that already rendered. It shows the same image (an SVG data URL, so no
 * script or external resource can run) at a chosen size: zooming only changes the image's displayed
 * size and never asks Mermaid to render again. Panning uses the viewport's own scrollbars, keyboard
 * and touch scrolling.
 */
export function MermaidViewer({ open, onOpenChange, image, size }: { open: boolean; onOpenChange: (open: boolean) => void; image: string; size: Size }) {
  const viewport = useRef<HTMLDivElement | null>(null)
  // Dialog mount เนื้อหาหลัง commit แรก: รู้ตัวเมื่อ element พร้อมด้วย callback ref
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const attach = useCallback((node: HTMLDivElement | null) => {
    viewport.current = node
    setElement(node)
  }, [])
  const [mode, setModeState] = useState<'fit' | 'manual'>('fit')
  const modeRef = useRef(mode)
  const setMode = (next: 'fit' | 'manual') => {
    modeRef.current = next
    setModeState(next)
  }
  const [scale, setScale] = useState(1)
  const [fit, setFit] = useState(1)
  // ตำแหน่ง scroll ที่ต้องตั้งหลัง render ขนาดใหม่ เพื่อให้จุดกลางเดิมอยู่กลางจอ
  const pending = useRef<{ left: number; top: number } | null>(null)

  const measure = useCallback((): Size | null => {
    const el = viewport.current
    return el ? { width: el.clientWidth, height: el.clientHeight } : null
  }, [])

  // เปิดครั้งแรกใช้ Fit (วัดก่อน paint จึงไม่เห็นภาพ 100% แวบหนึ่ง); ปรับขนาดหน้าต่างขณะอยู่โหมด Fit
  // จะคำนวณใหม่ ส่วนซูมเองจะไม่ถูก reset
  useLayoutEffect(() => {
    if (!open) {
      modeRef.current = 'fit'
      setModeState('fit')
      return undefined
    }
    const el = element
    if (!el) return undefined
    const update = () => {
      const box = measure()
      if (!box) return
      const next = fitScale(size, box)
      setFit(next)
      if (modeRef.current === 'fit') setScale(next)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [open, element, size, measure])

  useLayoutEffect(() => {
    const el = viewport.current
    if (el && pending.current) {
      el.scrollTo(pending.current.left, pending.current.top)
      pending.current = null
    }
  }, [scale])

  const applyZoom = (next: number) => {
    const el = viewport.current
    const box = measure()
    if (el && box && next !== scale) pending.current = scrollAfterZoom({ left: el.scrollLeft, top: el.scrollTop }, box, scale, next)
    setMode('manual')
    setScale(next)
  }
  const toFit = () => {
    const box = measure()
    const next = box ? fitScale(size, box) : fit
    setFit(next)
    setMode('fit')
    pending.current = { left: 0, top: 0 }
    setScale(next)
  }
  const { min, max } = zoomBounds(fit)

  // ปุ่มลัดทำงานเฉพาะเมื่อ focus อยู่ใน viewer เท่านั้น ไม่ดักทั้งแอป
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === '+' || event.key === '=') applyZoom(zoomIn(scale, fit))
    else if (event.key === '-' || event.key === '_') applyZoom(zoomOut(scale, fit))
    else if (event.key === '0') toFit()
    else return
    event.preventDefault()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Diagram" description="Zoom with the buttons or + and −, 0 fits the whole diagram. Scroll to move around." size="viewport" className="mermaid-viewer">
      <div className="mermaid-viewer-frame" onKeyDown={onKeyDown}>
        <div className="mermaid-viewer-toolbar" role="toolbar" aria-label="Diagram zoom">
          <IconButton icon={ZoomOut} label="Zoom out" size="sm" variant="secondary" onClick={() => applyZoom(zoomOut(scale, fit))} disabled={scale <= min} />
          <output className="mermaid-viewer-zoom" aria-live="polite" aria-label="Zoom level">
            {zoomPercent(scale)}
          </output>
          <IconButton icon={ZoomIn} label="Zoom in" size="sm" variant="secondary" onClick={() => applyZoom(zoomIn(scale, fit))} disabled={scale >= max} />
          <Button size="sm" icon={Maximize} aria-pressed={mode === 'fit'} onClick={toFit}>
            Fit to view
          </Button>
        </div>
        <div ref={attach} className="mermaid-viewer-viewport" role="region" aria-label="Diagram, scroll to move around" tabIndex={0} data-zoom-mode={mode}>
          <div className="mermaid-viewer-canvas">
            <img src={image} alt="Mermaid diagram" width={Math.round(size.width * scale)} height={Math.round(size.height * scale)} draggable={false} />
          </div>
        </div>
      </div>
    </Dialog>
  )
}
