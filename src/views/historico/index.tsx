import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { supabase } from '@/services/supabase'
import type { Json, Tables } from '@/services/supabase'
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
  parseFailedRef,
  type CreateChange,
  type EventChange,
  type EventRow,
  type RowChange,
  type UpdateChange,
} from '@/lib/events'

type Bond = Pick<
  Tables<'treasury_bonds'>,
  'id' | 'api_reference_name' | 'display_name' | 'is_available_for_purchase'
>
type Profile = Pick<Tables<'profiles'>, 'id' | 'name'>

function bondLabel(b: Bond | undefined): string {
  if (!b) return '—'
  return b.display_name ?? b.api_reference_name
}

function fmtQty(q: number | null | undefined): string {
  return q != null ? q.toLocaleString('pt-BR', { maximumFractionDigits: 6 }) : '—'
}

const STATUS_LABELS: Record<string, string> = {
  APPROVED: 'Aprovado',
  PENDING_APPROVAL: 'Pendente',
  REJECTED: 'Rejeitado',
}

// Valores efetivos de uma linha existente, considerando uma edição pendente.
function effectiveValues(ev: EventRow, pending: UpdateChange | undefined) {
  if (pending) {
    return {
      bond_id: pending.bond_id,
      quantity: pending.quantity,
      amount_brl: pending.amount_brl,
      event_date: pending.event_date,
    }
  }
  return {
    bond_id: ev.target_bond_id,
    quantity: ev.quantity,
    amount_brl: ev.amount_brl,
    event_date: ev.event_date,
  }
}

