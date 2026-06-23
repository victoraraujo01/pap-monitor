import { useEffect, useState } from 'react'
import { supabase } from '@/services/supabase'
import type { Tables } from '@/services/supabase'
import { useAuth } from '@/context/useAuth'
import { Card } from '@/components/ui'
import { formatBRL, formatDate, formatQuotas } from '@/lib/format'

type Tx = Pick<
  Tables<'transactions'>,
  'id' | 'type' | 'status' | 'amount_brl' | 'quotas_amount' | 'event_date'
>
type Obligation = Pick<
  Tables<'v_monthly_obligations'>,
  'id' | 'reference_month' | 'status'
>
type Balance = Pick<
  Tables<'v_cotista_balance'>,
  'balance' | 'withdrawn_total' | 'repayment_outstanding'
>

const TYPE_LABEL: Record<string, string> = {
  APORTE: 'Aporte',
  RESGATE_PESSOAL: 'Resgate pessoal',
  DESPESA_PAIS: 'Despesa dos pais',
  REINVESTIMENTO: 'Reinvestimento',
}

// Rótulo do tipo + selos de status — compartilhado entre a tabela (desktop) e a
// lista empilhada (mobile) do extrato.
function TxTypeLabel({ t }: { t: Tx }) {
  return (
    <>
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
    </>
  )
}

// Texto das cotas (delta assinado) + se houve queima (cor clay).
function txCotas(t: Tx): { text: string; burned: boolean } {
  const burned = t.quotas_amount < 0
  const text =
    t.quotas_amount === 0
      ? '—'
      : `${burned ? '' : '+'}${formatQuotas(t.quotas_amount)}`
  return { text, burned }
}

