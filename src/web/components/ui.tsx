import { useId, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { ApiError } from '../api'
import { Avatar, FieldMessage, Spinner } from '../ui'

/**
 * Label + control for the few forms not yet built from Alice UI fields (auth scene, label entry).
 * Uses the Alice UI field layout so it looks and reads the same.
 */
export function Field({ label, hint, children, id }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode; id?: string }) {
  const generated = useId()
  const fieldId = id ?? generated
  return (
    <div className="field ui-field">
      <label htmlFor={fieldId} className="ui-field-label">
        {label}
      </label>
      {children(fieldId)}
      {hint && <p className="hint ui-field-hint">{hint}</p>}
    </div>
  )
}

export function TextInput({ label, hint, ...props }: { label: string; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return <Field label={label} hint={hint}>{(id) => <input id={id} {...props} className={['ui-input', props.className].filter(Boolean).join(' ')} />}</Field>
}

/**
 * Password (or other secret) field with an explicit reveal/hide button. The same input element is kept,
 * so the value, name, constraints and autocomplete hints (password managers) are untouched; only its
 * `type` switches. The button states its action ("Show password" / "Hide password") and pressed state.
 */
export function PasswordInput({ label, hint, ...props }: { label: string; hint?: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false)
  const noun = label.toLowerCase()
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <div className="secret-field">
          <input id={id} {...props} className={['ui-input', props.className].filter(Boolean).join(' ')} type={visible ? 'text' : 'password'} spellCheck={false} autoCapitalize="off" />
          <button
            type="button"
            className="secret-toggle"
            aria-label={`${visible ? 'Hide' : 'Show'} ${noun}`}
            aria-pressed={visible}
            aria-controls={id}
            onClick={() => setVisible((v) => !v)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
              <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
              <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
              {visible && <path stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M4 20 20 4" />}
            </svg>
          </button>
        </div>
      )}
    </Field>
  )
}

export function TextArea({ label, hint, ...props }: { label: string; hint?: ReactNode } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <Field label={label} hint={hint}>{(id) => <textarea id={id} {...props} />}</Field>
}

export function Select({ label, hint, children, ...props }: { label: string; hint?: ReactNode; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <select id={id} {...props} className={['ui-input', 'ui-select', props.className].filter(Boolean).join(' ')}>
          {children}
        </select>
      )}
    </Field>
  )
}

/** A failed request, announced at once, in the same form as Alice UI field errors. */
export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null
  const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error)
  return <FieldMessage tone="error">{message}</FieldMessage>
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty ui-text-muted">{children}</p>
}

export function Loading() {
  return (
    <p className="ui-text-muted loading-line" aria-live="polite">
      <Spinner size="sm" /> Loading…
    </p>
  )
}

export function formatDate(iso: string | null | undefined, withTime = true): string {
  if (!iso) return '—'
  const d = new Date(iso)
  // วันที่อย่างเดียว (เช่น due date) เก็บเป็น UTC จึงแสดงแบบ UTC เพื่อไม่ให้วันเลื่อนตาม timezone
  return withTime ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : d.toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' })
}

/** A person or agent named inline; agents read as "(agent)" and get the square avatar. */
export function ActorBadge({ actor }: { actor: { kind: 'human' | 'agent'; displayName: string } | null | undefined }) {
  if (!actor) return <span className="ui-text-muted">System</span>
  return (
    <span className={`actor actor-${actor.kind}`} title={actor.kind === 'agent' ? 'AI agent' : 'Human'}>
      <Avatar name={actor.displayName} kind={actor.kind} size="sm" />
      {actor.displayName}
      {actor.kind === 'agent' && <span className="sr-only"> (agent)</span>}
    </span>
  )
}
