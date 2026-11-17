import { useEffect, useId, useRef, type ReactNode } from 'react'

/**
 * Modal dialog on the native `<dialog>` element: the browser provides the focus trap, Escape,
 * inert background and top layer. Focus returns to whatever opened it when it closes.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
  description,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  className?: string
  description?: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const openRef = useRef(open)
  openRef.current = open
  const titleId = useId()
  const descriptionId = useId()
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      returnTo.current = document.activeElement as HTMLElement | null
      dialog.showModal()
      // ปุ่มที่ปลอดภัยกว่า (เช่น Cancel) ได้ focus ก่อนเมื่อมีการระบุ
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
      // คืน focus ทันที (close event มาแบบ async และอาจแย่ง focus ที่ผู้ใช้ย้ายไปแล้ว)
      restoreFocus()
    }
  }, [open])
  function restoreFocus() {
    const target = returnTo.current
    returnTo.current = null
    if (target?.isConnected) target.focus()
  }
  useEffect(() => {
    const dialog = ref.current
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className={`dialog ${className ?? ''}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={() => {
        // close event มาถึงแบบ async: อาจเป็นของการปิดครั้งก่อนหลังจากเปิดใหม่แล้ว
        if (ref.current?.open) return
        // ปิดโดยเบราว์เซอร์ขณะที่ state ยังเปิดอยู่ → แจ้งให้ state ตามทัน
        if (openRef.current) {
          onClose()
          restoreFocus()
        }
      }}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      {open && (
        <>
          <div className="dialog-head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
              <span aria-hidden="true">×</span>
            </button>
          </div>
          {description && (
            <p id={descriptionId} className="dialog-description">
              {description}
            </p>
          )}
          {children}
        </>
      )}
    </dialog>
  )
}

/** A yes/no confirmation that names the consequence on its confirm button. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
  error,
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  error?: ReactNode
}) {
  return (
    <Dialog open={open} onClose={onCancel} title={title} description={message}>
      {error}
      <div className="row dialog-actions">
        <button type="button" className={danger ? 'danger-solid' : 'primary'} onClick={onConfirm} disabled={busy}>
          {confirmLabel}
        </button>
        <button type="button" onClick={onCancel} data-autofocus>
          Cancel
        </button>
      </div>
    </Dialog>
  )
}
