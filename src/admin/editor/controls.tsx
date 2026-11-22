/**
 * Shared admin form controls. Each field shows whether its value is the default and
 * whether it has unsaved changes, and offers a reset. Invalid input is shown on the field
 * and reported to the editor (which then blocks saving) instead of being corrected.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { numberProblem } from './validation'

// ---------------------------------------------------------------------------- layout

export function SettingGroup({ title, description, actions, children }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="adm-group">
      <div className="adm-group__head">
        <div>
          <h2 className="adm-group__title">{title}</h2>
          {description && <p className="adm-group__desc">{description}</p>}
        </div>
        {actions && <div className="adm-group__actions">{actions}</div>}
      </div>
      <div className="adm-group__body">{children}</div>
    </section>
  )
}

export function Notice({ tone = 'info', children, role }: { tone?: 'info' | 'success' | 'warning' | 'error'; children: ReactNode; role?: 'status' | 'alert' }) {
  return (
    <div className={`adm-msg adm-msg--${tone}`} role={role ?? (tone === 'error' ? 'alert' : 'status')}>
      {children}
    </div>
  )
}

export function Badge({ tone, children }: { tone: 'default' | 'changed' | 'readonly' | 'ok'; children: ReactNode }) {
  return <span className={`adm-badge adm-badge--${tone}`}>{children}</span>
}

interface ShellProps {
  label: string
  hint?: ReactNode
  error?: string | null
  warning?: string | null
  /** Differs from the saved value. */
  changed?: boolean
  /** Equals the site's default. */
  isDefault?: boolean
  defaultText?: string
  onReset?: () => void
  resetLabel?: string
  disabled?: boolean
}

