import { DocumentPreview } from './DocumentPreview'
import { Children } from 'react'
import type { ComponentPropsWithoutRef, MouseEvent } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'
import { canonicalDocumentLink } from '../../shared/document-link-url'
import { scrollScopedFragment, useMarkdownScope } from './markdown-scope'

/** DOM anchors follow the rendered Markdown; they are not persistent heading identities. */
export function scrollDocumentFragment() {
  if (!window.location.hash) return
  try { document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView({ block: 'start' }) } catch { /* malformed fragments remain ordinary links */ }
}

const plainClick = (event: MouseEvent) => !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey

export function DocumentLink({ href = '', children, onClick, ...props }: ComponentPropsWithoutRef<'a'>) {
  const router = useInRouterContext()
  const scope = useMarkdownScope()
  const internal = canonicalDocumentLink(href)
  const label = Children.toArray(children).filter((n) => typeof n === 'string' || typeof n === 'number').join('') || props.title || 'linked document'
  if (internal && router) return <span className="document-link"><Link {...props} to={internal.href} onClick={(event) => {
    onClick?.(event)
    if (!plainClick(event)) return
    if (scope) {
      // หัวข้อในฉบับเดียวกัน: เลื่อนภายใน reader ไม่เปลี่ยน URL และไม่เลื่อนหน้าด้านหลัง
      if (internal.documentId === scope.documentId && internal.fragment && scrollScopedFragment(scope, internal.fragment)) {
        event.preventDefault()
        return
      }
      // ออกไปหน้าอื่น: ปิด reader แล้วให้ router (และ leave guard เดิม) จัดการตามปกติ
      scope.onNavigate?.()
      if (internal.fragment) requestAnimationFrame(scrollDocumentFragment)
      return
    }
    if (internal.fragment) requestAnimationFrame(scrollDocumentFragment)
  }}>{children}</Link><DocumentPreview documentId={internal.documentId} href={internal.href} label={label} /></span>
  return <a {...props} href={href} target={internal ? undefined : '_blank'} rel={internal ? undefined : 'noopener noreferrer nofollow'} onClick={onClick}>{children}</a>
}
