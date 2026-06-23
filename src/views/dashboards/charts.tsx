// Instrumentos visuais dos dashboards (Etapa D). Sem dependências externas:
// SVG/CSS puros, na paleta sálvia/verde. Use pelos papéis semânticos dos tokens
// (lembrete: `brass` = VERDE de acento; `emerald` = positivo; `clay` = negativo).

// Linha evolutiva compacta (sparkline). Normaliza a série num viewBox fixo e usa
// vector-effect non-scaling-stroke p/ manter o traço fino ao esticar via CSS.
export function Sparkline({
  values,
  tone = 'brass',
  height = 56,
}: {
  values: number[]
  tone?: 'brass' | 'emerald'
  height?: number
}) {
  const stroke = tone === 'emerald' ? '#2E8B57' : '#4A7256'
  const W = 100
  const H = 32
  const pad = 2

  if (values.length === 0) return null

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const stepX = values.length > 1 ? (W - pad * 2) / (values.length - 1) : 0

  const pts = values.map((v, i) => {
    const x = pad + i * stepX
    const y = pad + (H - pad * 2) * (1 - (v - min) / span)
    return [x, y] as const
  })

  // Um único ponto: desenha uma marca central.
  const line =
    pts.length === 1
      ? `M ${W / 2 - 6} ${pts[0][1]} L ${W / 2 + 6} ${pts[0][1]}`
      : 'M ' + pts.map(([x, y]) => `${x} ${y}`).join(' L ')
  const area =
    pts.length > 1
      ? `${line} L ${pts[pts.length - 1][0]} ${H - pad} L ${pts[0][0]} ${H - pad} Z`
      : ''
  const gradId = `spark-${tone}`

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      role="img"
      aria-hidden
      className="overflow-visible"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {area && <path d={area} fill={`url(#${gradId})`} stroke="none" />}
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export type PieSlice = {
  label: string
  value: string // já formatado (% / R$)
  fraction: number // 0..1
}

// Paleta das fatias — específica do donut. Mantém a saturação contida da página
// (família verde/sálvia/terra, nada de neon), mas com contraste real entre fatias
// vizinhas: alterna escuro↔claro e desloca o matiz (pinheiro → folha → teal →
// oliva) para que títulos adjacentes não se confundam.
const PIE_PALETTE = [
  '#2C5746', // pinheiro profundo (verde escuro, frio)
  '#7FA85C', // verde-folha (claro, quente)
  '#4E8C8A', // verde-azulado suave (teal)
  '#A8C08A', // oliva pálido
  '#3E7A57', // verde médio
  '#C6D2AE', // sálvia-lima clara
]

// Gráfico de pizza (donut) — composição da carteira (CdU 5). SVG puro com fatias
// em arco + furo central; legenda à parte com os mesmos tons. Sem lib externa.
export function PieChart({ items }: { items: PieSlice[] }) {
  const total = items.reduce((s, it) => s + Math.max(it.fraction, 0), 0) || 1
  const cx = 21
  const cy = 21
  const r = 20

  // Ângulos cumulativos via somas-prefixo (sem mutar variável durante o render).
  const fracs = items.map((it) => Math.max(it.fraction, 0) / total)
  const TAU = 2 * Math.PI

  const slices = items.map((it, i) => {
    const frac = fracs[i]
    const before = fracs.slice(0, i).reduce((a, b) => a + b, 0)
    const start = -Math.PI / 2 + before * TAU
    const end = start + frac * TAU
    const color = PIE_PALETTE[i % PIE_PALETTE.length]
    // Fatia única (≈100%): o arco degenera — desenha o anel inteiro.
    if (frac >= 0.9999) {
      return <circle key={it.label} cx={cx} cy={cy} r={r} fill={color} />
    }
    const large = end - start > Math.PI ? 1 : 0
    const x1 = cx + r * Math.cos(start)
    const y1 = cy + r * Math.sin(start)
    const x2 = cx + r * Math.cos(end)
    const y2 = cy + r * Math.sin(end)
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
    return <path key={it.label} d={d} fill={color} />
  })

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-7">
      <svg
        viewBox="0 0 42 42"
        className="h-40 w-40 shrink-0"
        role="img"
        aria-hidden
      >
        {slices}
        {/* furo central — branco do cartão */}
        <circle cx={cx} cy={cy} r={11.5} fill="#FFFFFF" />
      </svg>
      <ul className="flex w-full flex-1 flex-col gap-2.5">
        {items.map((it, i) => (
          <li key={it.label} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: PIE_PALETTE[i % PIE_PALETTE.length] }}
            />
            <span className="truncate text-bone-dim">{it.label}</span>
            <span className="nums ml-auto shrink-0 text-bone">{it.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export type BarItem = {
  label: string
  value: string // já formatado (R$ / %)
  fraction: number // 0..1 — largura da barra
  tone?: 'brass' | 'emerald' | 'clay'
  muted?: boolean // rótulo secundário (ex.: "você")
  meta?: string // linha secundária sob a barra (ex.: aportado · cotas)
}

// Lista de barras horizontais — composição da carteira (CdU 5) e participação
// dos cotistas (CdU 7).
export function BarList({ items }: { items: BarItem[] }) {
  const fill: Record<string, string> = {
    brass: 'bg-brass',
    emerald: 'bg-emerald',
    clay: 'bg-clay',
  }
  return (
    <ul className="flex flex-col gap-3.5">
      {items.map((it) => (
        <li key={it.label} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span
              className={`truncate text-sm ${it.muted ? 'font-medium text-bone' : 'text-bone-dim'}`}
            >
              {it.label}
            </span>
            <span className="nums shrink-0 text-sm text-bone">{it.value}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-pine">
            <div
              className={`h-full rounded-full ${fill[it.tone ?? 'brass']}`}
              style={{ width: `${Math.max(2, it.fraction * 100)}%` }}
            />
          </div>
          {it.meta && <p className="nums text-xs text-sage">{it.meta}</p>}
        </li>
      ))}
    </ul>
  )
}
