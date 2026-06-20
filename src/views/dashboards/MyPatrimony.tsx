import { useEffect, useState } from 'react'
import { supabase } from '@/services/supabase'
import type { Tables } from '@/services/supabase'
import { useAuth } from '@/context/useAuth'
import { Alert, Card } from '@/components/ui'
import { formatBRL, formatDate, formatQuotas } from '@/lib/format'

type Tx = Pick<
  Tables<'transactions'>,
  'id' | 'type' | 'status' | 'amount_brl' | 'quotas_amount' | 'created_at'
>
type Obligation = Pick<
  Tables<'monthly_obligations'>,
  'id' | 'reference_month' | 'amount_expected' | 'status'
>

const TYPE_LABEL: Record<string, string> = {
  APORTE: 'Aporte',
  RESGATE_PESSOAL: 'Resgate pessoal',
  DESPESA_PAIS: 'Despesa dos pais',
}

// CdU 6 — Histórico individual: "quanto eu tenho e estou devendo algo?".
export function MyPatrimony() {
  const { profile } = useAuth()
  const profileId = profile?.id
  const [txs, setTxs] = useState<Tx[]>([])
  const [obligations, setObligations] = useState<Obligation[]>([])
  const [quotaPrice, setQuotaPrice] = useState(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profileId) return
    Promise.all([
      supabase
        .from('transactions')
        .select('id, type, status, amount_brl, quotas_amount, created_at')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false }),
      supabase
        .from('monthly_obligations')
        .select('id, reference_month, amount_expected, status')
        .eq('profile_id', profileId)
        .eq('status', 'PENDING')
        .order('reference_month', { ascending: true }),
      supabase
        .from('pl_history')
        .select('quota_price')
        .order('date', { ascending: false })
        .limit(1),
    ]).then(([t, o, p]) => {
      setTxs((t.data as Tx[] | null) ?? [])
      setObligations((o.data as Obligation[] | null) ?? [])
      // Bootstrap da cota = R$1,00 quando não há histórico ainda.
      const price = (p.data as { quota_price: number }[] | null)?.[0]?.quota_price
      setQuotaPrice(price ?? 1)
      setLoading(false)
    })
  }, [profileId])

  // Cotas líquidas = soma dos deltas assinados das transações APROVADAS.
  const myQuotas = txs
    .filter((t) => t.status === 'APPROVED')
    .reduce((sum, t) => sum + t.quotas_amount, 0)
  const patrimony = myQuotas * quotaPrice

  const pendingTotal = obligations.reduce(
    (sum, o) => sum + (o.amount_expected ?? 0),
    0,
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Highlight
          label="Patrimônio individual"
          value={loading ? '…' : formatBRL(patrimony)}
          hint={`${formatQuotas(myQuotas)} cotas × ${formatBRL(quotaPrice)}`}
          span2
        />
        <div
          className={`rounded-2xl border p-5 ${
            obligations.length === 0
              ? 'border-emerald/30 bg-emerald/5'
              : 'border-clay/30 bg-clay/5'
          }`}
        >
          <span className="eyebrow text-sage">Adimplência</span>
          {loading ? (
            <p className="mt-2 text-sm text-bone-dim">…</p>
          ) : obligations.length === 0 ? (
            <p className="mt-2 text-sm font-medium text-emerald">
              Em dia ✓
            </p>
          ) : (
            <>
              <p className="nums mt-2 text-xl font-semibold text-clay">
                {formatBRL(pendingTotal)}
              </p>
              <p className="mt-1 text-xs text-bone-dim">
                {obligations.length} obrigaç
                {obligations.length === 1 ? 'ão' : 'ões'} pendente
                {obligations.length === 1 ? '' : 's'}
              </p>
            </>
          )}
        </div>
      </div>

      {!loading && obligations.length > 0 && (
        <Alert kind="info">
          Faturas em aberto:{' '}
          {obligations
            .map((o) => formatDate(o.reference_month).slice(3))
            .join(', ')}
          .
        </Alert>
      )}

      <Card
        title="Meu extrato"
        description="Aportes, resgates e despesas vinculados a você."
      >
        {loading ? (
          <p className="text-sm text-bone-dim">Carregando…</p>
        ) : txs.length === 0 ? (
          <p className="text-sm text-bone-dim">Nenhuma movimentação ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="eyebrow pb-2 text-sage">Data</th>
                <th className="eyebrow pb-2 text-sage">Tipo</th>
                <th className="eyebrow pb-2 text-right text-sage">Valor</th>
                <th className="eyebrow pb-2 text-right text-sage">Cotas</th>
              </tr>
            </thead>
            <tbody>
              {txs.map((t) => {
                const burned = t.quotas_amount < 0
                return (
                  <tr key={t.id} className="border-t border-line">
                    <td className="nums py-2.5 text-bone-dim">
                      {formatDate(t.created_at)}
                    </td>
                    <td className="py-2.5 text-bone">
                      {TYPE_LABEL[t.type] ?? t.type}
                      {t.status === 'PENDING_APPROVAL' && (
                        <span className="eyebrow ml-2 rounded-full border border-line px-1.5 py-0.5 text-[0.5rem] text-sage">
                          pendente
                        </span>
                      )}
                      {t.status === 'REJECTED' && (
                        <span className="eyebrow ml-2 rounded-full border border-clay/30 px-1.5 py-0.5 text-[0.5rem] text-clay">
                          rejeitada
                        </span>
                      )}
                    </td>
                    <td className="nums py-2.5 text-right text-bone">
                      {formatBRL(t.amount_brl)}
                    </td>
                    <td
                      className={`nums py-2.5 text-right ${burned ? 'text-clay' : 'text-bone-dim'}`}
                    >
                      {t.quotas_amount === 0
                        ? '—'
                        : `${burned ? '' : '+'}${formatQuotas(t.quotas_amount)}`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}

function Highlight({
  label,
  value,
  hint,
  span2,
}: {
  label: string
  value: string
  hint: string
  span2?: boolean
}) {
  return (
    <section
      className={`relative overflow-hidden rounded-2xl border border-line bg-moss/70 p-5 shadow-[0_1px_0_rgba(255,255,255,0.7)_inset,0_18px_44px_-30px_rgba(40,52,44,0.28)] backdrop-blur-sm ${span2 ? 'sm:col-span-2' : ''}`}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brass/60 to-transparent" />
      <span className="eyebrow text-sage">{label}</span>
      <p className="nums mt-2 text-3xl font-semibold tracking-tight text-bone">
        {value}
      </p>
      <p className="nums mt-1 text-xs text-sage">{hint}</p>
    </section>
  )
}
