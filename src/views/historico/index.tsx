import { useCallback, useEffect, useMemo, useState } from 'react'
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
import {
  EVENT_SELECT,
  TYPE_LABELS,
  canManageEvent,
  type EventRow,
} from '@/lib/events'

type Bond = Pick<
  Tables<'treasury_bonds'>,
  'id' | 'api_reference_name' | 'display_name'
>
type Profile = Pick<Tables<'profiles'>, 'id' | 'name'>

function bondLabel(b: Bond | undefined): string {
  if (!b) return '—'
  return b.display_name ?? b.api_reference_name
}

const STATUS_LABELS: Record<string, string> = {
  APPROVED: 'Aprovado',
  PENDING_APPROVAL: 'Pendente',
  REJECTED: 'Rejeitado',
}

// Página completa do livro de lançamentos: todos os eventos, filtros para
// auditoria e ações de editar/remover. Cotistas só agem nos próprios lançamentos
// (botões desabilitados nos demais); admins agem em todos. Toda alteração dispara
// o replay no banco, que recompõe cotas e a série diária de PL.
export function HistoricoView() {
  const { profile } = useAuth()
  const caller = profile ? { id: profile.id, role: profile.role } : null

  const [events, setEvents] = useState<EventRow[]>([])
  const [bonds, setBonds] = useState<Bond[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  // filtros
  const [fCotista, setFCotista] = useState('')
  const [fTipo, setFTipo] = useState('')
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')

  // ações
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // edição (lançamento aberto no modal)
  const [editing, setEditing] = useState<EventRow | null>(null)

  const bondById = useMemo(() => new Map(bonds.map((b) => [b.id, b])), [bonds])
  const profileName = useMemo(
    () => new Map(profiles.map((p) => [p.id, p.name])),
    [profiles],
  )

  const loadEvents = useCallback(() => {
    return supabase
      .from('transactions')
      .select(EVENT_SELECT)
      .order('event_date', { ascending: false })
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setEvents((data ?? []) as EventRow[])
        setLoading(false)
      })
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
      .order('name')
      .then(({ data }) => setProfiles(data ?? []))
    loadEvents()
  }, [loadEvents])

  const filtered = events.filter((ev) => {
    if (fCotista && ev.profile_id !== fCotista) return false
    if (fTipo && ev.type !== fTipo) return false
    if (fFrom && ev.event_date < fFrom) return false
    if (fTo && ev.event_date > fTo) return false
    return true
  })

  async function handleDelete(ev: EventRow) {
    if (!caller) return
    const label = TYPE_LABELS[ev.type] ?? ev.type
    if (
      !window.confirm(
        `Remover este lançamento (${label} de ${formatBRL(ev.amount_brl)})? O histórico do fundo será recomposto.`,
      )
    )
      return
    setBusyId(ev.id)
    setError(null)
    setSuccess(null)
    const { error } = await supabase.rpc('delete_transaction', {
      p_caller_id: caller.id,
      p_transaction_id: ev.id,
    })
    setBusyId(null)
    if (error) {
      setError(error.message)
      return
    }
    setSuccess('Lançamento removido e histórico recomposto.')
    loadEvents()
  }

  function clearFilters() {
    setFCotista('')
    setFTipo('')
    setFFrom('')
    setFTo('')
  }

  const hasFilters = fCotista || fTipo || fFrom || fTo

  return (
    <div className="animate-rise flex flex-col gap-6">
      <header>
        <p className="eyebrow text-brass">Livro-razão</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-bone">
          Histórico de lançamentos
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-bone-dim">
          Todos os eventos do fundo para análise e auditoria. Você pode editar e
          remover os seus próprios lançamentos; administradores podem alterar
          qualquer um. Cada alteração recompõe as cotas e a série de PL.
        </p>
      </header>

      <Card title="Filtros">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Cotista">
            <Select value={fCotista} onChange={setFCotista}>
              <option value="">Todos</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tipo">
            <Select value={fTipo} onChange={setFTipo}>
              <option value="">Todos</option>
              <option value="APORTE">Aporte</option>
              <option value="RESGATE_PESSOAL">Resgate</option>
              <option value="DESPESA_PAIS">Despesa</option>
            </Select>
          </Field>
          <Field label="De">
            <DateInput value={fFrom} onChange={setFFrom} required={false} />
          </Field>
          <Field label="Até">
            <DateInput value={fTo} onChange={setFTo} required={false} />
          </Field>
        </div>
        {hasFilters && (
          <div className="mt-4">
            <Button variant="secondary" onClick={clearFilters}>
              Limpar filtros
            </Button>
          </div>
        )}
      </Card>

      <Card
        title="Lançamentos"
        description={
          loading
            ? 'Carregando…'
            : `${filtered.length} lançamento(s)${hasFilters ? ' (filtrados)' : ''}.`
        }
      >
        {error && <Alert kind="error">{error}</Alert>}
        {success && <Alert kind="success">{success}</Alert>}

        {loading ? (
          <p className="text-sm text-bone-dim">Carregando…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-bone-dim">
            Nenhum lançamento {hasFilters ? 'para os filtros atuais' : 'ainda'}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="eyebrow pb-2 text-sage">Data</th>
                  <th className="eyebrow pb-2 text-sage">Cotista</th>
                  <th className="eyebrow pb-2 text-sage">Tipo</th>
                  <th className="eyebrow pb-2 text-sage">Título</th>
                  <th className="eyebrow pb-2 text-right text-sage">Qtd.</th>
                  <th className="eyebrow pb-2 text-right text-sage">Valor</th>
                  <th className="eyebrow pb-2 text-sage">Status</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((ev) => {
                  const can = canManageEvent(ev, caller)
                  return (
                    <tr key={ev.id} className="border-t border-line">
                      <td className="nums py-2.5 text-bone-dim">
                        {formatDate(ev.event_date)}
                      </td>
                      <td className="py-2.5 text-bone-dim">
                        {ev.profile_id
                          ? (profileName.get(ev.profile_id) ?? '—')
                          : '—'}
                      </td>
                      <td className="py-2.5 text-bone">
                        {TYPE_LABELS[ev.type] ?? ev.type}
                        {ev.is_opening && (
                          <span className="eyebrow ml-2 rounded-full border border-brass/30 px-1.5 py-0.5 text-[0.5rem] text-brass-bright">
                            abertura
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-bone-dim">
                        {ev.target_bond_id
                          ? bondLabel(bondById.get(ev.target_bond_id))
                          : '—'}
                      </td>
                      <td className="nums py-2.5 text-right text-bone-dim">
                        {ev.quantity != null
                          ? ev.quantity.toLocaleString('pt-BR', {
                              maximumFractionDigits: 6,
                            })
                          : '—'}
                      </td>
                      <td className="nums py-2.5 text-right text-bone">
                        {formatBRL(ev.amount_brl)}
                      </td>
                      <td className="py-2.5">
                        <span className="eyebrow text-sage">
                          {STATUS_LABELS[ev.status ?? ''] ?? ev.status ?? '—'}
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={!can || busyId === ev.id}
                            onClick={() => {
                              setError(null)
                              setSuccess(null)
                              setEditing(ev)
                            }}
                            title={
                              ev.is_opening
                                ? 'Lançamento de abertura — editado no saldo de abertura'
                                : can
                                  ? 'Editar lançamento'
                                  : 'Só o autor ou um admin pode editar'
                            }
                            className="rounded-lg border border-line px-2.5 py-1 text-xs text-bone-dim transition-colors hover:border-brass/50 hover:text-bone disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-bone-dim"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            disabled={!can || busyId === ev.id}
                            onClick={() => handleDelete(ev)}
                            title={
                              ev.is_opening
                                ? 'Lançamento de abertura — gerido no saldo de abertura'
                                : can
                                  ? 'Remover lançamento'
                                  : 'Só o autor ou um admin pode remover'
                            }
                            className="rounded-lg border border-line px-2.5 py-1 text-xs text-bone-dim transition-colors hover:border-clay/50 hover:text-clay disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-bone-dim"
                          >
                            Remover
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <EditModal
          event={editing}
          bonds={bonds}
          callerId={caller?.id ?? ''}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null)
            setSuccess(msg)
            setError(null)
            loadEvents()
          }}
        />
      )}
    </div>
  )
}

// Modal de edição de campos completos: título, quantidade, valor e data.
function EditModal({
  event,
  bonds,
  callerId,
  onClose,
  onSaved,
}: {
  event: EventRow
  bonds: Bond[]
  callerId: string
  onClose: () => void
  onSaved: (msg: string) => void
}) {
  const [bondId, setBondId] = useState(event.target_bond_id ?? '')
  const [quantity, setQuantity] = useState(
    event.quantity != null ? String(event.quantity) : '',
  )
  const [amount, setAmount] = useState(String(event.amount_brl))
  const [eventDate, setEventDate] = useState(event.event_date)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isAporte = event.type === 'APORTE'
  const amountLabel = isAporte
    ? 'Valor total aportado (R$)'
    : 'Valor bruto (R$)'

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error } = await supabase.rpc('update_transaction', {
      p_caller_id: callerId,
      p_transaction_id: event.id,
      p_bond_id: bondId,
      p_quantity: Number(quantity),
      p_amount_brl: Number(amount),
      p_event_date: eventDate,
    })
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    onSaved('Lançamento atualizado e histórico recomposto.')
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-bone/30 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <Card title={`Editar ${TYPE_LABELS[event.type] ?? event.type}`}>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Quantidade de títulos">
                <NumberInput
                  value={quantity}
                  onChange={setQuantity}
                  step="0.000001"
                  min="0"
                  placeholder="0,000000"
                />
              </Field>
              <Field label={amountLabel}>
                <NumberInput
                  value={amount}
                  onChange={setAmount}
                  step="0.01"
                  min="0"
                  placeholder="0,00"
                />
              </Field>
            </div>

            <Field label="Data do lançamento">
              <DateInput value={eventDate} onChange={setEventDate} />
            </Field>

            {error && <Alert kind="error">{error}</Alert>}

            <div className="flex gap-2">
              <Button type="submit" disabled={submitting || !bondId}>
                {submitting ? 'Salvando…' : 'Salvar alterações'}
              </Button>
              <Button variant="secondary" onClick={onClose}>
                Cancelar
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  )
}
