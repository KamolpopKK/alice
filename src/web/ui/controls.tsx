import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ComponentType, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Icon } from './Icon'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

type ButtonOwnProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Icon before the label (decorative: the label names the button). */
  icon?: LucideIcon
  /** Shows a spinner, keeps the width, and blocks repeat activation; the label stays for screen readers. */
  loading?: boolean
  children: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonOwnProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>>(function Button(
  { variant = 'secondary', size = 'md', icon, loading = false, disabled, className, children, type = 'button', onClick, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('ui-button', `ui-button--${variant}`, `ui-button--${size}`, loading && 'is-loading', className)}
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      // ระหว่าง loading ปุ่มยังโฟกัสได้ (ไม่ทำให้โฟกัสหลุด) แต่กดซ้ำไม่ได้
      onClick={loading ? (e) => e.preventDefault() : onClick}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : icon ? <Icon icon={icon} size="sm" /> : null}
      <span className="ui-button-label">{children}</span>
    </button>
  )
})

type IconButtonProps = {
  icon: LucideIcon
  /** Required accessible name; also shown as the native tooltip unless `title` is given. */
  label: string
  variant?: Exclude<ButtonVariant, 'primary'>
  size?: ButtonSize
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'>

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ icon, label, variant = 'ghost', size = 'md', className, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} aria-label={label} className={cx('ui-icon-button', `ui-button--${variant}`, `ui-icon-button--${size}`, className)} {...rest}>
      <Icon icon={icon} size={size === 'sm' ? 'sm' : 'md'} />
    </button>
  )
})

type LinkButtonProps = ButtonOwnProps & AnchorHTMLAttributes<HTMLAnchorElement> & {
  /** A router link component (for example react-router's Link) that renders an anchor. */
  as?: ComponentType<AnchorHTMLAttributes<HTMLAnchorElement> & { to?: string }>
  to?: string
}

/** Looks like a button, navigates like a link. */
export function LinkButton({ variant = 'secondary', size = 'md', icon, children, className, as: As, ...rest }: LinkButtonProps) {
  const props = { className: cx('ui-button', `ui-button--${variant}`, `ui-button--${size}`, className), ...rest }
  const content = (
    <>
      {icon && <Icon icon={icon} size="sm" />}
      <span className="ui-button-label">{children}</span>
    </>
  )
  return As ? <As {...props}>{content}</As> : <a {...props}>{content}</a>
}

/** Inline text link with the shared link colour and focus ring. */
export function TextLink({ className, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a className={cx('ui-link', className)} {...rest} />
}

export function Spinner({ size = 'md', label }: { size?: 'sm' | 'md'; label?: string }) {
  return (
    <span className={cx('ui-spinner', `ui-spinner--${size}`)} role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <span className="ui-spinner-ring" />
    </span>
  )
}
