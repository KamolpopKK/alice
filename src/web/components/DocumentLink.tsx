import type { ComponentPropsWithoutRef } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'
import { canonicalDocumentLink } from '../../shared/document-link-url'

/** DOM anchors follow the rendered Markdown; they are not persistent heading identities. */
export function scrollDocumentFragment() {
  if (!window.location.hash) return
  try { document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView({ block: 'start' }) } catch { /* malformed fragments remain ordinary links */ }
}
export function DocumentLink({ href = '', children, onClick, ...props }: ComponentPropsWithoutRef<'a'>) {
  const router = useInRouterContext()
  const internal = canonicalDocumentLink(href)
  if (internal && router) return <Link {...props} to={internal.href} onClick={(event) => {
    onClick?.(event)
    if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && internal.fragment) requestAnimationFrame(scrollDocumentFragment)
  }}>{children}</Link>
  return <a {...props} href={href} target={internal ? undefined : '_blank'} rel={internal ? undefined : 'noopener noreferrer nofollow'} onClick={onClick}>{children}</a>
}
