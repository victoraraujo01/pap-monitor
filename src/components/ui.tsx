import type { ReactNode, SelectHTMLAttributes } from 'react'

// Primitivos visuais compartilhados pelas views (Tailwind, estilo consistente
// com AppLayout/LoginView). Arquivo só com componentes — não adicionar exports
// não-componente aqui (react-refresh/only-export-components).

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
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {description && (
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      )}
      <div className="mt-4">{children}</div>
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
    <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
      {label}
      {children}
      {hint && (
        <span className="text-xs font-normal text-slate-400">{hint}</span>
      )}
    </label>
  )
}

const inputClass =
  'rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 focus:border-slate-500 focus:outline-none disabled:bg-slate-100'

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
      className={inputClass}
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
      className={inputClass}
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
    primary: 'bg-slate-900 text-white hover:bg-slate-700',
    secondary: 'border border-slate-300 text-slate-700 hover:bg-slate-100',
    danger: 'bg-red-600 text-white hover:bg-red-500',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${variants[variant]}`}
    >
      {children}
    </button>
  )
}

// Mensagem de feedback (erro/sucesso/info) inline.
export function Alert({
  kind,
  children,
}: {
  kind: 'error' | 'success' | 'info'
  children: ReactNode
}) {
  const styles = {
    error: 'bg-red-50 text-red-700 border-red-200',
    success: 'bg-green-50 text-green-700 border-green-200',
    info: 'bg-slate-50 text-slate-600 border-slate-200',
  }
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${styles[kind]}`}>
      {children}
    </div>
  )
}
