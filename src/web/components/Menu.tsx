import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
}

/**
 * Menu button following the WAI-ARIA menu pattern: Enter/Space/ArrowDown opens and focuses the first
 * item, arrows move, Home/End jump, Escape or Tab closes and focus returns to the button.
 */
export function MenuButton({
  label,
  items,
  children,
  className,
  open: controlledOpen,
  onOpenChange,
  buttonProps,
}: {
  label: string
  items: MenuItem[]
  children?: ReactNode
  className?: string
  /** Controlled mode (e.g. a keyboard shortcut opens the menu). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  buttonProps?: ButtonHTMLAttributes<HTMLButtonElement>
}) {
  const [innerOpen, setInnerOpen] = useState(false)
  const open = controlledOpen ?? innerOpen
  const setOpen = (next: boolean | ((o: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open) : next
    setInnerOpen(value)
    onOpenChange?.(value)
  }
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const enabled = items.filter((i) => !i.disabled)

  const focusItem = (index: number) => {
    const nodes = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])')
    if (!nodes || nodes.length === 0) return
    nodes[(index + nodes.length) % nodes.length].focus()
  }
  useEffect(() => {
    if (open) focusItem(0)
  }, [open])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!listRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }
  const onMenuKey = (e: KeyboardEvent) => {
    const nodes = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])
    const index = nodes.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown') focusItem(index + 1)
    else if (e.key === 'ArrowUp') focusItem(index - 1)
    else if (e.key === 'Home') focusItem(0)
    else if (e.key === 'End') focusItem(nodes.length - 1)
    else if (e.key === 'Escape') close()
    else if (e.key === 'Tab') close(false)
    else return
    if (e.key !== 'Tab') e.preventDefault()
  }

  return (
    <div className={`menu ${className ?? ''}`}>
      <button
        {...buttonProps}
        ref={buttonRef}
        type="button"
        className={`icon-button ${buttonProps?.className ?? ''}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        {children ?? <span aria-hidden="true">⋯</span>}
      </button>
      {open && (
        <div ref={listRef} id={menuId} role="menu" aria-label={label} className="menu-list" onKeyDown={onMenuKey}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              className={item.danger ? 'danger' : undefined}
              onClick={() => {
                close()
                item.onSelect()
              }}
            >
              {item.label}
            </button>
          ))}
          {enabled.length === 0 && <span className="muted small">No actions</span>}
        </div>
      )}
    </div>
  )
}
