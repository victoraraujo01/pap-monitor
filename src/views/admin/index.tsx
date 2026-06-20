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
type Profile = Pick<Tables<'profiles'>, 'id' | 'name'>
type Event = Pick<
  Tables<'transactions'>,
  'id' | 'type' | 'amount_brl' | 'event_date' | 'profile_id' | 'is_opening'
>

type LotRow = { bondId: string; quantity: string; price: string }
type QuotaRow = { quotas: string; amount: string }

const TYPE_LABELS: Record<string, string> = {
  APORTE: 'Aporte',
  RESGATE_PESSOAL: 'Resgate',
  DESPESA_PAIS: 'Despesa',
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function bondLabel(b: Bond): string {
  return b.display_name ?? b.api_reference_name
}

// Área de administração (Fase 1 do histórico). Restrita a ADMIN:
// - Saldo de abertura (genesis): carteira em D0 (lotes reais) + cotas por irmão.
// - Gestão de eventos: lista e remoção de aportes lançados.
export function AdminView() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'ADMIN'

  const [bonds, setBonds] = useState<Bond[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [events, setEvents] = useState<Event[]>([])

  const [date, setDate] = useState(today())
  const [lots, setLots] = useState<LotRow[]>([
    { bondId: '', quantity: '', price: '' },
  ])
  const [quotas, setQuotas] = useState<Record<string, QuotaRow>>({})

  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rebuilding, setRebuilding] = useState(false)
  const [rebuildMsg, setRebuildMsg] = useState<string | null>(null)

  const loadEvents = useCallback(() => {
    return supabase
      .from('transactions')
      .select('id, type, amount_brl, event_date, profile_id, is_opening')
      .order('event_date', { ascending: false })
      .limit(20)
      .then(({ data }) => setEvents(data ?? []))
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

  const profileName = new Map(profiles.map((p) => [p.id, p.name]))

  if (!isAdmin) {
    return (
      <div className="animate-rise">
        <Card title="Acesso restrito">
          <p className="text-sm text-bone-dim">
            Esta área é exclusiva de administradores do fundo.
          </p>
        </Card>
      </div>
    )
  }

  function updateLot(i: number, patch: Partial<LotRow>) {
    setLots((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }
  function addLot() {
    setLots((rows) => [...rows, { bondId: '', quantity: '', price: '' }])
  }
  function removeLot(i: number) {
    setLots((rows) => (rows.length > 1 ? rows.filter((_, j) => j !== i) : rows))
  }
  function updateQuota(pid: string, patch: Partial<QuotaRow>) {
    setQuotas((q) => {
      const prev = q[pid] ?? { quotas: '', amount: '' }
      return { ...q, [pid]: { ...prev, ...patch } }
    })
  }

  async function handleOpening(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setError(null)
    setSuccess(null)

    const p_lots = lots
      .filter((l) => l.bondId && Number(l.quantity) > 0 && Number(l.price) > 0)
      .map((l) => ({
        bond_id: l.bondId,
        quantity: Number(l.quantity),
        price: Number(l.price),
      }))
    const p_quotas = profiles
      .map((p) => ({ pid: p.id, row: quotas[p.id] }))
      .filter((x) => x.row && Number(x.row.quotas) > 0)
      .map((x) => ({
        profile_id: x.pid,
        quotas: Number(x.row.quotas),
        amount: Number(x.row.amount) || 0,
      }))

    if (p_lots.length === 0 || p_quotas.length === 0) {
      setError('Informe ao menos um título na carteira e as cotas de um cotista.')
      return
    }

    setSubmitting(true)
    const { error } = await supabase.rpc('set_opening_balance', {
      p_admin_id: profile.id,
      p_date: date,
      p_lots,
      p_quotas,
    })
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    setSuccess('Saldo de abertura gravado e patrimônio recalculado.')
    loadEvents()
  }

  async function handleRebuild() {
    if (!profile) return
    setRebuildMsg(null)
    setError(null)
    setRebuilding(true)
    const { error } = await supabase.rpc('rebuild_fund_history', {
      p_admin_id: profile.id,
    })
    setRebuilding(false)
    if (error) {
      setError(error.message)
      return
    }
    setRebuildMsg('Histórico reconstruído: cotas e série diária de PL recalculadas.')
    loadEvents()
  }

  async function handleDelete(ev: Event) {
    if (!profile) return
    setBusyId(ev.id)
    const { error } = await supabase.rpc('delete_transaction', {
      p_admin_id: profile.id,
      p_transaction_id: ev.id,
    })
    setBusyId(null)
    if (error) {
      setError(error.message)
      return
    }
    setError(null)
    loadEvents()
  }

  return (
    <div className="animate-rise flex flex-col gap-6">
      <Card
        title="Saldo de abertura"
        description="Ponto de partida do fundo. A carteira na data de corte entra como lotes reais (dão lastro ao PL e aos resgates); as cotas por irmão definem a participação. Reenviar substitui o saldo anterior."
      >
        <form onSubmit={handleOpening} className="flex flex-col gap-5">
          <Field label="Data de corte (D0)">
            <DateInput value={date} onChange={setDate} max={today()} />
          </Field>

          <div className="flex flex-col gap-3">
            <span className="eyebrow text-sage">Carteira em D0</span>
            {lots.map((l, i) => (
              <div
                key={i}
                className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
              >
                <Select
                  value={l.bondId}
                  onChange={(v) => updateLot(i, { bondId: v })}
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
                <div className="w-full sm:w-28">
                  <NumberInput
                    value={l.quantity}
                    onChange={(v) => updateLot(i, { quantity: v })}
                    step="0.000001"
                    min="0"
                    placeholder="Qtd"
                    required={false}
                  />
                </div>
                <div className="w-full sm:w-32">
                  <NumberInput
                    value={l.price}
                    onChange={(v) => updateLot(i, { price: v })}
                    step="0.01"
                    min="0"
                    placeholder="Preço D0"
                    required={false}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeLot(i)}
                  disabled={lots.length === 1}
                  className="h-[42px] rounded-lg border border-line px-3 text-sm text-bone-dim transition-colors hover:border-clay/50 hover:text-clay disabled:opacity-30"
                  aria-label="Remover título"
                >
                  ✕
                </button>
              </div>
            ))}
            <div>
              <Button variant="secondary" onClick={addLot}>
                + Adicionar título
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <span className="eyebrow text-sage">Cotas por irmão</span>
            {profiles.length === 0 ? (
              <p className="text-sm text-bone-dim">
                Nenhum cotista cadastrado ainda.
              </p>
            ) : (
              profiles.map((p) => (
                <div
                  key={p.id}
                  className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end"
                >
                  <span className="self-center text-sm font-medium text-bone">
                    {p.name}
                  </span>
                  <div className="w-full sm:w-36">
                    <NumberInput
                      value={quotas[p.id]?.quotas ?? ''}
                      onChange={(v) => updateQuota(p.id, { quotas: v })}
                      step="0.000001"
                      min="0"
                      placeholder="Cotas"
                      required={false}
                    />
                  </div>
                  <div className="w-full sm:w-36">
                    <NumberInput
                      value={quotas[p.id]?.amount ?? ''}
                      onChange={(v) => updateQuota(p.id, { amount: v })}
                      step="0.01"
                      min="0"
                      placeholder="Aportado (R$)"
                      required={false}
                    />
                  </div>
                </div>
              ))
            )}
            <p className="text-xs text-sage">
              A proporção das cotas define a participação. Use o total aportado de
              cada um como número de cotas (cota de abertura ≈ R$1,00).
            </p>
          </div>

          {error && <Alert kind="error">{error}</Alert>}
          {success && <Alert kind="success">{success}</Alert>}

          <div>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Gravando…' : 'Gravar saldo de abertura'}
            </Button>
          </div>
        </form>
      </Card>

      <Card
        title="Reconstruir histórico"
        description="Reprocessa todos os eventos em ordem cronológica contra os preços históricos, recompondo as cotas de cada lançamento pela cotação do dia e gerando a série diária de PL/cota desde o primeiro evento. Requer os preços históricos já carregados (modo backfill da função diária)."
      >
        {rebuildMsg && <Alert kind="success">{rebuildMsg}</Alert>}
        <div className="mt-1">
          <Button onClick={handleRebuild} disabled={rebuilding}>
            {rebuilding ? 'Reconstruindo…' : 'Reconstruir histórico'}
          </Button>
        </div>
      </Card>

      <Card
        title="Eventos lançados"
        description="Últimos lançamentos. Aportes podem ser removidos; reverter saídas chega na Fase 2."
      >
        {events.length === 0 ? (
          <p className="text-sm text-bone-dim">Nenhum evento ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="eyebrow pb-2 text-sage">Data</th>
                <th className="eyebrow pb-2 text-sage">Cotista</th>
                <th className="eyebrow pb-2 text-sage">Tipo</th>
                <th className="eyebrow pb-2 text-right text-sage">Valor</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id} className="border-t border-line">
                  <td className="nums py-2.5 text-bone-dim">
                    {formatDate(ev.event_date)}
                  </td>
                  <td className="py-2.5 text-bone-dim">
                    {ev.profile_id ? (profileName.get(ev.profile_id) ?? '—') : '—'}
                  </td>
                  <td className="py-2.5 text-bone">
                    {TYPE_LABELS[ev.type] ?? ev.type}
                    {ev.is_opening && (
                      <span className="eyebrow ml-2 rounded-full border border-brass/30 px-1.5 py-0.5 text-[0.5rem] text-brass-bright">
                        abertura
                      </span>
                    )}
                  </td>
                  <td className="nums py-2.5 text-right text-bone">
                    {formatBRL(ev.amount_brl)}
                  </td>
                  <td className="py-2.5 text-right">
                    {ev.type === 'APORTE' && !ev.is_opening && (
                      <button
                        type="button"
                        onClick={() => handleDelete(ev)}
                        disabled={busyId === ev.id}
                        className="rounded-lg border border-line px-2.5 py-1 text-xs text-bone-dim transition-colors hover:border-clay/50 hover:text-clay disabled:opacity-40"
                      >
                        Remover
                      </button>
                    )}
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
