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
  'id' | 'amount_brl' | 'quotas_amount' | 'created_at'
>

// CdU 2 — Registro de aporte. O dropdown traz só títulos disponíveis para compra;
// a RPC register_aporte cria a transação, gera cotas pela última cotação, grava o
// lote e dá baixa nas obrigações pendentes.
export function AportesView() {
  const { profile } = useAuth()
  const [bonds, setBonds] = useState<Bond[]>([])
  const [allBonds, setAllBonds] = useState<Bond[]>([])
  const [recent, setRecent] = useState<Aporte[]>([])
  const [bondId, setBondId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [amount, setAmount] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const profileId = profile?.id
  // Qualquer cotista pode informar a data do aporte (vazio = hoje).
  const todayStr = new Date().toISOString().slice(0, 10)

  const loadRecent = useCallback((pid: string) => {
    return supabase
      .from('transactions')
      .select('id, amount_brl, quotas_amount, created_at')
      .eq('profile_id', pid)
      .eq('type', 'APORTE')
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

  useEffect(() => {
    if (profileId) loadRecent(profileId)
  }, [profileId, loadRecent])

  const qtyNum = Number(quantity)
  const amountNum = Number(amount)
  // Preço unitário derivado (só informativo) = valor total / quantidade.
  const unitPreview =
    qtyNum > 0 && amountNum > 0 ? formatBRL(amountNum / qtyNum) : '—'

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
    loadRecent(profileId)
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Quantidade" hint="Unidades do título compradas">
              <NumberInput
                value={quantity}
                onChange={setQuantity}
                step="0.000001"
                min="0"
                placeholder="0,000000"
              />
            </Field>
            <Field
              label="Valor total aportado (R$)"
              hint="Total pago no aporte"
            >
              <NumberInput
                value={amount}
                onChange={setAmount}
                step="0.01"
                min="0"
                placeholder="0,00"
              />
            </Field>
          </div>

          <Field
            label="Data do aporte"
            hint="Quando o aporte foi feito. Vazio = hoje. Lançamentos retroativos têm as cotas ajustadas no rebuild."
          >
            <DateInput
              value={eventDate}
              onChange={setEventDate}
              max={todayStr}
              required={false}
            />
          </Field>

          <div className="flex items-baseline justify-between rounded-lg border border-line bg-pine/50 px-4 py-3">
            <span className="eyebrow text-sage">Preço médio por unidade</span>
            <span className="nums text-lg font-semibold text-brass">
              {unitPreview}
            </span>
          </div>

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
          <table className="w-full text-sm">
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
                    {formatDate(t.created_at)}
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
              className="flex flex-col gap-3 rounded-lg border border-line bg-raised/60 p-3 sm:flex-row sm:items-end"
            >
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
              <div className="sm:w-36">
                <Field label="Quantidade" hint="Unidades">
                  <NumberInput
                    value={t.qty}
                    onChange={(v) => updateTarget(i, { qty: v })}
                    step="0.000001"
                    min="0"
                    placeholder="0,000000"
                  />
                </Field>
              </div>
              <div className="sm:w-40">
                <Field label="Valor (R$)" hint="Reaplicado">
                  <NumberInput
                    value={t.amount}
                    onChange={(v) => updateTarget(i, { amount: v })}
                    step="0.01"
                    min="0"
                    placeholder="0,00"
                  />
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
