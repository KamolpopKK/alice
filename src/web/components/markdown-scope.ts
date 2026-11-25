import { createContext, useContext } from 'react'

/**
 * A Markdown instance shown next to another copy of the same document (the focus reader over the
 * Document page). Its heading IDs carry a namespace so the DOM has no duplicate IDs, and fragment
 * links to the same document scroll inside `root` instead of the page behind it. Canonical slugs and
 * document URLs are unchanged.
 */
export type MarkdownScope = {
  namespace: string
  /** The document this content belongs to, when it is a saved document or a draft of one. */
  documentId?: string
  root: () => HTMLElement | null
  /** A link is leaving for another page: the scoped view should close. */
  onNavigate?: () => void
}

export const MarkdownScopeContext = createContext<MarkdownScope | null>(null)

export const useMarkdownScope = () => useContext(MarkdownScopeContext)

export const scopedAnchorId = (namespace: string, slug: string) => `${namespace}--${slug}`

function decodeFragment(fragment: string) {
  try {
    return decodeURIComponent(fragment.replace(/^#/, ''))
  } catch {
    return null
  }
}

/** Scrolls the scoped root (never the background) to a canonical heading fragment. */
export function scrollScopedFragment(scope: MarkdownScope, fragment: string): boolean {
  const slug = decodeFragment(fragment)
  const root = scope.root()
  if (!slug || !root) return false
  const target = root.querySelector<HTMLElement>(`[id="${CSS.escape(scopedAnchorId(scope.namespace, slug))}"]`)
  if (!target) return false
  target.scrollIntoView({ block: 'start' })
  return true
}
