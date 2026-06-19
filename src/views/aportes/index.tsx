import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '@/services/supabase'
import type { Tables } from '@/services/supabase'
import { useAuth } from '@/context/useAuth'
import {
  Alert,
  Button,
  Card,
  Field,
  NumberInput,
  Select,
} from '@/components/ui'
import { formatBRL, formatDate } from '@/lib/format'

type Bond = Pick<
  Tables<'treasury_bonds'>,
  'id' | 'api_reference_name' | 'display_name'
>
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
  const [recent, setRecent] = useState<Aporte[]>([])
  const [bondId, setBondId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const profileId = profile?.id

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
  }, [])

  useEffect(() => {
    if (profileId) loadRecent(profileId)
  }, [profileId, loadRecent])

  const qtyNum = Number(quantity)
  const priceNum = Number(price)
  const previewValue =
    qtyNum > 0 && priceNum > 0 ? formatBRL(qtyNum * priceNum) : '—'

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
      p_purchase_price: priceNum,
    })

    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    setSuccess(`Aporte de ${formatBRL(qtyNum * priceNum)} registrado.`)
    setQuantity('')
    setPrice('')
    setBondId('')
    loadRecent(profileId)
  }

  return (
    <div className="animate-rise flex flex-col gap-6">
      <Card
        title="Registrar aporte"
        description="Compra de um título disponível no catálogo. As cotas são geradas pela última cotação conhecida e as obrigações pendentes mais antigas são quitadas."
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
                step="0.01"
                min="0"
                placeholder="0,00"
              />
            </Field>
            <Field
              label="Preço de compra (unidade)"
              hint="Valor pago por unidade"
            >
              <NumberInput
                value={price}
                onChange={setPrice}
                step="0.01"
                min="0"
                placeholder="0,00"
              />
            </Field>
          </div>

          <div className="flex items-baseline justify-between rounded-lg border border-line bg-pine/50 px-4 py-3">
            <span className="eyebrow text-sage">Valor total do aporte</span>
            <span className="nums text-lg font-semibold text-brass">
              {previewValue}
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
