import * as RTabs from '@radix-ui/react-tabs'
import type { LucideIcon } from 'lucide-react'
import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Icon } from './Icon'

export type TabItem = { value: string; label: string; icon?: LucideIcon; content: ReactNode; count?: number }

/** Tabs with roving focus (arrow keys) and panels linked to their tabs. */
export function Tabs({ label, items, value, onValueChange, defaultValue }: { label: string; items: TabItem[]; value?: string; onValueChange?: (v: string) => void; defaultValue?: string }) {
  return (
    <RTabs.Root className="ui-tabs" value={value} onValueChange={onValueChange} defaultValue={defaultValue ?? items[0]?.value}>
      <RTabs.List className="ui-tabs-list" aria-label={label}>
        {items.map((t) => (
          <RTabs.Trigger key={t.value} value={t.value} className="ui-tab">
            {t.icon && <Icon icon={t.icon} size="sm" />}
            <span>{t.label}</span>
            {t.count !== undefined && <span className="ui-tab-count">{t.count}</span>}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {items.map((t) => (
        <RTabs.Content key={t.value} value={t.value} className="ui-tab-panel">
          {t.content}
        </RTabs.Content>
      ))}
    </RTabs.Root>
  )
}

export type SegmentOption = { value: string; label: string; icon?: LucideIcon; hideLabel?: boolean }

/**
 * Exactly one of a few views or modes (Board / List, Light / Dark / System). Behaves like a radio
 * group: one Tab stop, arrow keys move and select, Home/End jump; it never ends up with no selection.
 */
export function SegmentedControl({ label, value, onValueChange, options }: { label: string; value: string; onValueChange: (v: string) => void; options: SegmentOption[] }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const current = Math.max(0, options.findIndex((o) => o.value === value))
  const select = (index: number) => {
    const i = (index + options.length) % options.length
    onValueChange(options[i].value)
    refs.current[i]?.focus()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    if (step) select(current + step)
    else if (e.key === 'Home') select(0)
    else if (e.key === 'End') select(options.length - 1)
    else return
    e.preventDefault()
  }
  return (
    <div role="radiogroup" aria-label={label} className="ui-segmented" onKeyDown={onKeyDown}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={i === current}
          aria-label={o.hideLabel ? o.label : undefined}
          tabIndex={i === current ? 0 : -1}
          className="ui-segment"
          data-state={i === current ? 'on' : 'off'}
          onClick={() => onValueChange(o.value)}
        >
          {o.icon && <Icon icon={o.icon} size="sm" />}
          {!o.hideLabel && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  )
}
