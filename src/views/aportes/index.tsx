import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '@/services/supabase'
import type { Tables } from '@/services/supabase'
import { useAuth } from '@/context/useAuth'
import {
  Alert,
  Button,
  Card,
  DateInput,
  Field,
  NumberInput,
  Select,
} from '@/components/ui'
import { TreasuryAmountInput } from '@/components/TreasuryAmountInput'
import { formatBRL, formatDate } from '@/lib/format'

type Bond = Pick<
  Tables<'treasury_bonds'>,
  'id' | 'api_reference_name' | 'display_name'
>

function bondLabel(b: Bond): string {
  return b.display_name ?? b.api_reference_name
}
type Aporte = Pick<
  Tables<'transactions'>,
  'id' | 'amount_brl' | 'quotas_amount' | 'event_date'
>

// CdU 2 — Registro de aporte. O dropdown traz só títulos disponíveis para compra;
// a RPC register_aporte cria a transação, gera cotas pela última cotação e grava o
// lote. O valor pode se dividir entre obrigação mensal e reposição de resgate
// (p_reposition_amount) quando o cotista tem saldo de resgate a repor.
export function AportesView() {
  const { profile } = useAuth()
  const [bonds, setBonds] = useState<Bond[]>([])
  const [allBonds, setAllBonds] = useState<Bond[]>([])
  const [recent, setRecent] = useState<Aporte[]>([])
  const [bondId, setBondId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [amount, setAmount] = useState('')
  const [eventDate, setEventDate] = useState('')
  // Divisão obrigação mensal × reposição de resgate. `repoOverride` = null usa a
  // sugestão automática; string = valor digitado pelo cotista.
  const [repoOverride, setRepoOverride] = useState<string | null>(null)
  const [outstanding, setOutstanding] = useState(0)
  const [monthly, setMonthly] = useState(1000)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const profileId = profile?.id
  // Qualquer cotista pode informar a data do aporte (vazio = hoje).
  const todayStr = new Date().toISOString().slice(0, 10)

  const loadRecent = useCallback((pid: string) => {
    return supabase
      .from('transactions')
      .select('id, amount_brl, quotas_amount, event_date')
      .eq('profile_id', pid)
      .eq('type', 'APORTE')
      .order('event_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(5)
      .then(({ data }) => setRecent(data ?? []))
  }, [])

  useEffect(() => {
    supabase
      .from('treasury_bonds')
      .select('id, api_reference_name, display_name')
      .eq('is_available_for_purchase', true)
      .order('api_reference_name')
      .then(({ data }) => setBonds(data ?? []))
    // Origem de um reinvestimento pode ser qualquer título (inclusive já vencido /
    // fora de venda), então o catálogo completo também é carregado.
    supabase
      .from('treasury_bonds')
      .select('id, api_reference_name, display_name')
      .order('api_reference_name')
      .then(({ data }) => setAllBonds(data ?? []))
  }, [])

  const loadRepayment = useCallback((pid: string) => {
    // Saldo de resgate a repor + valor da mensalidade corrente (p/ sugerir a divisão).
    supabase
      .from('v_cotista_balance')
      .select('repayment_outstanding')
      .eq('profile_id', pid)
      .maybeSingle()
      .then(({ data }) => setOutstanding(Math.max(0, data?.repayment_outstanding ?? 0)))
    supabase
      .from('v_monthly_obligations')
      .select('amount_expected')
      .eq('profile_id', pid)
      .order('reference_month', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setMonthly(data?.amount_expected ?? 1000))
  }, [])

  useEffect(() => {
    if (profileId) {
      loadRecent(profileId)
      loadRepayment(profileId)
    }
  }, [profileId, loadRecent, loadRepayment])

  const qtyNum = Number(quantity)
  const amountNum = Number(amount)
  // Divisão sugerida: cobre 1 mensalidade na obrigação, excedente vai para reposição
  // (limitado ao que ainda falta repor). Cotista ajusta no campo abaixo.
  const repoMax = Math.min(amountNum > 0 ? amountNum : 0, outstanding)
  const suggestedRepo =
    amountNum > 0 && outstanding > 0
      ? Math.min(Math.max(amountNum - monthly, 0), repoMax)
      : 0
  const repoNum =
    repoOverride === null
      ? suggestedRepo
      : Math.min(Math.max(Number(repoOverride) || 0, 0), repoMax)
  const obligationPart = amountNum > 0 ? Math.max(amountNum - repoNum, 0) : 0
  const showSplit = outstanding > 0 && amountNum > 0

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profileId) return
    setError(null)
    setSuccess(null)
    setSubmitting(true)

    const { error } = await supabase.rpc('register_aporte', {
      p_profile_id: profileId,
      p_bond_id: bondId,
      p_quantity: qtyNum,
      p_amount_brl: amountNum,
      // Data informada pelo cotista; vazio = hoje (default da RPC).
      ...(eventDate ? { p_event_date: eventDate } : {}),
      ...(repoNum > 0 ? { p_reposition_amount: repoNum } : {}),
    })

    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    setSuccess(`Aporte de ${formatBRL(amountNum)} registrado.`)
    setQuantity('')
    setAmount('')
    setBondId('')
    setEventDate('')
    setRepoOverride(null)
    loadRecent(profileId)
    loadRepayment(profileId)
  }

  return (
    <div className="animate-rise flex flex-col gap-6">
      <Card
        title="Registrar aporte"
        description="Compra de um título disponível no catálogo. As cotas são geradas pela última cotação conhecida; a adimplência do mês é derivada do total aportado."
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Título">
            <Select
              value={bondId}
              onChange={setBondId}
              required
              disabled={bonds.length === 0}
            >
              <option value="" disabled>
                {bonds.length === 0
                  ? 'Nenhum título disponível'
                  : 'Selecione um título'}
              </option>
              {bonds.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.display_name ?? b.api_reference_name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Data do aporte"
            hint="Quando o aporte foi feito. Vazio = hoje. As cotas e a curva de PL são recompostas automaticamente ao registrar."
          >
            <DateInput
              value={eventDate}
              onChange={setEventDate}
              max={todayStr}
              required={false}
            />
          </Field>

          <TreasuryAmountInput
            bondId={bondId}
            date={eventDate}
            priceSide="buy"
            quantity={quantity}
            amount={amount}
            onQuantityChange={setQuantity}
            onAmountChange={setAmount}
            quantityHint="Unidades do título compradas"
            amountLabel="Valor total aportado (R$)"
            amountHint="Total pago no aporte"
          />

          {showSplit && (
            <div className="flex flex-col gap-3 rounded-lg border border-brass/30 bg-pine/40 p-4">
              <div className="flex items-baseline justify-between">
                <span className="eyebrow text-sage">Divisão do aporte</span>
                <span className="text-xs text-bone-dim">
                  Resgate a repor: {formatBRL(outstanding)}
                </span>
              </div>
              <Field
                label="Destinado à reposição de resgate (R$)"
                hint="Esta parte abate o resgate pessoal e NÃO conta como mensalidade. Sugestão: cobrir 1 mensalidade e repor o excedente."
              >
                <NumberInput
                  value={repoOverride === null ? String(repoNum) : repoOverride}
                  onChange={setRepoOverride}
                  step="0.01"
                  min="0"
                  placeholder="0,00"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-line bg-raised/60 px-3 py-2">
                  <span className="eyebrow text-sage">Obrigação mensal</span>
                  <p className="nums mt-0.5 font-semibold text-bone">
                    {formatBRL(obligationPart)}
                  </p>
                </div>
                <div className="rounded-lg border border-line bg-raised/60 px-3 py-2">
                  <span className="eyebrow text-sage">Reposição</span>
                  <p className="nums mt-0.5 font-semibold text-brass">
                    {formatBRL(repoNum)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {error && <Alert kind="error">{error}</Alert>}
          {success && <Alert kind="success">{success}</Alert>}

          <div>
            <Button type="submit" disabled={submitting || !bondId}>
              {submitting ? 'Registrando…' : 'Registrar aporte'}
            </Button>
          </div>
        </form>
      </Card>

      {profileId && (
        <ReinvestmentCard
          profileId={profileId}
          sourceBonds={allBonds}
          targetBonds={bonds}
          todayStr={todayStr}
        />
      )}

      <Card title="Meus aportes recentes">
        {recent.length === 0 ? (
          <p className="text-sm text-bone-dim">Nenhum aporte ainda.</p>
        ) : (
          <>
            {/* Desktop: tabela em 3 colunas. */}
            <table className="hidden w-full text-sm sm:table">
              <thead>
                <tr className="text-left">
                  <th className="eyebrow pb-2 text-sage">Data</th>
                  <th className="eyebrow pb-2 text-sage">Valor</th>
                  <th className="eyebrow pb-2 text-right text-sage">Cotas</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((t) => (
                  <tr key={t.id} className="border-t border-line">
                    <td className="nums py-2.5 text-bone-dim">
                      {formatDate(t.event_date)}
                    </td>
                    <td className="nums py-2.5 text-bone">
                      {formatBRL(t.amount_brl)}
                    </td>
                    <td className="nums py-2.5 text-right text-bone-dim">
                      {t.quotas_amount.toLocaleString('pt-BR', {
                        maximumFractionDigits: 4,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile: cada aporte empilhado (valor+data / cotas). */}
            <ul className="flex flex-col sm:hidden">
              {recent.map((t) => (
                <li
                  key={t.id}
                  className="flex items-start justify-between gap-3 border-t border-line py-3 first:border-t-0 first:pt-0"
                >
                  <div className="min-w-0">
                    <p className="nums text-sm text-bone">
                      {formatBRL(t.amount_brl)}
                    </p>
                    <p className="nums mt-0.5 text-xs text-bone-dim">
                      {formatDate(t.event_date)}
                    </p>
                  </div>
                  <p className="nums shrink-0 text-sm text-bone-dim">
                    {t.quotas_amount.toLocaleString('pt-BR', {
                      maximumFractionDigits: 4,
                    })}{' '}
                    cotas
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  )
}

type TargetRow = { bondId: string; qty: string; amount: string }

// Resultado de reinvestment_source_proceeds: bruto/IR/líquido da origem resgatada.
type Proceeds = {
  gross: number
  ir: number
  net: number
  available: number
  priced: boolean
}

const emptyTarget = (): TargetRow => ({ bondId: '', qty: '', amount: '' })

// Reinvestimento (vencimento / rebalanceamento): rotação de carteira. Liquida unidades
// de um título de ORIGEM e reaplica o caixa em UM OU MAIS títulos de destino, numa só
// transação (N lotes). Não entra dinheiro novo, não minta/queima cota de ninguém e NÃO
// conta como contribuição mensal. O bruto da origem (qtd × preço da data) menos o IR
// (FIFO sobre os lotes) dá o LÍQUIDO reaplicável; a soma dos destinos precisa bater com
// ele (continuidade de PL). RPC register_reinvestment.
function ReinvestmentCard({
  profileId,
  sourceBonds,
  targetBonds,
  todayStr,
}: {
  profileId: string
  sourceBonds: Bond[]
  targetBonds: Bond[]
  todayStr: string
}) {
  const [sourceId, setSourceId] = useState('')
  const [sourceQty, setSourceQty] = useState('')
  const [targets, setTargets] = useState<TargetRow[]>([emptyTarget()])
  const [eventDate, setEventDate] = useState('')
  const [proceeds, setProceeds] = useState<Proceeds | null>(null)
  const [proceedsLoading, setProceedsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const sourceQtyNum = Number(sourceQty)

  // Busca bruto/IR/líquido da origem sempre que origem/quantidade/data mudam (debounce).
  // Todo setState fica nos callbacks assíncronos (nunca síncrono no corpo do efeito).
  useEffect(() => {
    if (!sourceId || !(sourceQtyNum > 0)) return
    let cancelled = false
    const timer = setTimeout(async () => {
      setProceedsLoading(true)
      const { data, error } = await supabase.rpc(
        'reinvestment_source_proceeds',
        {
          p_bond_id: sourceId,
          p_quantity: sourceQtyNum,
          ...(eventDate ? { p_date: eventDate } : {}),
        },
      )
      if (cancelled) return
      setProceedsLoading(false)
      setProceeds(error || !data ? null : (data as unknown as Proceeds))
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [sourceId, sourceQtyNum, eventDate])

  // Origem/quantidade inválidas: nada de líquido (o painel cai no prompt). Mantido fora
  // do efeito de fetch para não disparar setState síncrono e para zerar valor obsoleto.
  const proceedsValid = !!sourceId && sourceQtyNum > 0
  const shownProceeds = proceedsValid ? proceeds : null

  const net = shownProceeds?.net ?? null
  const sumDest = targets.reduce((s, t) => s + (Number(t.amount) || 0), 0)
  const remaining = net != null ? net - sumDest : null
  // Trava de conferência: a soma dos destinos precisa bater com o líquido (±R$0,01).
  // Quando não há líquido calculável (origem sem preço/posição) não há como ancorar.
  const matches =
    net != null && net > 0 ? Math.abs(remaining ?? 0) <= 0.01 : null

  function updateTarget(i: number, patch: Partial<TargetRow>) {
    setTargets((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }
  function addTarget() {
    setTargets((rows) => [...rows, emptyTarget()])
  }
  function removeTarget(i: number) {
    setTargets((rows) =>
      rows.length === 1 ? rows : rows.filter((_, j) => j !== i),
    )
  }

  const targetsValid = targets.every(
    (t) => t.bondId && Number(t.qty) > 0 && Number(t.amount) > 0,
  )
  const sourceClash = targets.some((t) => t.bondId && t.bondId === sourceId)
  const filledTargetIds = targets.map((t) => t.bondId).filter(Boolean)
  const hasDup = new Set(filledTargetIds).size !== filledTargetIds.length
  const canSubmit =
    !submitting &&
    !!sourceId &&
    sourceQtyNum > 0 &&
    targetsValid &&
    !sourceClash &&
    !hasDup &&
    matches !== false

  function resetForm() {
    setSourceId('')
    setSourceQty('')
    setTargets([emptyTarget()])
    setEventDate('')
    setProceeds(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    if (sourceClash) {
      setError('Origem e destino devem ser títulos diferentes.')
      return
    }
    if (hasDup) {
      setError('Cada título de destino só pode aparecer uma vez.')
      return
    }
    setSubmitting(true)
    const { error } = await supabase.rpc('register_reinvestment', {
      p_profile_id: profileId,
      p_source_bond_id: sourceId,
      p_source_quantity: sourceQtyNum,
      p_targets: targets.map((t) => ({
        bond_id: t.bondId,
        quantity: Number(t.qty),
        amount_brl: Number(t.amount),
      })),
      ...(eventDate ? { p_event_date: eventDate } : {}),
    })
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    setSuccess(`Reinvestimento de ${formatBRL(sumDest)} registrado.`)
    resetForm()
  }

  return (
    <Card
      title="Reinvestimento"
      description="Rotação de carteira (vencimento ou rebalanceamento): liquida um título e reaplica o caixa em um ou mais outros. Não conta como aporte mensal — nenhuma cota é gerada ou queimada."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Título de origem" hint="O que venceu ou foi vendido">
            <Select
              value={sourceId}
              onChange={setSourceId}
              required
              disabled={sourceBonds.length === 0}
            >
              <option value="" disabled>
                Selecione um título
              </option>
              {sourceBonds.map((b) => (
                <option key={b.id} value={b.id}>
                  {bondLabel(b)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Quantidade resgatada" hint="Unidades da origem que saíram">
            <NumberInput
              value={sourceQty}
              onChange={setSourceQty}
              step="0.000001"
              min="0"
              placeholder="0,000000"
            />
          </Field>
        </div>

        <Field
          label="Data do reinvestimento"
          hint="Quando a rotação ocorreu. Vazio = hoje."
        >
          <DateInput
            value={eventDate}
            onChange={setEventDate}
            max={todayStr}
            required={false}
          />
        </Field>

        {/* Bruto → IR → líquido da origem (líquido = caixa a reaplicar). */}
        <div className="rounded-lg border border-line bg-pine/40 px-4 py-3">
          {proceedsValid ? (
            proceedsLoading || !shownProceeds ? (
              <span className="text-sm text-sage">calculando líquido…</span>
            ) : shownProceeds.priced ? (
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <span className="eyebrow text-sage">
                  Bruto{' '}
                  <span className="nums ml-1 text-bone-dim">
                    {formatBRL(shownProceeds.gross)}
                  </span>
                </span>
                <span className="eyebrow text-sage">
                  IR{' '}
                  <span className="nums ml-1 text-clay">
                    −{formatBRL(shownProceeds.ir)}
                  </span>
                </span>
                <span className="eyebrow text-sage">
                  Líquido a reaplicar{' '}
                  <span className="nums ml-1 text-lg font-semibold text-brass">
                    {formatBRL(shownProceeds.net)}
                  </span>
                </span>
              </div>
            ) : (
              <span className="text-sm text-bone-dim">
                Sem preço de referência da origem — não foi possível calcular o
                líquido. Informe os valores dos destinos manualmente.
              </span>
            )
          ) : (
            <span className="text-sm text-sage">
              Informe origem e quantidade para calcular o líquido (bruto − IR).
            </span>
          )}
        </div>

        {/* Destinos: um ou mais títulos onde o caixa foi reaplicado. */}
        <div className="flex flex-col gap-3">
          <span className="eyebrow text-sage">Destinos do reinvestimento</span>
          {targets.map((t, i) => (
            <div
              key={i}
              className="flex flex-col gap-3 rounded-lg border border-line bg-raised/60 p-3"
            >
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <Field label="Título de destino" hint="Onde reaplicou">
                    <Select
                      value={t.bondId}
                      onChange={(v) => updateTarget(i, { bondId: v })}
                      required
                      disabled={targetBonds.length === 0}
                    >
                      <option value="" disabled>
                        Selecione um título
                      </option>
                      {targetBonds.map((b) => (
                        <option key={b.id} value={b.id}>
                          {bondLabel(b)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <button
                  type="button"
                  onClick={() => removeTarget(i)}
                  disabled={targets.length === 1}
                  title="Remover destino"
                  className="h-[42px] rounded-lg border border-line px-3 text-sm text-bone-dim transition-colors hover:border-clay/50 hover:text-clay disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-bone-dim"
                >
                  Remover
                </button>
              </div>
              <TreasuryAmountInput
                bondId={t.bondId}
                date={eventDate}
                priceSide="buy"
                quantity={t.qty}
                amount={t.amount}
                onQuantityChange={(v) => updateTarget(i, { qty: v })}
                onAmountChange={(v) => updateTarget(i, { amount: v })}
                quantityHint="Unidades"
                amountLabel="Valor (R$)"
                amountHint="Reaplicado"
              />
            </div>
          ))}
          <div>
            <Button type="button" variant="secondary" onClick={addTarget}>
              + Adicionar destino
            </Button>
          </div>
        </div>

        {/* Conferência: soma dos destinos vs. líquido a reaplicar. */}
        <div
          className={`flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 rounded-lg border px-4 py-3 ${
            matches === false
              ? 'border-clay/40 bg-clay/5'
              : matches === true
                ? 'border-brass/40 bg-pine/50'
                : 'border-line bg-pine/30'
          }`}
        >
          <span className="eyebrow text-sage">
            Soma dos destinos{' '}
            <span className="nums ml-1 text-bone">{formatBRL(sumDest)}</span>
          </span>
          {net != null && net > 0 && (
            <span
              className={`eyebrow ${matches === false ? 'text-clay' : 'text-brass'}`}
            >
              {matches === false
                ? remaining != null && remaining > 0
                  ? `Faltam ${formatBRL(remaining)}`
                  : `Excede ${formatBRL(Math.abs(remaining ?? 0))}`
                : 'Confere com o líquido'}
            </span>
          )}
        </div>

        {error && <Alert kind="error">{error}</Alert>}
        {success && <Alert kind="success">{success}</Alert>}

        <div>
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? 'Registrando…' : 'Registrar reinvestimento'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
