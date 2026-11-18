import type { HTMLAttributes, ReactNode, TableHTMLAttributes } from 'react'
import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { Icon } from './Icon'
import { IconButton } from './controls'
import { X } from 'lucide-react'

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'agent' | 'brand'

/** Small status or count label. Always text (and optionally an icon), never colour alone. */
export function Badge({ tone = 'neutral', icon, children }: { tone?: Tone; icon?: LucideIcon; children: ReactNode }) {
  return (
    <span className={cx('ui-badge', `ui-badge--${tone}`)}>
      {icon && <Icon icon={icon} size="sm" />}
      {children}
    </span>
  )
}

/** Initials avatar; humans are round, agents are rounded squares so the difference is not colour-only. */
export function Avatar({ name, kind = 'human', size = 'md' }: { name: string; kind?: 'human' | 'agent'; size?: 'sm' | 'md' | 'lg' }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]?.toUpperCase() ?? '')
    .join('')
  return (
    <span className={cx('ui-avatar', `ui-avatar--${kind}`, `ui-avatar--${size}`)} aria-hidden="true" title={name}>
      {initials || '?'}
    </span>
  )
}

export function Card({ children, className, interactive, ...rest }: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div className={cx('ui-card', interactive && 'ui-card--interactive', className)} {...rest}>
      {children}
    </div>
  )
}

/** A page section heading with optional actions on the same row. */
export function SectionHeader({ title, level = 2, actions, description }: { title: ReactNode; level?: 2 | 3; actions?: ReactNode; description?: ReactNode }) {
  const H = level === 2 ? 'h2' : 'h3'
  return (
    <div className="ui-section-header">
      <div>
        <H className={cx('ui-section-title', `ui-section-title--${level}`)}>{title}</H>
        {description && <p className="ui-text-muted">{description}</p>}
      </div>
      {actions && <div className="ui-section-actions">{actions}</div>}
    </div>
  )
}

/** Empty, inline variant (text only). Page-level moments with Alice use the brand's illustrated state. */
export function EmptyState({ title, children, action, icon, headingLevel }: { title: ReactNode; children?: ReactNode; action?: ReactNode; icon?: LucideIcon; headingLevel?: 2 | 3 }) {
  const Title = headingLevel ? (`h${headingLevel}` as const) : 'p'
  return (
    <div className="ui-empty">
      {icon && (
        <span className="ui-empty-icon">
          <Icon icon={icon} size="lg" />
        </span>
      )}
      <Title className="ui-empty-title">{title}</Title>
      {children && <p className="ui-text-muted">{children}</p>}
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  )
}

/** Placeholder while content loads. Pair with a status message for assistive technology. */
export function Skeleton({ lines = 1, width }: { lines?: number; width?: string }) {
  return (
    <span className="ui-skeleton-group" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="ui-skeleton" style={{ width: i === lines - 1 && lines > 1 ? '60%' : width }} />
      ))}
    </span>
  )
}

const BANNER_ICON: Record<'info' | 'success' | 'warning' | 'danger', LucideIcon> = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle }

/**
 * Persistent page-level message (connection lost, not synced, permission). Warnings and errors are
 * announced as alerts; info and success as status.
 */
export function Banner({
  tone = 'info',
  title,
  children,
  action,
  onDismiss,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger'
  title?: ReactNode
  children: ReactNode
  action?: ReactNode
  onDismiss?: () => void
}) {
  return (
    <div className={cx('ui-banner', `ui-banner--${tone}`)} role={tone === 'warning' || tone === 'danger' ? 'alert' : 'status'}>
      <Icon icon={BANNER_ICON[tone]} />
      <div className="ui-banner-body">
        {title && <p className="ui-banner-title">{title}</p>}
        <div>{children}</div>
      </div>
      {action && <div className="ui-banner-action">{action}</div>}
      {onDismiss && <IconButton icon={X} label="Dismiss" size="sm" onClick={onDismiss} />}
    </div>
  )
}

/** Vertical list of rows separated by hairlines. Rows own their own interactive content. */
export function List({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <ul className={cx('ui-list', className)} aria-label={label}>
      {children}
    </ul>
  )
}

export function ListItem({ children, leading, trailing, className }: { children: ReactNode; leading?: ReactNode; trailing?: ReactNode; className?: string }) {
  return (
    <li className={cx('ui-list-item', className)}>
      {leading && <span className="ui-list-leading">{leading}</span>}
      <span className="ui-list-main">{children}</span>
      {trailing && <span className="ui-list-trailing">{trailing}</span>}
    </li>
  )
}

/** Data table that scrolls inside its own region on narrow screens instead of widening the page. */
export function Table({ caption, children, className, ...rest }: TableHTMLAttributes<HTMLTableElement> & { caption: string }) {
  return (
    <div className="ui-table-wrap" role="region" aria-label={caption} tabIndex={0}>
      <table className={cx('ui-table', className)} {...rest}>
        <caption className="ui-visually-hidden">{caption}</caption>
        {children}
      </table>
    </div>
  )
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="ui-visually-hidden">{children}</span>
}
