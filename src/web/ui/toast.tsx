import { X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IconButton } from './controls'

export type ToastTone = 'info' | 'success' | 'danger'
type ToastItem = { id: number; tone: ToastTone; message: string; action?: { label: string; onAction: () => void } }
type ToastApi = { show: (message: string, opts?: { tone?: ToastTone; action?: ToastItem['action'] }) => void }

const ToastContext = createContext<ToastApi | null>(null)
const DURATION_MS = 6000

/**
 * Short, non-blocking confirmation of something that already happened ("Task created").
 * Errors that need action stay next to the field or in a Banner, not in a toast.
 * Messages are announced through one polite live region; hovering or focusing pauses dismissal.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const next = useRef(1)
  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), [])
  const show = useCallback<ToastApi['show']>((message, opts) => {
    const id = next.current++
    setItems((all) => [...all.slice(-2), { id, message, tone: opts?.tone ?? 'info', action: opts?.action }])
  }, [])
  const api = useMemo(() => ({ show }), [show])
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="ui-toast-region" role="status" aria-live="polite" aria-label="Notifications">
        {items.map((t) => (
          <Toast key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (paused) return
    const t = setTimeout(onDismiss, DURATION_MS)
    return () => clearTimeout(t)
  }, [paused, onDismiss])
  return (
    <div
      className={`ui-toast ui-toast--${item.tone}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="ui-toast-message">{item.message}</span>
      {item.action && (
        <button
          type="button"
          className="ui-toast-action"
          onClick={() => {
            item.action!.onAction()
            onDismiss()
          }}
        >
          {item.action.label}
        </button>
      )}
      <IconButton icon={X} label="Dismiss notification" size="sm" onClick={onDismiss} />
    </div>
  )
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast needs a ToastProvider')
  return api
}
