import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { Icon } from './Icon'

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

type FieldFrame = {
  label: ReactNode
  /** Supporting text under the label; linked with aria-describedby. */
  hint?: ReactNode
  /** Validation message; marks the control invalid and is announced with it. */
  error?: ReactNode
  /** Visually hide the label (it stays the accessible name). */
  hideLabel?: boolean
}

/** Label, hint and error around one control, with ids wired for assistive technology. */
function Frame({ id, label, hint, error, hideLabel, required, children }: FieldFrame & { id: string; required?: boolean; children: ReactNode }) {
  return (
    <div className={cx('ui-field', error ? 'is-invalid' : null)}>
      <label className={cx('ui-field-label', hideLabel && 'ui-visually-hidden')} htmlFor={id}>
        {label}
        {required && (
          <span className="ui-field-required" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {hint && (
        <p className="ui-field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {children}
      {error && <FieldMessage id={`${id}-error`} tone="error">{error}</FieldMessage>}
    </div>
  )
}

const describedBy = (id: string, hint: unknown, error: unknown) => [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined

export const TextField = forwardRef<HTMLInputElement, FieldFrame & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & { id?: string }>(function TextField(
  { label, hint, error, hideLabel, id: given, className, ...rest },
  ref,
) {
  const auto = useId()
  const id = given ?? auto
  return (
    <Frame id={id} label={label} hint={hint} error={error} hideLabel={hideLabel} required={rest.required}>
      <input ref={ref} id={id} className={cx('ui-input', className)} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...rest} />
    </Frame>
  )
})

export const TextArea = forwardRef<HTMLTextAreaElement, FieldFrame & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & { id?: string }>(function TextArea(
  { label, hint, error, hideLabel, id: given, className, rows = 4, ...rest },
  ref,
) {
  const auto = useId()
  const id = given ?? auto
  return (
    <Frame id={id} label={label} hint={hint} error={error} hideLabel={hideLabel} required={rest.required}>
      <textarea ref={ref} id={id} rows={rows} className={cx('ui-input', 'ui-textarea', className)} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...rest} />
    </Frame>
  )
})

export type SelectOption = { value: string; label: string; disabled?: boolean }

/** Native select: platform keyboard and screen-reader behaviour, Alice styling. */
export const SelectField = forwardRef<HTMLSelectElement, FieldFrame & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & { id?: string; options: SelectOption[] }>(function SelectField(
  { label, hint, error, hideLabel, id: given, className, options, ...rest },
  ref,
) {
  const auto = useId()
  const id = given ?? auto
  return (
    <Frame id={id} label={label} hint={hint} error={error} hideLabel={hideLabel} required={rest.required}>
      <select ref={ref} id={id} className={cx('ui-input', 'ui-select', className)} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </Frame>
  )
})

type ChoiceProps = { label: ReactNode; hint?: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

export const Checkbox = forwardRef<HTMLInputElement, ChoiceProps>(function Checkbox({ label, hint, id: given, className, ...rest }, ref) {
  const auto = useId()
  const id = given ?? auto
  return (
    <div className={cx('ui-choice', className)}>
      <input ref={ref} id={id} type="checkbox" className="ui-checkbox" aria-describedby={hint ? `${id}-hint` : undefined} {...rest} />
      <label htmlFor={id} className="ui-choice-label">
        {label}
        {hint && (
          <span className="ui-field-hint" id={`${id}-hint`}>
            {hint}
          </span>
        )}
      </label>
    </div>
  )
})

/** An on/off setting that applies immediately (use Checkbox inside forms that are submitted). */
export const Switch = forwardRef<HTMLInputElement, ChoiceProps>(function Switch({ label, hint, id: given, className, ...rest }, ref) {
  const auto = useId()
  const id = given ?? auto
  return (
    <div className={cx('ui-choice', 'ui-switch-row', className)}>
      <input ref={ref} id={id} type="checkbox" role="switch" className="ui-switch" aria-describedby={hint ? `${id}-hint` : undefined} {...rest} />
      <label htmlFor={id} className="ui-choice-label">
        {label}
        {hint && (
          <span className="ui-field-hint" id={`${id}-hint`}>
            {hint}
          </span>
        )}
      </label>
    </div>
  )
})

export type RadioOption = { value: string; label: ReactNode; hint?: ReactNode; disabled?: boolean }

export function RadioGroup({
  legend,
  name,
  value,
  onChange,
  options,
  error,
}: {
  legend: ReactNode
  name: string
  value: string
  onChange: (value: string) => void
  options: RadioOption[]
  error?: ReactNode
}) {
  const id = useId()
  return (
    <fieldset className={cx('ui-radio-group', error ? 'is-invalid' : null)} aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="ui-field-label">{legend}</legend>
      {options.map((o) => {
        const optionId = `${id}-${o.value}`
        return (
          <div className="ui-choice" key={o.value}>
            <input
              id={optionId}
              type="radio"
              className="ui-radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
              aria-describedby={o.hint ? `${optionId}-hint` : undefined}
            />
            <label htmlFor={optionId} className="ui-choice-label">
              {o.label}
              {o.hint && (
                <span className="ui-field-hint" id={`${optionId}-hint`}>
                  {o.hint}
                </span>
              )}
            </label>
          </div>
        )
      })}
      {error && <FieldMessage id={`${id}-error`} tone="error">{error}</FieldMessage>}
    </fieldset>
  )
}

/** Inline form feedback next to the field it is about. Errors carry an icon, never colour alone. */
/**
 * Message under a field (with `id`, read through the field's aria-describedby) or on its own after an
 * action (without `id`): a standalone error is announced immediately.
 */
export function FieldMessage({ id, tone, children }: { id?: string; tone: 'error' | 'success' | 'info'; children: ReactNode }) {
  return (
    <p id={id} className={cx('ui-field-message', `ui-field-message--${tone}`)} role={tone === 'error' && !id ? 'alert' : undefined}>
      {tone === 'error' && <Icon icon={AlertCircle} size="sm" />}
      {tone === 'success' && <Icon icon={CheckCircle2} size="sm" />}
      <span>{children}</span>
    </p>
  )
}

/**
 * Compact native select for changing one value in place (a task's status in a row). The label is
 * required and stays the accessible name; it is not shown because the surrounding row names the item.
 */
export const InlineSelect = forwardRef<HTMLSelectElement, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'aria-label'> & { label: string; options: SelectOption[]; tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }>(
  function InlineSelect({ label, options, tone = 'neutral', className, ...rest }, ref) {
    return (
      <select ref={ref} aria-label={label} className={cx('ui-inline-select', `ui-inline-select--${tone}`, className)} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    )
  },
)
