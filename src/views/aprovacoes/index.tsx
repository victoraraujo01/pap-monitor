import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '@/services/supabase'
import type { Tables } from '@/services/supabase'
import { useAuth } from '@/context/useAuth'
import { Alert, Button, Card } from '@/components/ui'
import { OperationFields } from '@/components/OperationFields'
import {
  emptyOperationValues,
  type OperationKind,
  type OperationValues,
} from '@/lib/operations'
import { TYPE_LABELS } from '@/lib/events'
import { formatBRL, formatDate } from '@/lib/format'

type Bond = Pick<
  Tables<'treasury_bonds'>,
  'id' | 'api_reference_name' | 'display_name'
>
type Pending = Pick<
  Tables<'transactions'>,
  'id' | 'amount_brl' | 'event_date' | 'profile_id' | 'target_bond_id'
>
type Solicitacao = Pick<
  Tables<'transactions'>,
  'id' | 'type' | 'amount_brl' | 'status' | 'event_date' | 'target_bond_id'
>

function bondLabel(b: Bond | undefined): string {
  if (!b) return '—'
  return b.display_name ?? b.api_reference_name
}

const STATUS_LABELS: Record<string, string> = {
  APPROVED: 'Aprovado',
  PENDING_APPROVAL: 'Pendente',
}
const STATUS_STYLES: Record<string, string> = {
  APPROVED: 'border border-emerald/30 bg-emerald/10 text-emerald',
  PENDING_APPROVAL: 'border border-brass/30 bg-brass/10 text-brass-bright',
}

