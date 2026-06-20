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

export type BarItem = {
  label: string
  value: string // já formatado (R$ / %)
  fraction: number // 0..1 — largura da barra
  tone?: 'brass' | 'emerald' | 'clay'
  muted?: boolean // rótulo secundário (ex.: "você")
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
        </li>
      ))}
    </ul>
  )
}
