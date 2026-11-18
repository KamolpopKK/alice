import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

/**
 * One project, document or search result: icon, title (usually a link), a short excerpt and metadata.
 * Use inside `ResourceList`; `layout="grid"` gives cards, `layout="list"` hairline-separated rows.
 */
export function ResourceItem({ icon, title, text, meta, className }: { icon: LucideIcon; title: ReactNode; text?: ReactNode; meta?: ReactNode; className?: string }) {
  return (
    <li className={cx('ui-resource', className)}>
      <span className="ui-resource-icon">
        <Icon icon={icon} />
      </span>
      <div className="ui-resource-body">
        <div className="ui-resource-title">{title}</div>
        {text && <p className="ui-resource-text">{text}</p>}
        {meta && <div className="ui-resource-meta">{meta}</div>}
      </div>
    </li>
  )
}

export function ResourceList({ label, layout = 'grid', ordered, children, className }: { label: string; layout?: 'grid' | 'list'; ordered?: boolean; children: ReactNode; className?: string }) {
  const List = ordered ? 'ol' : 'ul'
  return (
    <List className={cx('ui-resources', `ui-resources--${layout}`, className)} aria-label={label}>
      {children}
    </List>
  )
}
