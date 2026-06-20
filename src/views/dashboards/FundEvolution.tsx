import { useEffect, useState } from 'react'
import { supabase } from '@/services/supabase'
import { Card } from '@/components/ui'
import { formatBRL, formatDate } from '@/lib/format'
import { BarList, Sparkline, type BarItem } from './charts'

type PlPoint = {
  date: string
  total_pl_brl: number
  quota_price: number
  total_quotas: number
}

// Lote ativo com o título aninhado (join via FK).
type LotRow = {
  quantity: number
  treasury_bonds: {
    display_name: string | null
    api_reference_name: string
    current_price: number | null
  } | null
}

// R$ com mais casas — o valor da cota varia em centésimos de centavo.
function formatQuota(v: number): string {
  return `R$ ${v.toLocaleString('pt-BR', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  })}`
}

function pct(curr: number, prev: number): string | null {
  if (!prev) return null
  const d = ((curr - prev) / prev) * 100
  const sign = d >= 0 ? '+' : ''
  return `${sign}${d.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
}

// CdU 5 — Histórico do Fundo: evolução do PL e do valor da cota (pl_history) +
// composição da carteira (fund_bond_lots × treasury_bonds).
export function FundEvolution() {
  const [history, setHistory] = useState<PlPoint[]>([])
  const [lots, setLots] = useState<LotRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase
        .from('pl_history')
        .select('date, total_pl_brl, quota_price, total_quotas')
        .order('date', { ascending: true }),
      supabase
        .from('fund_bond_lots')
        .select(
          'quantity, treasury_bonds(display_name, api_reference_name, current_price)',
        )
        .eq('is_active', true),
    ]).then(([h, l]) => {
      setHistory((h.data as PlPoint[] | null) ?? [])
      setLots((l.data as LotRow[] | null) ?? [])
      setLoading(false)
    })
  }, [])

  const latest = history.at(-1)
  const prev = history.at(-2)

  // Composição: valor bruto atual por título (quantity × current_price).
  const byBond = new Map<string, number>()
  for (const lot of lots) {
    const b = lot.treasury_bonds
    if (!b) continue
    const name = b.display_name ?? b.api_reference_name
    const gross = lot.quantity * (b.current_price ?? 0)
    byBond.set(name, (byBond.get(name) ?? 0) + gross)
  }
  const totalGross = [...byBond.values()].reduce((a, b) => a + b, 0)
  const composition: BarItem[] = [...byBond.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({
      label,
      value:
        totalGross > 0
          ? `${((value / totalGross) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
          : '—',
      fraction: totalGross > 0 ? value / totalGross : 0,
    }))

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Metric
          label="Patrimônio líquido"
          value={latest ? formatBRL(latest.total_pl_brl) : '—'}
          delta={latest && prev ? pct(latest.total_pl_brl, prev.total_pl_brl) : null}
          series={history.map((p) => p.total_pl_brl)}
          tone="emerald"
          loading={loading}
        />
        <Metric
          label="Valor da cota"
          value={latest ? formatQuota(latest.quota_price) : '—'}
          delta={latest && prev ? pct(latest.quota_price, prev.quota_price) : null}
          series={history.map((p) => p.quota_price)}
          tone="brass"
          loading={loading}
        />
      </div>

      <Card
        title="Composição da carteira"
        description="Fatia de cada título no patrimônio bruto atual do fundo."
      >
        {loading ? (
          <p className="text-sm text-bone-dim">Carregando…</p>
        ) : composition.length === 0 ? (
          <p className="text-sm text-bone-dim">
            Nenhum lote ativo na carteira ainda.
          </p>
        ) : (
          <BarList items={composition} />
        )}
        {latest && (
          <p className="eyebrow mt-5 text-sage">
            {history.length} fechamento{history.length === 1 ? '' : 's'} ·
            último em {formatDate(latest.date)}
          </p>
        )}
      </Card>
    </div>
  )
}

// Cartão de métrica com sparkline. Mantém a moldura dos cartões, mas compacto.
function Metric({
  label,
  value,
  delta,
  series,
  tone,
  loading,
}: {
  label: string
  value: string
  delta: string | null
  series: number[]
  tone: 'brass' | 'emerald'
  loading: boolean
}) {
  const up = delta?.startsWith('+')
  return (
    <section className="relative overflow-hidden rounded-2xl border border-line bg-moss/70 p-5 shadow-[0_1px_0_rgba(255,255,255,0.7)_inset,0_18px_44px_-30px_rgba(40,52,44,0.28)] backdrop-blur-sm">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brass/60 to-transparent" />
      <div className="flex items-baseline justify-between gap-3">
        <span className="eyebrow text-sage">{label}</span>
        {delta && (
          <span
            className={`nums text-xs font-semibold ${up ? 'text-emerald' : 'text-clay'}`}
          >
            {delta}
          </span>
        )}
      </div>
      <p className="nums mt-2 text-2xl font-semibold tracking-tight text-bone">
        {loading ? '…' : value}
      </p>
      <div className="mt-3">
        {!loading && series.length > 0 ? (
          <Sparkline values={series} tone={tone} />
        ) : (
          <div className="h-[56px]" />
        )}
      </div>
    </section>
  )
}