// Página completa do livro de lançamentos. As ações (criar/editar/remover) ficam
// num RASCUNHO local: o usuário empilha quantas alterações quiser, vê tudo refletido
// inline na tabela, e só ao "Salvar alterações" o lote é enviado numa única transação
// (RPC apply_event_changes) — um único replay recompõe cotas e a série diária de PL.
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

  // rascunho de alterações pendentes
  const [rowOps, setRowOps] = useState<Map<string, RowChange>>(new Map())
  const [creates, setCreates] = useState<CreateChange[]>([])

  // modais
  const [editing, setEditing] = useState<EventRow | null>(null)
  const [creatingOpen, setCreatingOpen] = useState(false)

  // feedback do save
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [failedRef, setFailedRef] = useState<string | null>(null)

  // Nº de lotes de destino por reinvestimento (um reinvestimento pode reaplicar em
  // vários títulos → exibimos "N títulos" quando há mais de um).
  const [reinvCount, setReinvCount] = useState<Map<string, number>>(new Map())

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
      .select('id, api_reference_name, display_name, is_available_for_purchase')
      .order('api_reference_name')
      .then(({ data }) => setBonds(data ?? []))
    supabase
      .from('profiles')
      .select('id, name')
      .order('name')
      .then(({ data }) => setProfiles(data ?? []))
    loadEvents()
  }, [loadEvents])

  useEffect(() => {
    const ids = events
      .filter((e) => e.type === 'REINVESTIMENTO')
      .map((e) => e.id)
    let cancelled = false
    void (async () => {
      const m = new Map<string, number>()
      if (ids.length > 0) {
        const { data } = await supabase
          .from('fund_bond_lots')
          .select('transaction_id')
          .in('transaction_id', ids)
        for (const r of data ?? []) {
          if (r.transaction_id)
            m.set(r.transaction_id, (m.get(r.transaction_id) ?? 0) + 1)
        }
      }
      if (!cancelled) setReinvCount(m)
    })()
    return () => {
      cancelled = true
    }
  }, [events])

  const filtered = events.filter((ev) => {
    if (fCotista && ev.profile_id !== fCotista) return false
    if (fTipo && ev.type !== fTipo) return false
    if (fFrom && ev.event_date < fFrom) return false
    if (fTo && ev.event_date > fTo) return false
    return true
  })

  const pendingCount = rowOps.size + creates.length

  function stageRowOp(change: RowChange) {
    setError(null)
    setSuccess(null)
    setRowOps((prev) => {
      const next = new Map(prev)
      next.set(change.transaction_id, change)
      return next
    })
  }

  function undoRow(id: string) {
    setRowOps((prev) => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }

  function stageCreate(change: CreateChange) {
    setError(null)
    setSuccess(null)
    setCreates((prev) => [...prev, change])
  }

  function undoCreate(ref: string) {
    setCreates((prev) => prev.filter((c) => c.ref !== ref))
  }

  function discardAll() {
    setRowOps(new Map())
    setCreates([])
    setError(null)
    setFailedRef(null)
  }

  async function handleSave() {
    if (!caller || pendingCount === 0) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    setFailedRef(null)
    const changes: EventChange[] = [...creates, ...rowOps.values()]
    const { data, error } = await supabase.rpc('apply_event_changes', {
      p_caller_id: caller.id,
      p_changes: changes as unknown as Json,
    })
    setSaving(false)
    if (error) {
      setFailedRef(parseFailedRef(error.message))
      setError(error.message)
      return
    }
    const n =
      (data as { applied?: number } | null)?.applied ?? changes.length
    setRowOps(new Map())
    setCreates([])
    setSuccess(`${n} alteração(ões) salvas e histórico recomposto.`)
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
    <div className="animate-rise flex flex-col gap-6 pb-24">
      <header>
        <p className="eyebrow text-brass">Livro-razão</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-bone">
          Histórico de lançamentos
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-bone-dim">
          Todos os eventos do fundo para análise e auditoria. Empilhe criações,
          edições e remoções dos seus próprios lançamentos (admins agem em
          qualquer um) e salve tudo de uma vez — um único replay recompõe as
          cotas e a série de PL.
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
              <option value="REINVESTIMENTO">Reinvestimento</option>
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
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="text-xs text-sage">
            {pendingCount > 0
              ? `${pendingCount} alteração(ões) pendente(s) — salve para aplicar.`
              : 'Nenhuma alteração pendente.'}
          </span>
          <Button onClick={() => setCreatingOpen(true)} disabled={!caller}>
            + Novo lançamento
          </Button>
        </div>

        {error && <Alert kind="error">{error}</Alert>}
        {success && <Alert kind="success">{success}</Alert>}

        {loading ? (
          <p className="text-sm text-bone-dim">Carregando…</p>
        ) : filtered.length === 0 && creates.length === 0 ? (
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
                {/* Criações pendentes (sempre visíveis, no topo). */}
                {creates.map((c) => {
                  const isFailed = failedRef === c.ref
                  const cType =
                    c.kind === 'APORTE' ? 'APORTE' : c.type
                  return (
                    <tr
                      key={c.ref}
                      className={`border-t border-line ${isFailed ? 'bg-clay/10' : 'bg-pine/40'}`}
                    >
                      <td className="nums py-2.5 text-bone-dim">
                        {formatDate(c.event_date)}
                      </td>
                      <td className="py-2.5 text-bone-dim">
                        {profileName.get(c.profile_id) ?? '—'}
                      </td>
                      <td className="py-2.5 text-bone">
                        {TYPE_LABELS[cType] ?? cType}
                        <span className="eyebrow ml-2 rounded-full border border-brass/30 px-1.5 py-0.5 text-[0.5rem] text-brass-bright">
                          novo
                        </span>
                      </td>
                      <td className="py-2.5 text-bone-dim">
                        {bondLabel(bondById.get(c.bond_id))}
                      </td>
                      <td className="nums py-2.5 text-right text-bone-dim">
                        {fmtQty(c.quantity)}
                      </td>
                      <td className="nums py-2.5 text-right text-bone">
                        {formatBRL(c.amount_brl)}
                      </td>
                      <td className="py-2.5">
                        <span className="eyebrow text-brass-bright">
                          a criar
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => undoCreate(c.ref)}
                          className="rounded-lg border border-line px-2.5 py-1 text-xs text-bone-dim transition-colors hover:border-clay/50 hover:text-clay"
                        >
                          Desfazer
                        </button>
                      </td>
                    </tr>
                  )
                })}

                {/* Linhas existentes (com eventuais ops pendentes). */}
                {filtered.map((ev) => {
                  const can = canManageEvent(ev, caller)
                  // Reinvestimento toca dois títulos; a edição genérica não o
                  // expressa — corrige-se removendo e recriando.
                  const editable = can && ev.type !== 'REINVESTIMENTO'
                  const pending = rowOps.get(ev.id)
                  const isDelete = pending?.op === 'delete'
                  const upd = pending?.op === 'update' ? pending : undefined
                  const vals = effectiveValues(ev, upd)
                  const isFailed = failedRef === ev.id
                  const rowClass = isFailed
                    ? 'bg-clay/10'
                    : isDelete
                      ? 'opacity-50'
                      : upd
                        ? 'bg-pine/40'
                        : ''
                  const textTone = isDelete
                    ? 'text-bone-dim line-through'
                    : 'text-bone-dim'
                  return (
                    <tr key={ev.id} className={`border-t border-line ${rowClass}`}>
                      <td className={`nums py-2.5 ${textTone}`}>
                        {formatDate(vals.event_date)}
                      </td>
                      <td className={`py-2.5 ${textTone}`}>
                        {ev.profile_id
                          ? (profileName.get(ev.profile_id) ?? '—')
                          : '—'}
                      </td>
                      <td
                        className={`py-2.5 ${isDelete ? 'text-bone-dim line-through' : 'text-bone'}`}
                      >
                        {TYPE_LABELS[ev.type] ?? ev.type}
                        {ev.is_opening && (
                          <span className="eyebrow ml-2 rounded-full border border-brass/30 px-1.5 py-0.5 text-[0.5rem] text-brass-bright">
                            abertura
                          </span>
                        )}
                      </td>
                      <td className={`py-2.5 ${textTone}`}>
                        {ev.type === 'REINVESTIMENTO' && !vals.bond_id
                          ? (() => {
                              const n = reinvCount.get(ev.id) ?? 0
                              return n > 0 ? `${n} títulos` : '—'
                            })()
                          : vals.bond_id
                            ? bondLabel(bondById.get(vals.bond_id))
                            : '—'}
                      </td>
                      <td className={`nums py-2.5 text-right ${textTone}`}>
                        {fmtQty(vals.quantity)}
                      </td>
                      <td
                        className={`nums py-2.5 text-right ${isDelete ? 'text-bone-dim line-through' : upd ? 'text-brass-bright' : 'text-bone'}`}
                      >
                        {formatBRL(vals.amount_brl)}
                      </td>
                      <td className="py-2.5">
                        {isDelete ? (
                          <span className="eyebrow text-clay">a remover</span>
                        ) : upd ? (
                          <span className="eyebrow text-brass-bright">
                            a editar
                          </span>
                        ) : (
                          <span className="eyebrow text-sage">
                            {STATUS_LABELS[ev.status ?? ''] ?? ev.status ?? '—'}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="flex justify-end gap-2">
                          {pending ? (
                            <button
                              type="button"
                              onClick={() => undoRow(ev.id)}
                              className="rounded-lg border border-line px-2.5 py-1 text-xs text-bone-dim transition-colors hover:border-brass/50 hover:text-bone"
                            >
                              Desfazer
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={!editable}
                                onClick={() => {
                                  setError(null)
                                  setSuccess(null)
                                  setEditing(ev)
                                }}
                                title={
                                  ev.is_opening
                                    ? 'Lançamento de abertura — editado no saldo de abertura'
                                    : ev.type === 'REINVESTIMENTO'
                                      ? 'Reinvestimento — remova e recrie para corrigir'
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
                                disabled={!can}
                                onClick={() =>
                                  stageRowOp({
                                    ref: ev.id,
                                    op: 'delete',
                                    transaction_id: ev.id,
                                  })
                                }
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
                            </>
                          )}
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

      {/* Barra fixa de ações — só quando há pendências. */}
      {pendingCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-moss/95 px-4 py-3 backdrop-blur-sm">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <span className="text-sm text-bone-dim">
              <span className="nums font-semibold text-bone">
                {pendingCount}
              </span>{' '}
              alteração(ões) pendente(s)
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={discardAll}
                disabled={saving}
              >
                Descartar tudo
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Salvando…' : 'Salvar alterações'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <EditModal
          event={editing}
          bonds={bonds}
          pending={
            rowOps.get(editing.id)?.op === 'update'
              ? (rowOps.get(editing.id) as UpdateChange)
              : undefined
          }
          onClose={() => setEditing(null)}
          onStage={(change) => {
            stageRowOp(change)
            setEditing(null)
          }}
        />
      )}

      {creatingOpen && caller && (
        <CreateModal
          bonds={bonds}
          profiles={profiles}
          callerId={caller.id}
          isAdmin={caller.role === 'ADMIN'}
          onClose={() => setCreatingOpen(false)}
          onStage={(change) => {
            stageCreate(change)
            setCreatingOpen(false)
          }}
        />
      )}
    </div>
  )
}

// Modal de edição: em vez de salvar na hora, empilha uma UpdateChange no rascunho.
function EditModal({
  event,
  bonds,
  pending,
  onClose,
  onStage,
}: {
  event: EventRow
  bonds: Bond[]
  pending: UpdateChange | undefined
  onClose: () => void
  onStage: (change: UpdateChange) => void
}) {
  const [bondId, setBondId] = useState(
    pending?.bond_id ?? event.target_bond_id ?? '',
  )
  const [quantity, setQuantity] = useState(
    String(pending?.quantity ?? event.quantity ?? ''),
  )
  const [amount, setAmount] = useState(
    String(pending?.amount_brl ?? event.amount_brl),
  )
  const [eventDate, setEventDate] = useState(
    pending?.event_date ?? event.event_date,
  )
  const [error, setError] = useState<string | null>(null)

  const isAporte = event.type === 'APORTE'
  const amountLabel = isAporte ? 'Valor total aportado (R$)' : 'Valor bruto (R$)'

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const q = Number(quantity)
    const a = Number(amount)
    if (!bondId || !(q > 0) || !(a > 0)) {
      setError('Informe título, quantidade e valor positivos.')
      return
    }
    onStage({
      ref: event.id,
      op: 'update',
      transaction_id: event.id,
      bond_id: bondId,
      quantity: q,
      amount_brl: a,
      event_date: eventDate,
    })
  }

  return (
    <ModalShell title={`Editar ${TYPE_LABELS[event.type] ?? event.type}`} onClose={onClose}>
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
          <Button type="submit" disabled={!bondId}>
            Adicionar ao rascunho
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </ModalShell>
  )
}

// Caminhos de criação oferecidos no modal (despesa direta só para admin).
type CreateKind = 'APORTE' | 'RESGATE_PESSOAL' | 'DESPESA_PAIS' | 'DESPESA_DIRETA'

const CREATE_KIND_LABELS: Record<CreateKind, string> = {
  APORTE: 'Aporte',
  RESGATE_PESSOAL: 'Resgate pessoal',
  DESPESA_PAIS: 'Despesa dos pais (proposta)',
  DESPESA_DIRETA: 'Despesa dos pais (direta)',
}

// Modal de criação: empilha uma CreateChange (aporte ou saída) no rascunho.
function CreateModal({
  bonds,
  profiles,
  callerId,
  isAdmin,
  onClose,
  onStage,
}: {
  bonds: Bond[]
  profiles: Profile[]
  callerId: string
  isAdmin: boolean
  onClose: () => void
  onStage: (change: CreateChange) => void
}) {
  const [kind, setKind] = useState<CreateKind>('APORTE')
  // Admin pode lançar em nome de qualquer cotista; cotista comum, só o próprio.
  const [profileId, setProfileId] = useState(callerId)
  const [bondId, setBondId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [amount, setAmount] = useState('')
  const [eventDate, setEventDate] = useState(
    new Date().toISOString().slice(0, 10),
  )
  const [error, setError] = useState<string | null>(null)

  // Aporte só aceita títulos disponíveis para compra; saídas, qualquer um.
  const bondOptions =
    kind === 'APORTE' ? bonds.filter((b) => b.is_available_for_purchase) : bonds

  const amountLabel =
    kind === 'APORTE' ? 'Valor total aportado (R$)' : 'Valor bruto (R$)'

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const q = Number(quantity)
    const a = Number(amount)
    if (!bondId || !(q > 0) || !(a > 0)) {
      setError('Informe título, quantidade e valor positivos.')
      return
    }
    const ref = crypto.randomUUID()
    if (kind === 'APORTE') {
      onStage({
        ref,
        op: 'create',
        kind: 'APORTE',
        profile_id: profileId,
        bond_id: bondId,
        quantity: q,
        amount_brl: a,
        event_date: eventDate,
      })
      return
    }
    const type = kind === 'RESGATE_PESSOAL' ? 'RESGATE_PESSOAL' : 'DESPESA_PAIS'
    // Despesa direta exige autor admin no banco (não queima cota de ninguém);
    // amarra ao próprio admin independentemente do cotista escolhido.
    const owner = kind === 'DESPESA_DIRETA' ? callerId : profileId
    onStage({
      ref,
      op: 'create',
      kind: 'WITHDRAWAL',
      type,
      direct: kind === 'DESPESA_DIRETA',
      profile_id: owner,
      bond_id: bondId,
      quantity: q,
      amount_brl: a,
      event_date: eventDate,
    })
  }

  return (
    <ModalShell title="Novo lançamento" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Tipo de lançamento">
          <Select value={kind} onChange={(v) => setKind(v as CreateKind)}>
            <option value="APORTE">{CREATE_KIND_LABELS.APORTE}</option>
            <option value="RESGATE_PESSOAL">
              {CREATE_KIND_LABELS.RESGATE_PESSOAL}
            </option>
            <option value="DESPESA_PAIS">
              {CREATE_KIND_LABELS.DESPESA_PAIS}
            </option>
            {isAdmin && (
              <option value="DESPESA_DIRETA">
                {CREATE_KIND_LABELS.DESPESA_DIRETA}
              </option>
            )}
          </Select>
        </Field>

        {isAdmin && kind !== 'DESPESA_DIRETA' && (
          <Field
            label="Cotista"
            hint="Admin pode lançar em nome de qualquer cotista."
          >
            <Select value={profileId} onChange={setProfileId} required>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Título">
          <Select
            value={bondId}
            onChange={setBondId}
            required
            disabled={bondOptions.length === 0}
          >
            <option value="" disabled>
              Selecione um título
            </option>
            {bondOptions.map((b) => (
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
          <Button type="submit" disabled={!bondId}>
            Adicionar ao rascunho
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </ModalShell>
  )
}

// Casca compartilhada dos modais (overlay + card).
function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-bone/30 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <Card title={title}>{children}</Card>
      </div>
    </div>
  )
}
