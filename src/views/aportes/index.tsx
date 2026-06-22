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

// Reinvestimento (vencimento / rebalanceamento): rotação de carteira. Liquida unidades
// de um título de ORIGEM e abre um lote do título de DESTINO. Não entra dinheiro novo,
// não minta/queima cota de ninguém e NÃO conta como contribuição mensal — só o PL muda
// se o valor reaplicado diferir do recebido. RPC register_reinvestment.
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
  const [targetId, setTargetId] = useState('')
  const [targetQty, setTargetQty] = useState('')
  const [targetAmount, setTargetAmount] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const tgtQtyNum = Number(targetQty)
  const tgtAmountNum = Number(targetAmount)
  const unitPreview =
    tgtQtyNum > 0 && tgtAmountNum > 0
      ? formatBRL(tgtAmountNum / tgtQtyNum)
      : '—'

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    if (sourceId && sourceId === targetId) {
      setError('Origem e destino devem ser títulos diferentes.')
      return
    }
    setSubmitting(true)
    const { error } = await supabase.rpc('register_reinvestment', {
      p_profile_id: profileId,
      p_source_bond_id: sourceId,
      p_source_quantity: Number(sourceQty),
      p_target_bond_id: targetId,
      p_target_quantity: tgtQtyNum,
      p_target_amount_brl: tgtAmountNum,
      ...(eventDate ? { p_event_date: eventDate } : {}),
    })
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    setSuccess(`Reinvestimento de ${formatBRL(tgtAmountNum)} registrado.`)
    setSourceId('')
    setSourceQty('')
    setTargetId('')
    setTargetQty('')
    setTargetAmount('')
    setEventDate('')
  }

  return (
    <Card
      title="Reinvestimento"
      description="Rotação de carteira (vencimento ou rebalanceamento): liquida um título e reaplica o caixa em outro. Não conta como aporte mensal — nenhuma cota é gerada ou queimada."
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Título de destino" hint="Onde o caixa foi reaplicado">
            <Select
              value={targetId}
              onChange={setTargetId}
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
          <Field label="Quantidade comprada" hint="Unidades do destino">
            <NumberInput
              value={targetQty}
              onChange={setTargetQty}
              step="0.000001"
              min="0"
              placeholder="0,000000"
            />
          </Field>
        </div>

        <Field
          label="Valor reaplicado (R$)"
          hint="Total investido no título de destino"
        >
          <NumberInput
            value={targetAmount}
            onChange={setTargetAmount}
            step="0.01"
            min="0"
            placeholder="0,00"
          />
        </Field>

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

        <div className="flex items-baseline justify-between rounded-lg border border-line bg-pine/50 px-4 py-3">
          <span className="eyebrow text-sage">Preço médio do destino</span>
          <span className="nums text-lg font-semibold text-brass">
            {unitPreview}
          </span>
        </div>

        {error && <Alert kind="error">{error}</Alert>}
        {success && <Alert kind="success">{success}</Alert>}

        <div>
          <Button type="submit" disabled={submitting || !sourceId || !targetId}>
            {submitting ? 'Registrando…' : 'Registrar reinvestimento'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
