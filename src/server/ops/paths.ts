const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i

/**
 * Turns a free-form title into a safe, portable file name stem: no path separators, dots-only
 * names, control characters or reserved device names; unicode letters (e.g. Thai) are kept.
 */
export function slugify(title: string, maxLength = 60): string {
  const slug = title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  const cut = [...slug].slice(0, maxLength).join('').replace(/-+$/g, '')
  if (!cut || WINDOWS_RESERVED.test(cut)) return cut ? `${cut}-file` : 'untitled'
  return cut
}

/** `<slug>--<id>.md`: the immutable id makes names collision-free even for identical titles. */
export function exportFileName(title: string, id: string): string {
  const safeId = id.replace(/[^a-z0-9_]/gi, '')
  return `${slugify(title)}--${safeId}.md`
}
