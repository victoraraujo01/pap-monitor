import { useEffect, useState } from 'react'
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
import { formatBRL, formatDate, formatQuotas } from '@/lib/format'

type Bond = Pick<
  Tables<'treasury_bonds'>,
  'id' | 'api_reference_name' | 'display_name'
>
type Profile = Pick<Tables<'profiles'>, 'id' | 'name'>
// Colunas de view vêm nullable nos tipos gerados; estas são sempre preenchidas.
type Obligation = {
  id: string
  profile_id: string
  reference_month: string
  amount_expected: number
  status: Tables<'monthly_obligations'>['status']
  status_override: Tables<'monthly_obligations'>['status'] | null
}

type LotRow = {
  bondId: string
  quantity: string
  price: string
  // Preço sugerido a partir da bond_price_history (carry-forward) para a data D0.
  // undefined = ainda não buscado; null = sem preço na base.
  hint?: number | null
  hintLoading?: boolean
}
type QuotaRow = { quotas: string; amount: string }

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function bondLabel(b: Bond): string {
  return b.display_name ?? b.api_reference_name
}

// Área de administração. Restrita a ADMIN:
// - Saldo de abertura (genesis): carteira em D0 (lotes reais) + cotas por irmão.
// - Reconstrução do histórico (replay cronológico).
// A gestão de eventos (editar/remover) vive no histórico (/historico), aberto a
// todos os cotistas para os próprios lançamentos.
export function AdminView() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'ADMIN'

  const [bonds, setBonds] = useState<Bond[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])

  const [date, setDate] = useState(today())
  const [lots, setLots] = useState<LotRow[]>([
    { bondId: '', quantity: '', price: '' },
  ])
  const [quotas, setQuotas] = useState<Record<string, QuotaRow>>({})
  // Valor escolhido para a cota de abertura. Define quantas cotas o PL gera
  // (total = PL / valor da cota) para a distribuição entre os irmãos.
  const [quotaPrice, setQuotaPrice] = useState('1')

  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [rebuildMsg, setRebuildMsg] = useState<string | null>(null)

  // obrigações mensais
  const [obAmount, setObAmount] = useState('1000')
  const [obligations, setObligations] = useState<Obligation[]>([])
  const [obFilter, setObFilter] = useState('')
  const [obBusy, setObBusy] = useState(false)
  const [obMsg, setObMsg] = useState<string | null>(null)

  function loadObligations() {
    return supabase
      .from('v_monthly_obligations')
      .select(
        'id, profile_id, reference_month, amount_expected, status, status_override',
      )
      .order('reference_month', { ascending: false })
      .then(({ data }) => setObligations((data ?? []) as Obligation[]))
  }

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
    loadObligations()
  }, [])

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

  // Espelha pap_price_on: último preço ≤ data; senão o primeiro posterior.
  async function fetchPriceOn(
    bondId: string,
    onDate: string,
  ): Promise<number | null> {
    const before = await supabase
      .from('bond_price_history')
      .select('price')
      .eq('bond_id', bondId)
      .lte('date', onDate)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (before.data) return before.data.price
    const after = await supabase
      .from('bond_price_history')
      .select('price')
      .eq('bond_id', bondId)
      .gt('date', onDate)
      .order('date', { ascending: true })
      .limit(1)
      .maybeSingle()
    return after.data?.price ?? null
  }

  // Busca o preço da base para a linha i e preenche "Preço D0" quando estiver vazio
  // (nunca sobrescreve um valor digitado à mão). Guarda a dica para exibir/aplicar.
  async function suggestPrice(i: number, bondId: string, onDate: string) {
    if (!bondId || !onDate) return
    updateLot(i, { hintLoading: true })
    const price = await fetchPriceOn(bondId, onDate)
    setLots((rows) =>
      rows.map((r, j) =>
        j === i
          ? {
              ...r,
              hint: price,
              hintLoading: false,
              price: r.price === '' && price != null ? String(price) : r.price,
            }
          : r,
      ),
    )
  }

  function changeDate(v: string) {
    setDate(v)
    lots.forEach((l, i) => {
      if (l.bondId) suggestPrice(i, l.bondId, v)
    })
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
      setError(
        'Informe ao menos um título na carteira e as cotas de um cotista.',
      )
      return
    }

    if (!distributionBalanced) {
      setError(
        `As cotas distribuídas (${formatQuotas(distributedQuotas)}) devem fechar com o total do fundo (${formatQuotas(totalQuotas)}). Pendentes: ${formatQuotas(pendingQuotas)}.`,
      )
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
    setRebuildMsg(
      'Histórico reconstruído: cotas e série diária de PL recalculadas.',
    )
  }

  async function handleGenerateObligations() {
    if (!profile) return
    setObMsg(null)
    setError(null)
    setObBusy(true)
    const { data, error } = await supabase.rpc('generate_monthly_obligations', {
      p_admin_id: profile.id,
      p_amount: Number(obAmount),
    })
    setObBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    setObMsg(
      `${data ?? 0} obrigação(ões) criada(s) da abertura até o mês corrente.`,
    )
    loadObligations()
  }

  // Força um override manual oposto ao status efetivo atual. O status normal é
  // derivado (regra FIFO-90%); o override é a exceção do admin.
  async function toggleObligation(ob: Obligation) {
    if (!profile) return
    const next = ob.status === 'PAID' ? 'PENDING' : 'PAID'
    const { error } = await supabase.rpc('set_obligation_status', {
      p_admin_id: profile.id,
      p_obligation_id: ob.id,
      p_status: next,
    })
    if (error) {
      setError(error.message)
      return
    }
    loadObligations()
  }

  // Remove o override (volta ao status automático). Omitir p_status = NULL no SQL.
  async function clearOverride(ob: Obligation) {
    if (!profile) return
    const { error } = await supabase.rpc('set_obligation_status', {
      p_admin_id: profile.id,
      p_obligation_id: ob.id,
    })
    if (error) {
      setError(error.message)
      return
    }
    loadObligations()
  }

  // PL informado = soma dos lotes válidos (qtd × preço unitário).
  const openingPl = lots.reduce((sum, l) => {
    const q = Number(l.quantity)
    const p = Number(l.price)
    return sum + (q > 0 && p > 0 ? q * p : 0)
  }, 0)
  const qp = Number(quotaPrice)
  // Total de cotas que o fundo emite a esse valor de cota.
  const totalQuotas = qp > 0 ? openingPl / qp : 0
  // Cotas já lançadas nos campos por irmão.
  const distributedQuotas = profiles.reduce((sum, p) => {
    const q = Number(quotas[p.id]?.quotas)
    return sum + (q > 0 ? q : 0)
  }, 0)
  const pendingQuotas = totalQuotas - distributedQuotas
  // Tolerância p/ ruído de ponto flutuante (cotas têm 6 casas no banco).
  const distributionBalanced = Math.abs(pendingQuotas) < 5e-7 && totalQuotas > 0

  const profileName = new Map(profiles.map((p) => [p.id, p.name]))
  const obFiltered = obligations.filter(
    (o) => !obFilter || o.profile_id === obFilter,
  )
  const obPending = obFiltered.filter((o) => o.status === 'PENDING').length
  const obPaid = obFiltered.length - obPending

  return (
    <div className="animate-rise flex flex-col gap-6">
      <Card
        title="Saldo de abertura"
        description="Ponto de partida do fundo. A carteira na data de corte entra como lotes reais (dão lastro ao PL e aos resgates); as cotas por irmão definem a participação. Reenviar substitui o saldo anterior."
      >
        <form onSubmit={handleOpening} className="flex flex-col gap-5">
          <Field label="Data de corte (D0)">
            <DateInput value={date} onChange={changeDate} max={today()} />
          </Field>

          <div className="flex flex-col gap-3">
            <span className="eyebrow text-sage">Carteira em D0</span>
            <p className="-mt-1 text-xs text-sage">
              Preço unitário do título na data (PU). O valor do lote ={' '}
              quantidade × preço unitário.
            </p>
            {lots.map((l, i) => (
              <div
                key={i}
                className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto] sm:items-end"
              >
                <Select
                  value={l.bondId}
                  onChange={(v) => {
                    updateLot(i, { bondId: v })
                    suggestPrice(i, v, date)
                  }}
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
                <div className="w-full sm:w-20">
                  <NumberInput
                    value={l.quantity}
                    onChange={(v) => updateLot(i, { quantity: v })}
                    step="0.000001"
                    min="0"
                    placeholder="Qtd"
                    required={false}
                  />
                </div>
                <div className="relative w-full sm:w-48">
                  <NumberInput
                    value={l.price}
                    onChange={(v) => updateLot(i, { price: v })}
                    step="0.01"
                    min="0"
                    placeholder="Preço unit. D0"
                    required={false}
                    inputClassName={
                      l.hint != null && String(l.hint) !== l.price
                        ? 'pr-[5.5rem]'
                        : undefined
                    }
                  />
                  {l.bondId &&
                    (l.hintLoading ? (
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-sage">
                        buscando…
                      </span>
                    ) : l.hint != null && String(l.hint) !== l.price ? (
                      <button
                        type="button"
                        onClick={() => updateLot(i, { price: String(l.hint) })}
                        title={`Preço-base na data: ${formatBRL(l.hint)} · clique para usar`}
                        className="nums absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md border border-brass/40 bg-pine/70 px-1.5 py-0.5 text-xs text-brass transition-colors hover:border-brass hover:bg-pine hover:text-brass-bright"
                      >
                        {formatBRL(l.hint)}
                      </button>
                    ) : null)}
                </div>
                <div
                  className="nums flex h-[42px] w-full items-center justify-end rounded-lg border border-line bg-pine/30 px-3 text-sm text-bone-dim sm:w-36"
                  title="Valor do lote (quantidade × preço unitário)"
                >
                  {Number(l.quantity) > 0 && Number(l.price) > 0
                    ? formatBRL(Number(l.quantity) * Number(l.price))
                    : '—'}
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

            <div className="flex flex-col gap-4 rounded-lg border border-line bg-pine/40 p-4">
              <div className="w-44">
                <Field label="Valor inicial da cota (R$)">
                  <NumberInput
                    value={quotaPrice}
                    onChange={setQuotaPrice}
                    step="0.01"
                    min="0"
                    placeholder="1,00"
                    required={false}
                  />
                </Field>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                <div>
                  <dt className="eyebrow text-sage">PL informado</dt>
                  <dd className="nums mt-0.5 text-sm text-bone">
                    {formatBRL(openingPl)}
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow text-sage">Total de cotas</dt>
                  <dd className="nums mt-0.5 text-sm text-bone">
                    {formatQuotas(totalQuotas)}
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow text-sage">Distribuídas</dt>
                  <dd className="nums mt-0.5 text-sm text-bone">
                    {formatQuotas(distributedQuotas)}
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow text-sage">Pendentes</dt>
                  <dd
                    className={`nums mt-0.5 text-sm ${
                      distributionBalanced
                        ? 'text-emerald'
                        : pendingQuotas < 0
                          ? 'text-clay'
                          : 'text-bone'
                    }`}
                  >
                    {distributionBalanced ? '0' : formatQuotas(pendingQuotas)}
                  </dd>
                </div>
              </dl>
              {totalQuotas > 0 && !distributionBalanced && (
                <p className="text-xs text-sage">
                  {pendingQuotas > 0
                    ? `Faltam ${formatQuotas(pendingQuotas)} cota(s) a distribuir.`
                    : `Distribuídas ${formatQuotas(-pendingQuotas)} cota(s) além do total.`}
                </p>
              )}
            </div>

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
              A proporção das cotas define a participação. Distribua o total de
              cotas (PL ÷ valor da cota) entre os irmãos — as pendentes devem
              chegar a zero.
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
        title="Obrigações mensais"
        description="Gera as faturas de aporte (uma por cotista por mês) da data de início do fundo até o mês corrente. O status de cada mês é automático: quitado quando os aportes do cotista cobrem ≥90% do esperado acumulado até aquele mês. Use o override só para casos fora do sistema. Gerar de novo não duplica nem sobrescreve o que já existe."
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Field label="Valor mensal (R$)">
                <NumberInput
                  value={obAmount}
                  onChange={setObAmount}
                  step="0.01"
                  min="0"
                  placeholder="1000,00"
                  required={false}
                />
              </Field>
            </div>
            <Button onClick={handleGenerateObligations} disabled={obBusy}>
              {obBusy ? 'Gerando…' : 'Gerar obrigações'}
            </Button>
          </div>

          {obMsg && <Alert kind="success">{obMsg}</Alert>}

          {obligations.length === 0 ? (
            <p className="text-sm text-bone-dim">
              Nenhuma obrigação gerada ainda.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="w-52">
                  <Field label="Filtrar por cotista">
                    <Select value={obFilter} onChange={setObFilter}>
                      <option value="">Todos</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <span className="text-xs text-sage">
                  <span className="nums text-clay">{obPending}</span>{' '}
                  pendente(s) ·{' '}
                  <span className="nums text-emerald">{obPaid}</span> paga(s)
                </span>
              </div>

              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-moss/95">
                    <tr className="text-left">
                      <th className="eyebrow pb-2 text-sage">Cotista</th>
                      <th className="eyebrow pb-2 text-sage">Mês</th>
                      <th className="eyebrow pb-2 text-right text-sage">
                        Valor
                      </th>
                      <th className="eyebrow pb-2 text-sage">Status</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {obFiltered.map((o) => {
                      const paid = o.status === 'PAID'
                      const overridden = o.status_override !== null
                      return (
                        <tr key={o.id} className="border-t border-line">
                          <td className="py-2 text-bone-dim">
                            {profileName.get(o.profile_id) ?? '—'}
                          </td>
                          <td className="nums py-2 text-bone-dim">
                            {formatDate(o.reference_month).slice(3)}
                          </td>
                          <td className="nums py-2 text-right text-bone">
                            {formatBRL(o.amount_expected ?? 0)}
                          </td>
                          <td className="py-2">
                            <span
                              className={`eyebrow ${paid ? 'text-emerald' : 'text-clay'}`}
                            >
                              {paid ? 'Paga' : 'Pendente'}
                            </span>
                            {overridden && (
                              <span className="eyebrow ml-2 rounded-full border border-line px-1.5 py-0.5 text-[0.5rem] text-sage">
                                manual
                              </span>
                            )}
                          </td>
                          <td className="py-2 text-right">
                            <div className="flex justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => toggleObligation(o)}
                                className="rounded-lg border border-line px-2.5 py-1 text-xs text-bone-dim transition-colors hover:border-brass/50 hover:text-bone"
                              >
                                {paid ? 'Marcar pendente' : 'Marcar paga'}
                              </button>
                              {overridden && (
                                <button
                                  type="button"
                                  onClick={() => clearOverride(o)}
                                  className="rounded-lg border border-line px-2.5 py-1 text-xs text-bone-dim transition-colors hover:border-brass/50 hover:text-bone"
                                >
                                  Auto
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}
