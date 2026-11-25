import * as RDialog from '@radix-ui/react-dialog'
import * as RMenu from '@radix-ui/react-dropdown-menu'
import * as RPopover from '@radix-ui/react-popover'
import * as RTooltip from '@radix-ui/react-tooltip'
import { X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { Button, IconButton } from './controls'
import { Icon } from './Icon'

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

/* ---------- Tooltip ---------- */

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={400} skipDelayDuration={200}>
      {children}
    </RTooltip.Provider>
  )
}

/**
 * Supplementary hint on hover and keyboard focus. Never the only place for essential information,
 * and never the accessible name of an icon button (that is `label`).
 */
export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactElement; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={6} className="ui-tooltip">
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  )
}

/* ---------- Menu ---------- */

export type MenuItem =
  | {
      kind?: 'item'
      label: string
      icon?: LucideIcon
      onSelect: () => void
      destructive?: boolean
      disabled?: boolean
      shortcut?: string
      /** The item takes the person somewhere else: leave focus where the new view puts it. */
      navigates?: boolean
    }
  | { kind: 'separator' }
  | { kind: 'label'; label: string }

/** Action menu with arrow-key navigation, typeahead, Escape, and focus back on the trigger. */
/** Named by its trigger (Radix sets aria-labelledby), so give the trigger a specific name. */
export function Menu({ trigger, items, align = 'end' }: { trigger: ReactElement; items: MenuItem[]; align?: 'start' | 'end' }) {
  const navigated = useRef(false)
  return (
    <RMenu.Root>
      <RMenu.Trigger asChild>{trigger}</RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content
          className="ui-menu"
          align={align}
          sideOffset={4}
          collisionPadding={8}
          onCloseAutoFocus={(e) => {
            if (!navigated.current) return
            navigated.current = false
            e.preventDefault()
          }}
        >
          {items.map((item, i) =>
            item.kind === 'separator' ? (
              <RMenu.Separator key={i} className="ui-menu-separator" />
            ) : item.kind === 'label' ? (
              <RMenu.Label key={i} className="ui-menu-label">
                {item.label}
              </RMenu.Label>
            ) : (
              <RMenu.Item
                key={i}
                className={cx('ui-menu-item', item.destructive && 'is-destructive')}
                disabled={item.disabled}
                onSelect={() => {
                  navigated.current = item.navigates === true
                  item.onSelect()
                }}
              >
                {item.icon && <Icon icon={item.icon} size="sm" />}
                <span className="ui-menu-item-label">{item.label}</span>
                {item.shortcut && <kbd className="ui-kbd">{item.shortcut}</kbd>}
              </RMenu.Item>
            ),
          )}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  )
}

/* ---------- Popover ---------- */

export function Popover({
  trigger,
  children,
  label,
  open,
  onOpenChange,
  align = 'start',
}: {
  trigger: ReactElement
  children: ReactNode
  label: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: 'start' | 'center' | 'end'
}) {
  return (
    <RPopover.Root open={open} onOpenChange={onOpenChange}>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content className="ui-popover" align={align} sideOffset={6} aria-label={label} collisionPadding={8}>
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  )
}

/* ---------- Dialog and Sheet ---------- */

type DialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** Footer actions, primary last. */
  actions?: ReactNode
  /** Optional trigger; without it, focus returns to whatever opened the dialog. */
  trigger?: ReactElement
  /** `viewport` fills nearly the whole window with a fixed header and a body that scrolls on its own. */
  size?: 'sm' | 'md' | 'lg' | 'viewport'
  /** Extra class on the dialog surface, for content that needs its own layout. */
  className?: string
  /** Where focus goes on close when the element that opened the dialog is no longer on the page. */
  returnFocusFallback?: () => HTMLElement | null
}

/** Remembers what had focus when an overlay opened, so closing it can put focus back there. */
function useReturnFocus(open: boolean, fallback?: () => HTMLElement | null) {
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (open && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) opener.current = document.activeElement
  }, [open])
  return (e: Event) => {
    const target = opener.current?.isConnected ? opener.current : fallback?.()
    if (target?.isConnected) {
      e.preventDefault()
      // ไม่ให้การคืน focus เลื่อนหน้าต้นทางไปจากตำแหน่งที่อ่านค้างไว้
      target.focus({ preventScroll: true })
    }
  }
}

/** Opens on the element marked `data-autofocus` (the safer choice, such as Cancel) when there is one. */
function focusPreferred(e: Event) {
  const preferred = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[data-autofocus]')
  if (preferred) {
    e.preventDefault()
    preferred.focus()
  }
}

/** Modal dialog: traps focus, closes on Escape, and returns focus to whatever opened it. */
export function Dialog({ open, onOpenChange, title, description, children, actions, trigger, size = 'md', className, returnFocusFallback }: DialogProps) {
  const onCloseAutoFocus = useReturnFocus(open, returnFocusFallback)
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RDialog.Trigger asChild>{trigger}</RDialog.Trigger>}
      <RDialog.Portal>
        <RDialog.Overlay className="ui-overlay" />
        <RDialog.Content className={cx('ui-dialog', `ui-dialog--${size}`, className)} onOpenAutoFocus={focusPreferred} onCloseAutoFocus={trigger ? undefined : onCloseAutoFocus}>
          <div className="ui-dialog-head">
            <RDialog.Title className="ui-dialog-title">{title}</RDialog.Title>
            <RDialog.Close asChild>
              <IconButton icon={X} label="Close" size="sm" />
            </RDialog.Close>
          </div>
          {description ? <RDialog.Description className="ui-dialog-description">{description}</RDialog.Description> : <RDialog.Description className="ui-visually-hidden">{title}</RDialog.Description>}
          {children && <div className="ui-dialog-body">{children}</div>}
          {actions && <div className="ui-dialog-actions">{actions}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

/**
 * Edge-anchored modal panel: right side on wide screens, bottom sheet on narrow ones. Used for
 * mobile navigation and full-height detail views.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  side = 'right',
  hideTitle,
  size = 'md',
  onCloseAutoFocus: custom,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  children: ReactNode
  side?: 'left' | 'right' | 'bottom'
  hideTitle?: boolean
  /** `lg` suits detail views: wider on large screens and the full width of a phone. */
  size?: 'md' | 'lg'
  /** Runs first; call preventDefault() to place focus yourself (for example after navigating). */
  onCloseAutoFocus?: (e: Event) => void
}) {
  const returnFocus = useReturnFocus(open)
  const onCloseAutoFocus = (e: Event) => {
    custom?.(e)
    if (!e.defaultPrevented) returnFocus(e)
  }
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="ui-overlay" />
        <RDialog.Content className={cx('ui-sheet', `ui-sheet--${side}`, size === 'lg' && 'ui-sheet--lg')} onCloseAutoFocus={onCloseAutoFocus}>
          <div className={cx('ui-dialog-head', hideTitle && 'ui-sheet-head--compact')}>
            <RDialog.Title className={cx('ui-dialog-title', hideTitle && 'ui-visually-hidden')}>{title}</RDialog.Title>
            <RDialog.Close asChild>
              <IconButton icon={X} label="Close" size="sm" />
            </RDialog.Close>
          </div>
          <RDialog.Description className="ui-visually-hidden">{title}</RDialog.Description>
          <div className="ui-sheet-body">{children}</div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

/** Confirmation in direct, non-character language. Destructive confirmations name what is lost. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive,
  busy,
  onConfirm,
  error,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void
  /** Why the last attempt failed, shown above the actions. */
  error?: ReactNode
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="sm"
      actions={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} data-autofocus={destructive || undefined}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {error}
    </Dialog>
  )
}
