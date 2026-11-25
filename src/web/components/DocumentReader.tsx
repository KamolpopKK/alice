import { useEffect, useId, useMemo, useRef, type ReactNode } from 'react'
import { Dialog } from '../ui'
import { Markdown } from './Markdown'
import { scrollScopedFragment, type MarkdownScope } from './markdown-scope'

type ScrollSnapshot = Array<{ element: HTMLElement | null; top: number; left: number }>

/** Where the source page was scrolled, so closing the reader returns the reader to the same place. */
function snapshotScroll(): ScrollSnapshot {
  const main = document.getElementById('main')
  return [
    { element: null, top: window.scrollY, left: window.scrollX },
    ...(main ? [{ element: main, top: main.scrollTop, left: main.scrollLeft }] : []),
  ]
}

function restoreScroll(snapshot: ScrollSnapshot) {
  for (const { element, top, left } of snapshot) {
    if (!element) window.scrollTo(left, top)
    else if (element.isConnected) element.scrollTo(left, top)
  }
}

/**
 * Read-only focus reader shared by saved Documents, authoring drafts and expanded previews. It shows
 * the Markdown it is given in a near-full-window dialog over the source page, which stays mounted and
 * inert underneath. Opening or closing it never saves, never changes the route and keeps no
 * preference; closing returns focus and scroll to where the person was.
 */
export function DocumentReader({
  open,
  onOpenChange,
  title,
  description,
  body,
  documentId,
  initialFragment,
  notice,
  returnFocusFallback,
  onNavigate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** What this content is (saved revision or unsaved draft), shown under the title. */
  description: ReactNode
  /** Markdown to show; `null` while it is loading or must not be shown (status comes from `notice`). */
  body: string | null
  documentId?: string
  /** Canonical heading fragment (`#slug`) to start reading at. */
  initialFragment?: string
  /** Status banners shown above the content. */
  notice?: ReactNode
  returnFocusFallback?: () => HTMLElement | null
  /** A link inside is leaving for another page. Defaults to closing the reader. */
  onNavigate?: () => void
}) {
  const rawId = useId()
  const namespace = `reader-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`
  const root = useRef<HTMLElement | null>(null)
  const saved = useRef<ScrollSnapshot | null>(null)
  const change = useRef(onOpenChange)
  change.current = onOpenChange
  const leave = useRef(onNavigate)
  leave.current = onNavigate
  const scope = useMemo<MarkdownScope>(
    () => ({ namespace, documentId, root: () => root.current, onNavigate: () => (leave.current ? leave.current() : change.current(false)) }),
    [namespace, documentId],
  )

  useEffect(() => {
    if (open) {
      saved.current = snapshotScroll()
      return undefined
    }
    const snapshot = saved.current
    saved.current = null
    if (!snapshot) return undefined
    // รอให้ Dialog คืน focus เสร็จก่อน แล้วค่อยคืนตำแหน่ง scroll ของหน้าต้นทาง
    const frame = requestAnimationFrame(() => restoreScroll(snapshot))
    return () => cancelAnimationFrame(frame)
  }, [open])

  // เริ่มอ่านที่หัวข้อจาก fragment เมื่อเนื้อหาพร้อมแล้ว (เนื้อหาจาก server อาจมาทีหลัง)
  const ready = open && body !== null
  useEffect(() => {
    if (!ready || !initialFragment) return undefined
    const frame = requestAnimationFrame(() => scrollScopedFragment(scope, initialFragment))
    return () => cancelAnimationFrame(frame)
  }, [ready, initialFragment, scope])

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description} size="viewport" className="document-reader" returnFocusFallback={returnFocusFallback}>
      <article ref={root} className="document-reader-content" aria-label={`${title} content`}>
        {notice}
        {body === null ? null : body.trim() ? <Markdown source={body} className="document-reader-body" scope={scope} /> : <p className="ui-text-muted">This document has no content.</p>}
      </article>
    </Dialog>
  )
}
