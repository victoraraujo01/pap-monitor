import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/services/supabase'
import type { Json, Tables } from '@/services/supabase'
import { useAuth } from '@/context/useAuth'
import { Alert, Button, Card, DateInput, Field, Select } from '@/components/ui'
import { OperationFields } from '@/components/OperationFields'
import {
  effectiveReposition,
  emptyOperationValues,
  type OperationKind,
  type OperationValues,
} from '@/lib/operations'
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
      // note undefined na edição = mantém; '' = limpa; texto = substitui.
      note: pending.note !== undefined ? pending.note : ev.note,
      // reposition_amount ausente na edição = mantém a atual.
      reposition_amount:
        pending.reposition_amount !== undefined
          ? pending.reposition_amount
          : ev.reposition_amount,
    }
  }
  return {
    bond_id: ev.target_bond_id,
    quantity: ev.quantity,
    amount_brl: ev.amount_brl,
    event_date: ev.event_date,
    note: ev.note,
    reposition_amount: ev.reposition_amount,
  }
}

// Para um APORTE dividido (parte abate um resgate), devolve quanto do valor foi
// para a obrigação mensal e quanto repôs o resgate. null se não há split.
function repositionSplit(
  type: EventRow['type'],
  amount: number,
  repo: number | null | undefined,
): { obligation: number; reposition: number } | null {
  if (type !== 'APORTE') return null
  const r = repo ?? 0
  if (r <= 0) return null
  return { obligation: amount - r, reposition: r }
}

// Texto do título de um evento — reinvestimento com vários destinos vira "N
// títulos"; demais usam o título do lote. Compartilhado entre tabela e cards.
function eventTitleText(
  ev: EventRow,
  bondId: string | null,
  reinvCount: Map<string, number>,
  bondById: Map<string, Bond>,
): string {
  if (ev.type === 'REINVESTIMENTO' && !bondId) {
    const n = reinvCount.get(ev.id) ?? 0
    return n > 0 ? `${n} títulos` : '—'
  }
  return bondId ? bondLabel(bondById.get(bondId)) : '—'
}

