import type { LucideIcon } from 'lucide-react'

export type IconSize = 'sm' | 'md' | 'lg'
const PX: Record<IconSize, number> = { sm: 16, md: 20, lg: 24 }

/**
 * The only way Alice UI draws a functional icon. Icons are decorative by default because the control
 * around them carries the name; pass `label` only for a standalone meaningful icon.
 */
export function Icon({ icon: Glyph, size = 'md', label, className }: { icon: LucideIcon; size?: IconSize; label?: string; className?: string }) {
  const px = PX[size]
  return label ? (
    <Glyph width={px} height={px} strokeWidth={1.75} role="img" aria-label={label} className={className} focusable="false" />
  ) : (
    <Glyph width={px} height={px} strokeWidth={1.75} aria-hidden="true" className={className} focusable="false" />
  )
}
