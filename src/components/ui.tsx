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
    <section className="relative overflow-hidden rounded-2xl border border-line bg-moss/70 p-6 shadow-[0_1px_0_rgba(255,255,255,0.7)_inset,0_18px_44px_-30px_rgba(40,52,44,0.28)] backdrop-blur-sm">
      {/* filete dourado no topo do cartão */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brass/60 to-transparent" />
      <div className="flex items-baseline gap-3">
        <span className="text-brass">§</span>
        <h2 className="font-display text-xl font-medium tracking-tight text-bone">
          {title}
        </h2>
      </div>
      {description && (
        <p className="mt-2 text-sm leading-relaxed text-bone-dim">
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
  'w-full rounded-lg border border-bone/15 bg-white px-3 py-2.5 text-sm text-bone shadow-[inset_0_1px_2px_rgba(44,52,53,0.04)] placeholder:text-sage/60 transition-colors focus:border-brass/70 focus:outline-none focus:ring-1 focus:ring-brass/40 disabled:opacity-50'

// Mantém o valor canônico com ponto decimal (todos os callers fazem
// `Number(value)`), mas exibe e aceita vírgula no padrão pt-BR.
export function NumberInput({
  value,
  onChange,
  step,
  min,
  placeholder,
  disabled,
  required = true,
  inputClassName,
}: {
  value: string
  onChange: (v: string) => void
  step?: string
  min?: string
  placeholder?: string
  disabled?: boolean
  required?: boolean
  inputClassName?: string
}) {
  // 4330.62 → "4330,62" para exibição
  const display = value.replace('.', ',')

  function handleChange(raw: string) {
    // Canoniza para ponto decimal. Lida tanto com digitação quanto com COLAGEM de
    // valores já formatados em pt-BR (ex.: "R$ 1.234,56"): descarta tudo que não
    // for dígito/separador/sinal e interpreta os separadores por contexto.
    let s = raw.replace(/[^0-9.,-]/g, '')
    const negative = s.startsWith('-')
    s = s.replace(/-/g, '')

    if (s.includes(',')) {
      // Vírgula presente = decimal pt-BR → pontos são milhares (descarta-os) e só a
      // primeira vírgula vira o ponto decimal.
      s = s.replace(/\./g, '')
      const i = s.indexOf(',')
      s = s.slice(0, i) + '.' + s.slice(i + 1).replace(/,/g, '')
    } else if ((s.match(/\./g)?.length ?? 0) > 1) {
      // Sem vírgula mas com vários pontos = milhares (ex.: "1.234.567") → descarta.
      // Um único ponto é mantido como decimal (digitação "12.5").
      s = s.replace(/\./g, '')
    }

    onChange((negative ? '-' : '') + s)
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      onChange={(e) => handleChange(e.target.value)}
      step={step}
      min={min}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
      className={`${inputClass} nums ${inputClassName ?? ''}`}
    />
  )
}

// Texto livre (ex.: campo de confirmação). Mantém o mesmo visual dos demais inputs.
export function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete="off"
      className={inputClass}
    />
  )
}

// Texto livre multilinha (ex.: nota opcional numa movimentação).
export function Textarea({
  value,
  onChange,
  placeholder,
  disabled,
  rows = 2,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  rows?: number
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      rows={rows}
      className={`${inputClass} resize-y`}
    />
  )
}

export function DateInput({
  value,
  onChange,
  max,
  disabled,
  required = true,
}: {
  value: string
  onChange: (v: string) => void
  max?: string
  disabled?: boolean
  required?: boolean
}) {
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      max={max}
      disabled={disabled}
      required={required}
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
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%234A7256' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
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
      'bg-gradient-to-b from-brass-bright to-brass text-white shadow-[0_8px_20px_-12px_rgba(74,114,86,0.6)] hover:from-brass hover:to-brass-bright',
    secondary:
      'border border-line bg-transparent text-bone hover:border-brass/50 hover:bg-bone/5',
    danger: 'bg-clay/90 text-white hover:bg-clay',
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
