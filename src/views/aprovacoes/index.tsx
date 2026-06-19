import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '@/services/supabase'
import type { Tables, TransactionType } from '@/services/supabase'
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
type Pending = Pick<
  Tables<'transactions'>,
  'id' | 'amount_brl' | 'created_at' | 'profile_id' | 'target_bond_id'
>

function bondLabel(b: Bond | undefined): string {
  if (!b) return '—'
  return b.display_name ?? b.api_reference_name
}

// CdU 3 (solicitação de saída) + CdU 4 (aprovação de despesa).
// - RESGATE_PESSOAL nasce APPROVED (FIFO + queima das cotas do solicitante).
// - DESPESA_PAIS nasce PENDING_APPROVAL e aparece na lista para outro cotista
//   aprovar/rejeitar (a Regra de Ouro: nenhuma cota é queimada na despesa).
export function AprovacoesView() {
  const { profile } = useAuth()
  const profileId = profile?.id

  const [bonds, setBonds] = useState<Bond[]>([])
  const [profiles, setProfiles] = useState<Map<string, string>>(new Map())
  const [pending, setPending] = useState<Pending[]>([])

  // form de saída
  const [bondId, setBondId] = useState('')
  const [amount, setAmount] = useState('')
  const [type, setType] = useState<TransactionType>('RESGATE_PESSOAL')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // feedback das ações de aprovação
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const bondById = new Map(bonds.map((b) => [b.id, b]))

  const loadPending = useCallback(() => {
    return supabase
      .from('transactions')
      .select('id, amount_brl, created_at, profile_id, target_bond_id')
      .eq('type', 'DESPESA_PAIS')
      .eq('status', 'PENDING_APPROVAL')
      .order('created_at', { ascending: true })
      .then(({ data }) => setPending(data ?? []))
  }, [])

  useEffect(() => {
    supabase
      .from('treasury_bonds')
      .select('id, api_reference_name, display_name')
      .order('api_reference_name')
      .then(({ data }) => setBonds(data ?? []))
    supabase
      .from('profiles')
      .select('id, name')
      .then(({ data }) =>
        setProfiles(new Map((data ?? []).map((p) => [p.id, p.name]))),
      )
    loadPending()
  }, [loadPending])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profileId) return
    setError(null)
    setSuccess(null)
    setSubmitting(true)

    const { error } = await supabase.rpc('request_withdrawal', {
      p_profile_id: profileId,
      p_bond_id: bondId,
      p_amount_brl: Number(amount),
      p_type: type,
    })

    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    setSuccess(
      type === 'RESGATE_PESSOAL'
        ? `Resgate de ${formatBRL(Number(amount))} efetuado.`
        : `Despesa de ${formatBRL(Number(amount))} registrada e aguardando aprovação de outro cotista.`,
    )
    setAmount('')
    setBondId('')
    if (type === 'DESPESA_PAIS') loadPending()
  }

  async function decide(txn: Pending, approve: boolean) {
    if (!profileId) return
    setActionMsg(null)
    setActionErr(null)
    setBusyId(txn.id)

    const { error } = await supabase.rpc(
      approve ? 'approve_expense' : 'reject_expense',
      { p_transaction_id: txn.id, p_approver_id: profileId },
    )

    setBusyId(null)
    if (error) {
      setActionErr(error.message)
      return
    }
    setActionMsg(approve ? 'Despesa aprovada.' : 'Despesa rejeitada.')
    loadPending()
  }

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Solicitar saída"
        description="Resgate pessoal queima suas cotas equivalentes ao valor sacado. Despesa dos pais não queima cotas de ninguém — fica pendente de aprovação de outro cotista."
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Tipo de saída">
            <Select
              value={type}
              onChange={(v) => setType(v as TransactionType)}
            >
              <option value="RESGATE_PESSOAL">Resgate pessoal</option>
              <option value="DESPESA_PAIS">Despesa dos pais</option>
            </Select>
          </Field>

          <Field label="Título">
            <Select
              value={bondId}
              onChange={setBondId}
              required
              disabled={bonds.length === 0}
            >
              <option value="" disabled>
                Selecione um título
              </option>
              {bonds.map((b) => (
                <option key={b.id} value={b.id}>
                  {bondLabel(b)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Valor a sacar (R$)">
            <NumberInput
              value={amount}
              onChange={setAmount}
              step="0.01"
              min="0"
              placeholder="0,00"
            />
          </Field>

          {error && <Alert kind="error">{error}</Alert>}
          {success && <Alert kind="success">{success}</Alert>}

          <div>
            <Button type="submit" disabled={submitting || !bondId}>
              {submitting ? 'Processando…' : 'Solicitar saída'}
            </Button>
          </div>
        </form>
      </Card>

      <Card
        title="Despesas pendentes de aprovação"
        description="Aprovação por outro cotista (você não pode aprovar a sua própria solicitação)."
      >
        {actionMsg && <Alert kind="success">{actionMsg}</Alert>}
        {actionErr && <Alert kind="error">{actionErr}</Alert>}

        {pending.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma despesa pendente.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((t) => {
              const own = t.profile_id === profileId
              return (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 p-3"
                >
                  <div className="text-sm">
                    <p className="font-semibold text-slate-900">
                      {formatBRL(t.amount_brl)} ·{' '}
                      {bondLabel(
                        t.target_bond_id
                          ? bondById.get(t.target_bond_id)
                          : undefined,
                      )}
                    </p>
                    <p className="text-slate-500">
                      Solicitado por{' '}
                      {t.profile_id ? (profiles.get(t.profile_id) ?? '—') : '—'}{' '}
                      em {formatDate(t.created_at)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {own ? (
                      <span className="text-xs text-slate-400">
                        Aguardando outro cotista
                      </span>
                    ) : (
                      <>
                        <Button
                          variant="primary"
                          disabled={busyId === t.id}
                          onClick={() => decide(t, true)}
                        >
                          Aprovar
                        </Button>
                        <Button
                          variant="danger"
                          disabled={busyId === t.id}
                          onClick={() => decide(t, false)}
                        >
                          Rejeitar
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