// Saídas do fundo. Toda saída é sinalizada igual (quantidade + valor bruto + data).
// Três caminhos: resgate pessoal direto; despesa proposta (pendente, classificada
// por outro cotista: aprova → despesa, reprova → vira resgate do solicitante);
// despesa direta (admin, já aprovada).
export function AprovacoesView() {
  const { profile } = useAuth()
  const profileId = profile?.id
  const isAdmin = profile?.role === 'ADMIN'
  const todayStr = new Date().toISOString().slice(0, 10)

  const [bonds, setBonds] = useState<Bond[]>([])
  const [profiles, setProfiles] = useState<Map<string, string>>(new Map())
  const [pending, setPending] = useState<Pending[]>([])
  const [mine, setMine] = useState<Solicitacao[]>([])

  // form de saída
  const [values, setValues] = useState<OperationValues>(emptyOperationValues())
  // Resgate pessoal direto, despesa proposta, ou despesa direta (admin, já aprovada).
  const [kind, setKind] = useState<OperationKind>('RESGATE_PESSOAL')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // feedback das ações de classificação
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const bondById = new Map(bonds.map((b) => [b.id, b]))

  const loadPending = useCallback(() => {
    return supabase
      .from('transactions')
      .select('id, amount_brl, event_date, profile_id, target_bond_id')
      .eq('type', 'DESPESA_PAIS')
      .eq('status', 'PENDING_APPROVAL')
      .order('event_date', { ascending: true })
      .order('created_at', { ascending: true })
      .then(({ data }) => setPending(data ?? []))
  }, [])

  const loadMine = useCallback((pid: string) => {
    return supabase
      .from('transactions')
      .select('id, type, amount_brl, status, event_date, target_bond_id')
      .eq('profile_id', pid)
      .in('type', ['RESGATE_PESSOAL', 'DESPESA_PAIS'])
      .order('event_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(8)
      .then(({ data }) => setMine(data ?? []))
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

  useEffect(() => {
    if (profileId) loadMine(profileId)
  }, [profileId, loadMine])

  function patch(p: Partial<OperationValues>) {
    setValues((v) => ({ ...v, ...p }))
  }

  // Opções de saída: resgate, despesa proposta e — só para admin — despesa direta.
  const kinds: OperationKind[] = isAdmin
    ? ['RESGATE_PESSOAL', 'DESPESA_PAIS', 'DESPESA_DIRETA']
    : ['RESGATE_PESSOAL', 'DESPESA_PAIS']

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profileId) return
    setError(null)
    setSuccess(null)
    setSubmitting(true)

    // Despesa direta (admin) nasce já aprovada, sem classificação por outro cotista.
    const direct = kind === 'DESPESA_DIRETA' && isAdmin
    const pType = kind === 'RESGATE_PESSOAL' ? 'RESGATE_PESSOAL' : 'DESPESA_PAIS'
    const { error } = await supabase.rpc('request_withdrawal', {
      p_profile_id: profileId,
      p_bond_id: values.bondId,
      p_quantity: Number(values.quantity),
      p_amount_brl: Number(values.amount),
      p_type: pType,
      ...(direct ? { p_direct: true } : {}),
      // Data da saída — qualquer cotista pode informar; vazio = hoje.
      ...(values.eventDate ? { p_event_date: values.eventDate } : {}),
      ...(values.note.trim() ? { p_note: values.note.trim() } : {}),
    })

    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    const v = formatBRL(Number(values.amount))
    setSuccess(
      kind === 'RESGATE_PESSOAL'
        ? `Resgate de ${v} efetuado.`
        : direct
          ? `Despesa de ${v} lançada e aprovada.`
          : `Saída de ${v} registrada como proposta de despesa; aguardando classificação de outro cotista.`,
    )
    setValues(emptyOperationValues())
    loadMine(profileId)
    loadPending()
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
    setActionMsg(
      approve
        ? 'Classificada como despesa dos pais.'
        : 'Classificada como resgate pessoal do solicitante.',
    )
    loadPending()
    if (profileId) loadMine(profileId)
  }

  return (
    <div className="animate-rise flex flex-col gap-6">
      <Card
        title="Registrar saída"
        description="Informe a quantidade de títulos, o valor bruto e a data da saída. Resgate pessoal queima as suas cotas. Despesa dos pais não queima cotas de ninguém — proposta fica pendente de classificação por outro cotista."
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <OperationFields
            kind={kind}
            kinds={kinds}
            onKindChange={setKind}
            bonds={bonds}
            values={values}
            onChange={patch}
            maxDate={todayStr}
            dateLabel="Data da saída"
            dateHint="Quando o dinheiro saiu de fato. Vazio = hoje."
          />

          {error && <Alert kind="error">{error}</Alert>}
          {success && <Alert kind="success">{success}</Alert>}

          <div>
            <Button type="submit" disabled={submitting || !values.bondId}>
              {submitting ? 'Processando…' : 'Registrar saída'}
            </Button>
          </div>
        </form>
      </Card>

      <Card
        title="Saídas pendentes de classificação"
        description="Propostas de despesa aguardando outro cotista. Aprovar = despesa dos pais (ninguém perde cota). Reprovar = resgate pessoal do solicitante (queima as cotas dele)."
      >
        {actionMsg && <Alert kind="success">{actionMsg}</Alert>}
        {actionErr && <Alert kind="error">{actionErr}</Alert>}

        {pending.length === 0 ? (
          <p className="text-sm text-bone-dim">Nenhuma saída pendente.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((t) => {
              const own = t.profile_id === profileId
              return (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-pine/50 p-4"
                >
                  <div className="text-sm">
                    <p className="font-semibold text-bone">
                      <span className="nums text-brass">
                        {formatBRL(t.amount_brl)}
                      </span>{' '}
                      ·{' '}
                      {bondLabel(
                        t.target_bond_id
                          ? bondById.get(t.target_bond_id)
                          : undefined,
                      )}
                    </p>
                    <p className="mt-0.5 text-bone-dim">
                      Solicitado por{' '}
                      {t.profile_id ? (profiles.get(t.profile_id) ?? '—') : '—'}{' '}
                      em {formatDate(t.event_date)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {own ? (
                      <span className="eyebrow text-sage">
                        Aguardando outro cotista
                      </span>
                    ) : (
                      <>
                        <Button
                          variant="primary"
                          disabled={busyId === t.id}
                          onClick={() => decide(t, true)}
                        >
                          Despesa dos pais
                        </Button>
                        <Button
                          variant="danger"
                          disabled={busyId === t.id}
                          onClick={() => decide(t, false)}
                        >
                          Resgate pessoal
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

      <Card title="Minhas saídas recentes">
        {mine.length === 0 ? (
          <p className="text-sm text-bone-dim">
            Você ainda não registrou resgates ou despesas.
          </p>
        ) : (
          <>
            {/* Desktop: tabela em 5 colunas. */}
            <table className="hidden w-full text-sm sm:table">
              <thead>
                <tr className="text-left">
                  <th className="eyebrow pb-2 text-sage">Data</th>
                  <th className="eyebrow pb-2 text-sage">Tipo</th>
                  <th className="eyebrow pb-2 text-sage">Título</th>
                  <th className="eyebrow pb-2 text-sage">Valor</th>
                  <th className="eyebrow pb-2 text-sage">Status</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((t) => (
                  <tr key={t.id} className="border-t border-line">
                    <td className="nums py-2.5 text-bone-dim">
                      {formatDate(t.event_date)}
                    </td>
                    <td className="py-2.5 text-bone-dim">
                      {t.status === 'PENDING_APPROVAL'
                        ? 'Saída pendente'
                        : (TYPE_LABELS[t.type] ?? t.type)}
                    </td>
                    <td className="py-2.5 text-bone-dim">
                      {bondLabel(
                        t.target_bond_id
                          ? bondById.get(t.target_bond_id)
                          : undefined,
                      )}
                    </td>
                    <td className="nums py-2.5 text-bone">
                      {formatBRL(t.amount_brl)}
                    </td>
                    <td className="py-2.5">
                      <span
                        className={`eyebrow rounded-full px-2.5 py-1 ${
                          STATUS_STYLES[t.status ?? ''] ??
                          'border border-line text-bone-dim'
                        }`}
                      >
                        {STATUS_LABELS[t.status ?? ''] ?? t.status ?? '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile: cada saída empilhada (tipo+valor / título · data / status). */}
            <ul className="flex flex-col sm:hidden">
              {mine.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-col gap-1.5 border-t border-line py-3.5 first:border-t-0 first:pt-0"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm text-bone">
                      {t.status === 'PENDING_APPROVAL'
                        ? 'Saída pendente'
                        : (TYPE_LABELS[t.type] ?? t.type)}
                    </p>
                    <p className="nums shrink-0 text-sm text-bone">
                      {formatBRL(t.amount_brl)}
                    </p>
                  </div>
                  <p className="nums text-xs text-bone-dim">
                    {bondLabel(
                      t.target_bond_id
                        ? bondById.get(t.target_bond_id)
                        : undefined,
                    )}{' '}
                    · {formatDate(t.event_date)}
                  </p>
                  <div>
                    <span
                      className={`eyebrow rounded-full px-2.5 py-1 ${
                        STATUS_STYLES[t.status ?? ''] ??
                        'border border-line text-bone-dim'
                      }`}
                    >
                      {STATUS_LABELS[t.status ?? ''] ?? t.status ?? '—'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  )
}