// Ações por linha (Desfazer | Editar+Remover) — reusadas pela tabela (desktop) e
// pelos cards empilhados (mobile).
function EventActions({
  ev,
  can,
  editable,
  pending,
  onUndo,
  onEdit,
  onDelete,
}: {
  ev: EventRow
  can: boolean
  editable: boolean
  pending: boolean
  onUndo: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  if (pending) {
    return (
      <button
        type="button"
        onClick={onUndo}
        className="rounded-lg border border-line px-2.5 py-1 text-xs text-bone-dim transition-colors hover:border-brass/50 hover:text-bone"
      >
        Desfazer
      </button>
    )
  }
  return (
    <div className="flex justify-end gap-2">
      <button
        type="button"
        disabled={!editable}
        onClick={onEdit}
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
        onClick={onDelete}
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
  )
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
          <>
            {/* Desktop (lg+): tabela completa em 8 colunas. */}
            <div className="hidden overflow-x-auto lg:block">
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
                    const cType = c.kind === 'APORTE' ? 'APORTE' : c.type
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
                          {c.note && (
                            <span
                              className="mt-0.5 block max-w-[16rem] truncate text-xs italic text-sage"
                              title={c.note}
                            >
                              {c.note}
                            </span>
                          )}
                          {(() => {
                            const split = repositionSplit(
                              cType,
                              c.amount_brl,
                              c.kind === 'APORTE'
                                ? c.reposition_amount
                                : undefined,
                            )
                            return split ? (
                              <span className="mt-0.5 block text-xs text-sage">
                                Mensal {formatBRL(split.obligation)} · Reposição{' '}
                                {formatBRL(split.reposition)}
                              </span>
                            ) : null
                          })()}
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
                      <tr
                        key={ev.id}
                        className={`border-t border-line ${rowClass}`}
                      >
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
                          {eventTitleText(
                            ev,
                            vals.bond_id,
                            reinvCount,
                            bondById,
                          )}
                          {vals.note && (
                            <span
                              className="mt-0.5 block max-w-[16rem] truncate text-xs italic text-sage"
                              title={vals.note}
                            >
                              {vals.note}
                            </span>
                          )}
                          {(() => {
                            const split = repositionSplit(
                              ev.type,
                              vals.amount_brl,
                              vals.reposition_amount,
                            )
                            return split ? (
                              <span className="mt-0.5 block text-xs text-sage">
                                Mensal {formatBRL(split.obligation)} · Reposição{' '}
                                {formatBRL(split.reposition)}
                              </span>
                            ) : null
                          })()}
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
                              {STATUS_LABELS[ev.status ?? ''] ??
                                ev.status ??
                                '—'}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 text-right">
                          <EventActions
                            ev={ev}
                            can={can}
                            editable={editable}
                            pending={!!pending}
                            onUndo={() => undoRow(ev.id)}
                            onEdit={() => {
                              setError(null)
                              setSuccess(null)
                              setEditing(ev)
                            }}
                            onDelete={() =>
                              stageRowOp({
                                ref: ev.id,
                                op: 'delete',
                                transaction_id: ev.id,
                              })
                            }
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile/tablet (<lg): cada lançamento empilhado num card. */}
            <ul className="flex flex-col lg:hidden">
              {/* Criações pendentes (no topo). */}
              {creates.map((c) => {
                const isFailed = failedRef === c.ref
                const cType = c.kind === 'APORTE' ? 'APORTE' : c.type
                return (
                  <li
                    key={c.ref}
                    className={`-mx-3 flex flex-col gap-1.5 rounded-lg border-t border-line px-3 py-3.5 first:border-t-0 first:pt-0 ${isFailed ? 'bg-clay/10' : 'bg-pine/40'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-bone">
                        {TYPE_LABELS[cType] ?? cType}
                        <span className="eyebrow ml-2 rounded-full border border-brass/30 px-1.5 py-0.5 text-[0.5rem] text-brass-bright">
                          novo
                        </span>
                      </p>
                      <p className="nums shrink-0 text-sm text-bone">
                        {formatBRL(c.amount_brl)}
                      </p>
                    </div>
                    <p className="nums text-xs text-bone-dim">
                      {profileName.get(c.profile_id) ?? '—'} ·{' '}
                      {formatDate(c.event_date)}
                    </p>
                    <p className="text-xs text-bone-dim">
                      {bondLabel(bondById.get(c.bond_id))} · {fmtQty(c.quantity)}{' '}
                      un.
                    </p>
                    {c.note && (
                      <p className="text-xs italic text-sage">{c.note}</p>
                    )}
                    {(() => {
                      const split = repositionSplit(
                        cType,
                        c.amount_brl,
                        c.kind === 'APORTE' ? c.reposition_amount : undefined,
                      )
                      return split ? (
                        <p className="text-xs text-sage">
                          Mensal {formatBRL(split.obligation)} · Reposição{' '}
                          {formatBRL(split.reposition)}
                        </p>
                      ) : null
                    })()}
                    <div className="mt-0.5 flex items-center justify-between gap-3">
                      <span className="eyebrow text-brass-bright">a criar</span>
                      <button
                        type="button"
                        onClick={() => undoCreate(c.ref)}
                        className="rounded-lg border border-line px-2.5 py-1 text-xs text-bone-dim transition-colors hover:border-clay/50 hover:text-clay"
                      >
                        Desfazer
                      </button>
                    </div>
                  </li>
                )
              })}

              {/* Linhas existentes. */}
              {filtered.map((ev) => {
                const can = canManageEvent(ev, caller)
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
                  <li
                    key={ev.id}
                    className={`-mx-3 flex flex-col gap-1.5 rounded-lg border-t border-line px-3 py-3.5 first:border-t-0 first:pt-0 ${rowClass}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p
                        className={`text-sm ${isDelete ? 'text-bone-dim line-through' : 'text-bone'}`}
                      >
                        {TYPE_LABELS[ev.type] ?? ev.type}
                        {ev.is_opening && (
                          <span className="eyebrow ml-2 rounded-full border border-brass/30 px-1.5 py-0.5 text-[0.5rem] text-brass-bright">
                            abertura
                          </span>
                        )}
                      </p>
                      <p
                        className={`nums shrink-0 text-sm ${isDelete ? 'text-bone-dim line-through' : upd ? 'text-brass-bright' : 'text-bone'}`}
                      >
                        {formatBRL(vals.amount_brl)}
                      </p>
                    </div>
                    <p className={`nums text-xs ${textTone}`}>
                      {ev.profile_id
                        ? (profileName.get(ev.profile_id) ?? '—')
                        : '—'}{' '}
                      · {formatDate(vals.event_date)}
                    </p>
                    <p className={`text-xs ${textTone}`}>
                      {eventTitleText(ev, vals.bond_id, reinvCount, bondById)} ·{' '}
                      {fmtQty(vals.quantity)} un.
                    </p>
                    {vals.note && (
                      <p className={`text-xs italic ${textTone}`}>{vals.note}</p>
                    )}
                    {(() => {
                      const split = repositionSplit(
                        ev.type,
                        vals.amount_brl,
                        vals.reposition_amount,
                      )
                      return split ? (
                        <p className="text-xs text-sage">
                          Mensal {formatBRL(split.obligation)} · Reposição{' '}
                          {formatBRL(split.reposition)}
                        </p>
                      ) : null
                    })()}
                    <div className="mt-0.5 flex items-center justify-between gap-3">
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
                      <EventActions
                        ev={ev}
                        can={can}
                        editable={editable}
                        pending={!!pending}
                        onUndo={() => undoRow(ev.id)}
                        onEdit={() => {
                          setError(null)
                          setSuccess(null)
                          setEditing(ev)
                        }}
                        onDelete={() =>
                          stageRowOp({
                            ref: ev.id,
                            op: 'delete',
                            transaction_id: ev.id,
                          })
                        }
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
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

// event.type → OperationKind do formulário (reinvestimento nunca chega à edição).
function editKindOf(type: EventRow['type']): OperationKind {
  if (type === 'APORTE') return 'APORTE'
  if (type === 'RESGATE_PESSOAL') return 'RESGATE_PESSOAL'
  return 'DESPESA_PAIS'
}

// Busca o saldo a repor + mensalidade corrente de um cotista, para a divisão do
// aporte. Reusado pelos dois modais. Habilitado só quando faz sentido (APORTE).
function useRepayment(profileId: string | null, enabled: boolean) {
  const [outstanding, setOutstanding] = useState(0)
  const [monthly, setMonthly] = useState(1000)
  useEffect(() => {
    if (!enabled || !profileId) return
    supabase
      .from('v_cotista_balance')
      .select('repayment_outstanding')
      .eq('profile_id', profileId)
      .maybeSingle()
      .then(({ data }) =>
        setOutstanding(Math.max(0, data?.repayment_outstanding ?? 0)),
      )
    supabase
      .from('v_monthly_obligations')
      .select('amount_expected')
      .eq('profile_id', profileId)
      .order('reference_month', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setMonthly(data?.amount_expected ?? 1000))
  }, [profileId, enabled])
  return { outstanding, monthly }
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
  const kind = editKindOf(event.type)
  const [values, setValues] = useState<OperationValues>(() => ({
    bondId: pending?.bond_id ?? event.target_bond_id ?? '',
    eventDate: pending?.event_date ?? event.event_date,
    quantity: String(pending?.quantity ?? event.quantity ?? ''),
    amount: String(pending?.amount_brl ?? event.amount_brl),
    note: pending?.note !== undefined ? pending.note : (event.note ?? ''),
    repositionAmount:
      kind === 'APORTE'
        ? String(pending?.reposition_amount ?? event.reposition_amount ?? 0)
        : '',
  }))
  const [error, setError] = useState<string | null>(null)
  const { outstanding, monthly } = useRepayment(
    event.profile_id,
    kind === 'APORTE',
  )

  function patch(p: Partial<OperationValues>) {
    setValues((v) => ({ ...v, ...p }))
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const q = Number(values.quantity)
    const a = Number(values.amount)
    if (!values.bondId || !(q > 0) || !(a > 0)) {
      setError('Informe título, quantidade e valor positivos.')
      return
    }
    onStage({
      ref: event.id,
      op: 'update',
      transaction_id: event.id,
      bond_id: values.bondId,
      quantity: q,
      amount_brl: a,
      event_date: values.eventDate,
      note: values.note.trim(),
      ...(kind === 'APORTE'
        ? {
            reposition_amount: effectiveReposition(
              a,
              values.repositionAmount,
              outstanding,
              monthly,
            ),
          }
        : {}),
    })
  }

  return (
    <ModalShell
      title={`Editar ${TYPE_LABELS[event.type] ?? event.type}`}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <OperationFields
          kind={kind}
          kinds={[kind]}
          bonds={bonds}
          values={values}
          onChange={patch}
          repaymentOutstanding={outstanding}
          monthlyExpected={monthly}
          purchasableOnly={false}
        />

        {error && <Alert kind="error">{error}</Alert>}

        <div className="flex gap-2">
          <Button type="submit" disabled={!values.bondId}>
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
  const [kind, setKind] = useState<OperationKind>('APORTE')
  // Admin pode lançar em nome de qualquer cotista; cotista comum, só o próprio.
  const [profileId, setProfileId] = useState(callerId)
  const [values, setValues] = useState<OperationValues>(() =>
    emptyOperationValues(new Date().toISOString().slice(0, 10)),
  )
  const [error, setError] = useState<string | null>(null)

  const kinds: OperationKind[] = isAdmin
    ? ['APORTE', 'RESGATE_PESSOAL', 'DESPESA_PAIS', 'DESPESA_DIRETA']
    : ['APORTE', 'RESGATE_PESSOAL', 'DESPESA_PAIS']

  // Divisão só faz sentido para o cotista escolhido num APORTE.
  const { outstanding, monthly } = useRepayment(profileId, kind === 'APORTE')

  function patch(p: Partial<OperationValues>) {
    setValues((v) => ({ ...v, ...p }))
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const q = Number(values.quantity)
    const a = Number(values.amount)
    if (!values.bondId || !(q > 0) || !(a > 0)) {
      setError('Informe título, quantidade e valor positivos.')
      return
    }
    const ref = crypto.randomUUID()
    const noteTrim = values.note.trim()
    if (kind === 'APORTE') {
      const repoNum = effectiveReposition(
        a,
        values.repositionAmount,
        outstanding,
        monthly,
      )
      onStage({
        ref,
        op: 'create',
        kind: 'APORTE',
        profile_id: profileId,
        bond_id: values.bondId,
        quantity: q,
        amount_brl: a,
        event_date: values.eventDate,
        ...(noteTrim ? { note: noteTrim } : {}),
        ...(repoNum > 0 ? { reposition_amount: repoNum } : {}),
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
      bond_id: values.bondId,
      quantity: q,
      amount_brl: a,
      event_date: values.eventDate,
      ...(noteTrim ? { note: noteTrim } : {}),
    })
  }

  return (
    <ModalShell title="Novo lançamento" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <OperationFields
          kind={kind}
          kinds={kinds}
          onKindChange={setKind}
          bonds={bonds}
          values={values}
          onChange={patch}
          repaymentOutstanding={outstanding}
          monthlyExpected={monthly}
          belowType={
            isAdmin && kind !== 'DESPESA_DIRETA' ? (
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
            ) : undefined
          }
        />

        {error && <Alert kind="error">{error}</Alert>}

        <div className="flex gap-2">
          <Button type="submit" disabled={!values.bondId}>
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

// Casca compartilhada dos modais (overlay + card). Renderizada por portal no
// document.body: a view raiz tem `animate-rise`, que deixa um `transform` residual
// (fill-mode `both` → translateY(0)); um transform num ancestral ancora `position:
// fixed` nele em vez da viewport, então sem o portal o overlay/blur ficariam presos
// à área de conteúdo (header nítido, centralização errada). z-40 cobre o header
// (z-20) e o dropdown do avatar (z-30). Largura sm:max-w-xl dá folga ao grid de 3
// colunas do TreasuryAmountInput no desktop.
function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  // Esc fecha; trava o scroll do body enquanto o modal está aberto.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-bone/30 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md sm:max-w-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Card title={title}>{children}</Card>
      </div>
    </div>,
    document.body,
  )
}
