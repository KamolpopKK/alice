/** Canonical links are workspace-relative, never resolved against an external origin. */
export function canonicalDocumentLink(value: string): { documentId: string; fragment: string; href: string } | null {
  const href = value.trim()
  const match = /^\/documents\/(doc_[a-z0-9_]{1,60})(#[^\u0000-\u0020\u007f]*)?$/.exec(href)
  if (!match) return null
  return { documentId: match[1], fragment: match[2] ?? '', href }
}