// CdU 6 — Histórico individual: "quanto eu tenho e estou devendo algo?".
export function MyPatrimony() {
  const { profile } = useAuth()
  const profileId = profile?.id
  const [txs, setTxs] = useState<Tx[]>([])
  const [obligations, setObligations] = useState<Obligation[]>([])
  const [balance, setBalance] = useState(0)
  const [withdrawn, setWithdrawn] = useState(0)
  const [repayOutstanding, setRepayOutstanding] = useState(0)
  const [quotaPrice, setQuotaPrice] = useState(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profileId) return
    Promise.all([
      supabase
        .from('transactions')
        .select('id, type, status, amount_brl, quotas_amount, event_date')
        .eq('profile_id', profileId)
        .order('event_date', { ascending: false })
        .order('created_at', { ascending: false }),
      // Meses ainda em aberto (status derivado pela regra FIFO-90%).
      supabase
        .from('v_monthly_obligations')
        .select('id, reference_month, status')
        .eq('profile_id', profileId)
        .eq('status', 'PENDING')
        .order('reference_month', { ascending: true }),
      // Saldo total (dinheiro exato) + resgate a repor (Σ resgate − Σ reposição).
      supabase
        .from('v_cotista_balance')
        .select('balance, withdrawn_total, repayment_outstanding')
        .eq('profile_id', profileId)
        .maybeSingle(),
      supabase
        .from('pl_history')
        .select('quota_price')
        .order('date', { ascending: false })
        .limit(1),
    ]).then(([t, o, b, p]) => {
      setTxs((t.data as Tx[] | null) ?? [])
      setObligations((o.data as Obligation[] | null) ?? [])
      const bal = b.data as Balance | null
      setBalance(bal?.balance ?? 0)
      setWithdrawn(bal?.withdrawn_total ?? 0)
      setRepayOutstanding(bal?.repayment_outstanding ?? 0)
      // Bootstrap da cota = R$1,00 quando não há histórico ainda.
      const price = (p.data as { quota_price: number }[] | null)?.[0]
        ?.quota_price
      setQuotaPrice(price ?? 1)
      setLoading(false)
    })
  }, [profileId])

  // Cotas líquidas = soma dos deltas assinados das transações APROVADAS.
  const myQuotas = txs
    .filter((t) => t.status === 'APPROVED')
    .reduce((sum, t) => sum + t.quotas_amount, 0)
  const patrimony = myQuotas * quotaPrice

  // Devedor quando o saldo acumulado é positivo (tolerância p/ centavos de troco).
  const owing = balance > 0.005
  const credit = balance < -0.005

  const hasWithdrawals = withdrawn > 0.005
  const owingRepay = repayOutstanding > 0.005

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Highlight
          label="Patrimônio individual"
          value={loading ? '…' : formatBRL(patrimony)}
          hint={`${formatQuotas(myQuotas)} cotas × ${formatBRL(quotaPrice)}`}
        />

        {/* Obrigações mensais + resgate a repor — lado a lado no desktop, cada
            bloco com a cor da sua condição (devendo = clay, em dia = emerald). */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Obrigações mensais (adimplência) */}
          <div
            className={`rounded-2xl border p-5 ${
              loading
                ? 'border-line bg-moss/70'
                : owing
                  ? 'border-clay/30 bg-clay/5'
                  : 'border-emerald/30 bg-emerald/5'
            }`}
          >
            <span className="eyebrow text-sage">Obrigações mensais</span>
            {loading ? (
              <p className="mt-2 text-sm text-bone-dim">…</p>
            ) : owing ? (
              <>
                <p className="nums mt-2 text-xl font-semibold text-clay">
                  {formatBRL(balance)}
                </p>
                <p className="mt-1 text-xs text-bone-dim">
                  saldo devedor
                  {obligations.length > 0 &&
                    ` · ${obligations.length} ${
                      obligations.length === 1 ? 'mês' : 'meses'
                    } em aberto`}
                </p>
                {obligations.length > 0 && (
                  <p className="mt-1 text-xs text-sage">
                    {obligations
                      .map((o) => formatDate(o.reference_month).slice(3))
                      .join(', ')}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="mt-2 text-sm font-medium text-emerald">
                  Em dia ✓
                </p>
                {credit && (
                  <p className="nums mt-1 text-xs text-bone-dim">
                    {formatBRL(-balance)} adiantado
                  </p>
                )}
              </>
            )}
          </div>

          {/* Resgate a repor */}
          <div
            className={`rounded-2xl border p-5 ${
              loading || !hasWithdrawals
                ? 'border-line bg-moss/70'
                : owingRepay
                  ? 'border-clay/30 bg-clay/5'
                  : 'border-emerald/30 bg-emerald/5'
            }`}
          >
            <span className="eyebrow text-sage">Resgate a repor</span>
            {loading ? (
              <p className="mt-2 text-sm text-bone-dim">…</p>
            ) : !hasWithdrawals ? (
              <p className="mt-2 text-sm text-bone-dim">Nenhum resgate.</p>
            ) : owingRepay ? (
              <>
                <p className="nums mt-2 text-xl font-semibold text-clay">
                  {formatBRL(repayOutstanding)}
                </p>
                <p className="nums mt-1 text-xs text-bone-dim">
                  {formatBRL(withdrawn - repayOutstanding)} repostos de{' '}
                  {formatBRL(withdrawn)} resgatados
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm font-medium text-emerald">
                  Reposto ✓
                </p>
                <p className="nums mt-1 text-xs text-bone-dim">
                  {formatBRL(withdrawn)} resgatados e repostos
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      <Card
        title="Meu extrato"
        description="Aportes, resgates e despesas vinculados a você."
      >
        {loading ? (
          <p className="text-sm text-bone-dim">Carregando…</p>
        ) : txs.length === 0 ? (
          <p className="text-sm text-bone-dim">Nenhuma movimentação ainda.</p>
        ) : (
          <>
            {/* Desktop: tabela em 4 colunas. */}
            <table className="hidden w-full text-sm sm:table">
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
                  const { text, burned } = txCotas(t)
                  return (
                    <tr key={t.id} className="border-t border-line">
                      <td className="nums py-2.5 text-bone-dim">
                        {formatDate(t.event_date)}
                      </td>
                      <td className="py-2.5 text-bone">
                        <TxTypeLabel t={t} />
                      </td>
                      <td className="nums py-2.5 text-right text-bone">
                        {formatBRL(t.amount_brl)}
                      </td>
                      <td
                        className={`nums py-2.5 text-right ${burned ? 'text-clay' : 'text-bone-dim'}`}
                      >
                        {text}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Mobile: cada lançamento empilhado (tipo+valor / data+cotas). */}
            <ul className="flex flex-col sm:hidden">
              {txs.map((t) => {
                const { text, burned } = txCotas(t)
                return (
                  <li
                    key={t.id}
                    className="flex items-start justify-between gap-3 border-t border-line py-3 first:border-t-0 first:pt-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-bone">
                        <TxTypeLabel t={t} />
                      </p>
                      <p className="nums mt-0.5 text-xs text-bone-dim">
                        {formatDate(t.event_date)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="nums text-sm text-bone">
                        {formatBRL(t.amount_brl)}
                      </p>
                      <p
                        className={`nums mt-0.5 text-xs ${burned ? 'text-clay' : 'text-bone-dim'}`}
                      >
                        {text}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </Card>
    </div>
  )
}

function Highlight({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-line bg-moss/70 p-5 shadow-[0_1px_0_rgba(255,255,255,0.7)_inset,0_18px_44px_-30px_rgba(40,52,44,0.28)] backdrop-blur-sm"
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
