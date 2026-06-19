import type { ReactNode, SelectHTMLAttributes } from 'react'

// Primitivos visuais compartilhados — estética "livro-razão esmeralda".
// Arquivo só com componentes (react-refresh/only-export-components).

export function Card({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: ReactNode
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-line bg-moss/70 p-6 shadow-[0_1px_0_rgba(236,227,208,0.04)_inset,0_24px_60px_-40px_rgba(0,0,0,0.9)] backdrop-blur-sm">
      {/* filete dourado no topo do cartão */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brass/60 to-transparent" />
      <div className="flex items-baseline gap-3">
        <span className="text-brass">§</span>
        <h2 className="font-display text-xl font-medium tracking-tight text-bone">
          {title}
        </h2>
      </div>
      {description && (
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-bone-dim">
          {description}
        </p>
      )}
      <div className="mt-5">{children}</div>
    </section>
  )
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="eyebrow text-sage">{label}</span>
      {children}
      {hint && <span className="text-xs text-sage">{hint}</span>}
    </label>
  )
}

const inputClass =
  'w-full rounded-lg border border-line bg-void/60 px-3 py-2.5 text-sm text-bone placeholder:text-sage/60 transition-colors focus:border-brass/70 focus:outline-none focus:ring-1 focus:ring-brass/40 disabled:opacity-50'

export function NumberInput({
  value,
  onChange,
  step,
  min,
  placeholder,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  step?: string
  min?: string
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      step={step}
      min={min}
      placeholder={placeholder}
      disabled={disabled}
      required
      className={`${inputClass} nums`}
    />
  )
}

export function Select({
  value,
  onChange,
  children,
  ...rest
}: {
  value: string
  onChange: (v: string) => void
  children: ReactNode
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputClass} cursor-pointer appearance-none bg-[length:14px] bg-[right_0.85rem_center] bg-no-repeat pr-9`}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23C9A24A' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      {...rest}
    >
      {children}
    </select>
  )
}

export function Button({
  children,
  type = 'button',
  onClick,
  disabled,
  variant = 'primary',
}: {
  children: ReactNode
  type?: 'button' | 'submit'
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'danger'
}) {
  const variants = {
    primary:
      'bg-gradient-to-b from-brass-bright to-brass text-void shadow-[0_8px_24px_-12px_rgba(201,162,74,0.7)] hover:from-brass hover:to-brass-bright',
    secondary:
      'border border-line bg-transparent text-bone hover:border-brass/50 hover:bg-bone/5',
    danger: 'bg-clay/90 text-void hover:bg-clay',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-4 py-2.5 text-sm font-semibold tracking-tight transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]}`}
    >
      {children}
    </button>
  )
}

// Mensagem de feedback inline.
export function Alert({
  kind,
  children,
}: {
  kind: 'error' | 'success' | 'info'
  children: ReactNode
}) {
  const styles = {
    error: 'border-clay/40 bg-clay/10 text-clay',
    success: 'border-emerald/40 bg-emerald/10 text-emerald',
    info: 'border-line bg-bone/5 text-bone-dim',
  }
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-sm ${styles[kind]}`}
    >
      <span aria-hidden className="mt-px select-none">
        {kind === 'error' ? '⚠' : kind === 'success' ? '✓' : 'ℹ'}
      </span>
      <span>{children}</span>
    </div>
  )
}