function FieldShell({ id, label, hint, error, warning, changed, isDefault, defaultText, onReset, resetLabel, disabled, children }: ShellProps & { id: string; children: ReactNode }) {
  return (
    <div className={`adm-setting${error ? ' adm-setting--invalid' : ''}`}>
      <div className="adm-setting__head">
        <label className="adm-setting__label" htmlFor={id}>
          {label}
        </label>
        <span className="adm-setting__badges">
          {changed && <Badge tone="changed">Unsaved</Badge>}
          {isDefault && <Badge tone="default">Default</Badge>}
          {onReset && !isDefault && (
            <button type="button" className="adm-reset" onClick={onReset} disabled={disabled} aria-label={`${resetLabel ?? 'Reset to default'}: ${label}`}>
              {resetLabel ?? 'Reset'}
            </button>
          )}
        </span>
      </div>
      {children}
      {error && (
        <p className="adm-setting__error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
      {warning && !error && <p className="adm-setting__warning">{warning}</p>}
      {(hint || defaultText) && (
        <p className="adm-setting__hint" id={`${id}-hint`}>
          {hint}
          {hint && defaultText ? ' ' : ''}
          {defaultText && <span className="adm-setting__default">Default: {defaultText}</span>}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------- fields

export function ToggleField({ checked, onChange, onLabel = 'On', offLabel = 'Off', ...shell }: ShellProps & { checked: boolean; onChange: (v: boolean) => void; onLabel?: string; offLabel?: string }) {
  const id = useId()
  return (
    <FieldShell id={id} {...shell}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        className="adm-switch"
        disabled={shell.disabled}
        onClick={() => onChange(!checked)}
        aria-describedby={shell.hint || shell.defaultText ? `${id}-hint` : undefined}
      >
        <span className="adm-switch__track" aria-hidden="true">
          <span className="adm-switch__thumb" />
        </span>
        <span>{checked ? onLabel : offLabel}</span>
      </button>
    </FieldShell>
  )
}

export function SelectField<T extends string>({ value, options, onChange, ...shell }: ShellProps & { value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void }) {
  const id = useId()
  return (
    <FieldShell id={id} {...shell}>
      <select id={id} className="adm-input" value={value} disabled={shell.disabled} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  )
}

/**
 * Slider + number box. The slider can only produce valid values; the number box accepts
 * any text and reports problems instead of clamping or rounding.
 */
export function NumberField({
  value,
  min,
  max,
  step,
  unit,
  onChange,
  onValidity,
  ...shell
}: ShellProps & {
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
  /** Reports the input's problem (or null) so the editor can block saving. */
  onValidity: (problem: string | null) => void
}) {
  const id = useId()
  const [text, setText] = useState(String(value))
  const [shown, setShown] = useState(value)
  const [problem, setProblem] = useState<string | null>(null)
  // The value changed from outside (reset, discard, slider): show it.
  if (value !== shown) {
    setShown(value)
    setText(String(value))
    setProblem(null)
  }
  // Report the input's state to the editor (and clear it when the field goes away).
  const report = useRef(onValidity)
  useEffect(() => {
    report.current = onValidity
  })
  useEffect(() => report.current(problem), [problem])
  useEffect(() => () => report.current(null), [])

  const typed = (raw: string) => {
    setText(raw)
    const p = numberProblem(raw, min, max, step)
    setProblem(p)
    if (!p) {
      const v = Number(raw)
      setShown(v)
      if (v !== value) onChange(v)
    }
  }

  const sliderValue = problem ? value : Number(text)
  const range = `${min}–${max}${unit ? ` ${unit}` : ''}, step ${step}`
  return (
    <FieldShell id={id} {...shell} error={problem ?? shell.error} hint={<>{shell.hint ? <>{shell.hint} </> : null}Range {range}.</>}>
      <div className="adm-number">
        <input
          type="range"
          className="adm-range"
          min={min}
          max={max}
          step={step}
          value={sliderValue}
          disabled={shell.disabled}
          aria-label={`${shell.label} slider`}
          aria-valuetext={`${sliderValue}${unit ? ` ${unit}` : ''}`}
          onChange={(e) => typed(e.target.value)}
        />
        <span className="adm-number__box">
          <input
            id={id}
            className="adm-input adm-input--number"
            type="text"
            inputMode="decimal"
            value={text}
            disabled={shell.disabled}
            aria-invalid={!!problem}
            aria-describedby={`${id}-hint${problem ? ` ${id}-error` : ''}`}
            onChange={(e) => typed(e.target.value)}
          />
          {unit && <span className="adm-number__unit">{unit}</span>}
        </span>
      </div>
    </FieldShell>
  )
}

export function TextField({
  value,
  onChange,
  max,
  required,
  multiline,
  placeholder,
  ...shell
}: ShellProps & { value: string; onChange: (v: string) => void; max: number; required?: boolean; multiline?: boolean; placeholder?: string }) {
  const id = useId()
  const length = [...value].length
  const tooLong = length > max
  const empty = required && !value.trim()
  const error = shell.error ?? (tooLong ? `Too long: ${length} of ${max} characters.` : empty ? 'This field is required.' : null)
  const common = {
    id,
    className: 'adm-input',
    value,
    placeholder,
    disabled: shell.disabled,
    'aria-invalid': !!error,
    'aria-describedby': `${id}-hint${error ? ` ${id}-error` : ''}`,
  }
  return (
    <FieldShell id={id} {...shell} error={error} hint={<>{shell.hint ? <>{shell.hint} </> : null}{length}/{max} characters.</>}>
      {multiline ? <textarea {...common} rows={3} onChange={(e) => onChange(e.target.value)} /> : <input {...common} type="text" onChange={(e) => onChange(e.target.value)} />}
    </FieldShell>
  )
}

/** A setting that exists but can't be edited here, with the reason. */
export function ReadOnlyField({ label, value, reason }: { label: string; value?: ReactNode; reason: ReactNode }) {
  return (
    <div className="adm-setting adm-setting--readonly">
      <div className="adm-setting__head">
        <span className="adm-setting__label">{label}</span>
        <span className="adm-setting__badges">
          <Badge tone="readonly">Read-only</Badge>
        </span>
      </div>
      {value !== undefined && <p className="adm-setting__value">{value}</p>}
      <p className="adm-setting__hint">{reason}</p>
    </div>
  )
}
