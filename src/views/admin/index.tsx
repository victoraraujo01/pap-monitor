import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '@/services/supabase'
import type { ObligationStatus, Tables } from '@/services/supabase'
import { useAuth } from '@/context/useAuth'
import {
  Alert,
  Button,
  Card,
  DateInput,
  Field,
  NumberInput,
  Select,
  TextInput,
} from '@/components/ui'
import { TreasuryAmountInput } from '@/components/TreasuryAmountInput'
import { bondLabel } from '@/lib/operations'
import { useDebtMode, type DebtMode } from '@/lib/fundSettings'
import { today } from '@/lib/prices'
import { formatBRL, formatDate, formatQuotas } from '@/lib/format'

type Bond = Pick<
  Tables<'treasury_bonds'>,
  | 'id'
  | 'api_reference_name'
  | 'display_name'
  | 'is_available_for_purchase'
  | 'current_price'
>
type Profile = Pick<Tables<'profiles'>, 'id' | 'name'>
// Título do CSV do Tesouro ainda não cadastrado (vem da Edge Function ?mode=catalog).
type BondCandidate = { api_reference_name: string; current_price: number }
// Colunas de view vêm nullable nos tipos gerados; estas são sempre preenchidas.
type Obligation = {
  id: string
  profile_id: string
  reference_month: string
  amount_expected: number
  // Status efetivo (derivado pela view v_monthly_obligations) + override manual.
  status: ObligationStatus
  status_override: ObligationStatus | null
}

type ContributionRow = {
  // Irmão que aportou o título na abertura (a cota dele deriva do valor aportado).
  profileId: string
  bondId: string
  quantity: string
  // Valor total da contribuição em D0; o preço unitário (= valor / quantidade) é derivado.
  amount: string
}
// Mensagem por card (erro ou sucesso), renderizada no próprio card — evita que o
// erro de uma ação caia no Alert do form de saldo de abertura.
type Msg = { kind: 'error' | 'success'; text: string } | null

// Frase que o admin precisa digitar para liberar a limpeza destrutiva.
const CLEAR_PHRASE = 'limpar tudo'

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
  const [contributions, setContributions] = useState<ContributionRow[]>([
    { profileId: '', bondId: '', quantity: '', amount: '' },
  ])
  // Valor escolhido para a cota de abertura. Define quantas cotas o PL gera
  // (total = PL / valor da cota) para a distribuição entre os irmãos.
  const [quotaPrice, setQuotaPrice] = useState('1')

  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [rebuildMsg, setRebuildMsg] = useState<Msg>(null)
  const [backfilling, setBackfilling] = useState(false)
  const [backfillMsg, setBackfillMsg] = useState<Msg>(null)
  // Confirmação textual da limpeza destrutiva (exige "limpar tudo").
  const [clearConfirm, setClearConfirm] = useState('')
  const [clearing, setClearing] = useState(false)
  const [clearMsg, setClearMsg] = useState<Msg>(null)

  // catálogo de títulos
  const [bondsBusy, setBondsBusy] = useState(false)
  const [catalogMsg, setCatalogMsg] = useState<Msg>(null)
  const [candidates, setCandidates] = useState<BondCandidate[] | null>(null)
  const [candidateName, setCandidateName] = useState('')
  const [newBondAvailable, setNewBondAvailable] = useState('true')

  // política de dívida de resgate (NOMINAL ⇄ PARTICIPACAO)
  const { mode: debtMode, reload: reloadDebtMode } = useDebtMode()
  const [debtBusy, setDebtBusy] = useState(false)
  const [debtMsg, setDebtMsg] = useState<Msg>(null)

  // obrigações mensais
  const [obAmount, setObAmount] = useState('1000')
  const [obligations, setObligations] = useState<Obligation[]>([])
  const [obFilter, setObFilter] = useState('')
  const [obBusy, setObBusy] = useState(false)
  const [obMsg, setObMsg] = useState<Msg>(null)

  function loadObligations() {
    return supabase
      .from('v_monthly_obligations')
      .select(
        'id, profile_id, reference_month, amount_expected, status, status_override',
      )
      .order('reference_month', { ascending: false })
      .then(({ data }) => setObligations((data ?? []) as Obligation[]))
  }

  function loadBonds() {
    return supabase
      .from('treasury_bonds')
      .select(
        'id, api_reference_name, display_name, is_available_for_purchase, current_price',
      )
      .order('api_reference_name')
      .then(({ data }) => setBonds(data ?? []))
  }

  async function handleSetDebtMode(m: DebtMode) {
    if (!profile?.id || m === debtMode || debtBusy) return
    setDebtBusy(true)
    setDebtMsg(null)
    const { error } = await supabase.rpc('set_debt_mode', {
      p_admin_id: profile.id,
      p_mode: m,
    })
    setDebtBusy(false)
    if (error) {
      setDebtMsg({ kind: 'error', text: error.message })
      return
    }
    setDebtMsg({
      kind: 'success',
      text: `Política alterada para ${
        m === 'PARTICIPACAO' ? 'Participação' : 'Nominal'
      }.`,
    })
    reloadDebtMode()
  }

  useEffect(() => {
    loadBonds()
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

  function updateContribution(i: number, patch: Partial<ContributionRow>) {
    setContributions((rows) =>
      rows.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    )
  }

  function addContribution() {
    setContributions((rows) => [
      ...rows,
      { profileId: '', bondId: '', quantity: '', amount: '' },
    ])
  }
  function removeContribution(i: number) {
    setContributions((rows) =>
      rows.length > 1 ? rows.filter((_, j) => j !== i) : rows,
    )
  }

  async function handleOpening(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setError(null)
    setSuccess(null)

    const p_contributions = contributions
      .filter(
        (c) =>
          c.profileId &&
          c.bondId &&
          Number(c.quantity) > 0 &&
          Number(c.amount) > 0,
      )
      .map((c) => ({
        profile_id: c.profileId,
        bond_id: c.bondId,
        quantity: Number(c.quantity),
        // Valor total aportado; o preço unitário e as cotas são derivados no banco.
        amount: Number(c.amount),
      }))

    if (p_contributions.length === 0) {
      setError(
        'Informe ao menos uma contribuição completa (irmão, título, quantidade e valor).',
      )
      return
    }

    setSubmitting(true)
    const { error } = await supabase.rpc('set_opening_balance', {
      p_admin_id: profile.id,
      p_date: date,
      p_contributions,
      p_quota_price: Number(quotaPrice) || 1,
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
    setRebuilding(true)
    const { error } = await supabase.rpc('rebuild_fund_history', {
      p_admin_id: profile.id,
    })
    setRebuilding(false)
    if (error) {
      setRebuildMsg({ kind: 'error', text: error.message })
      return
    }
    setRebuildMsg({
      kind: 'success',
      text: 'Histórico reconstruído: cotas e série diária de PL recalculadas.',
    })
  }

  // Aciona o backfill da Edge Function daily-pl: baixa o CSV oficial do Tesouro e
  // grava as cotações diárias por título em bond_price_history (lastro do rebuild).
  async function handleBackfill() {
    setBackfillMsg(null)
    setBackfilling(true)
    const { data, error } = await supabase.functions.invoke<{
      rows_parsed?: number
      rows_upserted?: number
      error?: string
    }>('daily-pl?mode=backfill', { method: 'POST' })
    setBackfilling(false)
    if (error || data?.error) {
      setBackfillMsg({
        kind: 'error',
        text: `Falha ao atualizar os preços do Tesouro: ${data?.error ?? error?.message}`,
      })
      return
    }
    setBackfillMsg({
      kind: 'success',
      text: `Preços diários atualizados: ${data?.rows_upserted ?? 0} cotação(ões) gravada(s) (de ${data?.rows_parsed ?? 0} lida(s)).`,
    })
  }

  // Busca na Edge Function (modo catalog) os títulos do CSV do Tesouro que ainda
  // não estão no catálogo — viram opções do dropdown de cadastro.
  async function handleFetchCandidates() {
    setCatalogMsg(null)
    setBondsBusy(true)
    const { data, error } = await supabase.functions.invoke<{
      candidates?: BondCandidate[]
      error?: string
    }>('daily-pl?mode=catalog', { method: 'POST' })
    setBondsBusy(false)
    if (error || data?.error) {
      setCatalogMsg({
        kind: 'error',
        text: `Falha ao consultar o Tesouro: ${data?.error ?? error?.message}`,
      })
      return
    }
    const list = data?.candidates ?? []
    setCandidates(list)
    setCandidateName('')
    if (list.length === 0) {
      setCatalogMsg({
        kind: 'success',
        text: 'Todos os títulos do Tesouro já estão no catálogo.',
      })
    }
  }

  // Cadastra o título selecionado no dropdown (api_reference_name já no formato do
  // parser → casa com o job diário). Semeia o current_price vindo do CSV.
  async function handleAddBond() {
    if (!profile || !candidateName) return
    const cand = candidates?.find((c) => c.api_reference_name === candidateName)
    if (!cand) return
    setCatalogMsg(null)
    setBondsBusy(true)
    const { error } = await supabase.rpc('upsert_treasury_bond', {
      p_admin_id: profile.id,
      p_api_reference_name: cand.api_reference_name,
      p_display_name: cand.api_reference_name,
      p_is_available: newBondAvailable === 'true',
      p_current_price: cand.current_price,
    })
    setBondsBusy(false)
    if (error) {
      setCatalogMsg({ kind: 'error', text: error.message })
      return
    }
    setCatalogMsg({
      kind: 'success',
      text: `Título "${cand.api_reference_name}" adicionado ao catálogo.`,
    })
    setCandidates((cs) =>
      (cs ?? []).filter((c) => c.api_reference_name !== cand.api_reference_name),
    )
    setCandidateName('')
    loadBonds()
  }

  // Liga/desliga a disponibilidade de compra de um título já cadastrado.
  async function toggleBondAvailability(b: Bond) {
    if (!profile) return
    setCatalogMsg(null)
    const { error } = await supabase.rpc('upsert_treasury_bond', {
      p_admin_id: profile.id,
      p_api_reference_name: b.api_reference_name,
      p_is_available: !b.is_available_for_purchase,
    })
    if (error) {
      setCatalogMsg({ kind: 'error', text: error.message })
      return
    }
    loadBonds()
  }

  // Limpeza destrutiva: apaga todo o livro de movimentações (inclusive a abertura)
  // e a série de PL, preservando o catálogo e os preços históricos. Trava na frase.
  async function handleClear() {
    if (!profile) return
    if (clearConfirm.trim().toLowerCase() !== CLEAR_PHRASE) return
    setClearMsg(null)
    setClearing(true)
    const { error } = await supabase.rpc('clear_all_movements', {
      p_admin_id: profile.id,
    })
    setClearing(false)
    if (error) {
      setClearMsg({ kind: 'error', text: error.message })
      return
    }
    setClearConfirm('')
    setClearMsg({
      kind: 'success',
      text: 'Todas as movimentações foram apagadas. Refaça o saldo de abertura para recomeçar.',
    })
    loadObligations()
  }

  async function handleGenerateObligations() {
    if (!profile) return
    setObMsg(null)
    setObBusy(true)
    const { data, error } = await supabase.rpc('generate_monthly_obligations', {
      p_admin_id: profile.id,
      p_amount: Number(obAmount),
    })
    setObBusy(false)
    if (error) {
      setObMsg({ kind: 'error', text: error.message })
      return
    }
    setObMsg({
      kind: 'success',
      text: `${data ?? 0} obrigação(ões) criada(s) da abertura até o mês corrente.`,
    })
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
      setObMsg({ kind: 'error', text: error.message })
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
      setObMsg({ kind: 'error', text: error.message })
      return
    }
    loadObligations()
  }

  // Remove PERMANENTEMENTE uma obrigação (soft-delete) — não recriada pelo gerador.
  async function deleteObligation(ob: Obligation) {
    if (!profile) return
    const mes = formatDate(ob.reference_month).slice(3)
    const nome = profileName.get(ob.profile_id) ?? 'cotista'
    if (
      !window.confirm(
        `Remover a obrigação de ${nome} (${mes})? Ela não será recriada ao gerar de novo.`,
      )
    )
      return
    const { error } = await supabase.rpc('delete_obligation', {
      p_admin_id: profile.id,
      p_obligation_id: ob.id,
    })
    if (error) {
      setObMsg({ kind: 'error', text: error.message })
      return
    }
    loadObligations()
  }

  // PL informado = soma do valor das contribuições válidas.
  const openingPl = contributions.reduce((sum, c) => {
    const a = Number(c.amount)
    return sum + (a > 0 ? a : 0)
  }, 0)
  const qp = Number(quotaPrice)
  // Total de cotas que o fundo emite a esse valor de cota.
  const totalQuotas = qp > 0 ? openingPl / qp : 0
  // Cotas por irmão DERIVADAS do valor que cada um aportou (valor ÷ cota de gênese).
  const perOwnerAmount = new Map<string, number>()
  for (const c of contributions) {
    const a = Number(c.amount)
    if (c.profileId && a > 0)
      perOwnerAmount.set(c.profileId, (perOwnerAmount.get(c.profileId) ?? 0) + a)
  }

  const profileName = new Map(profiles.map((p) => [p.id, p.name]))
  const obFiltered = obligations.filter(
    (o) => !obFilter || o.profile_id === obFilter,
  )
  const obPending = obFiltered.filter((o) => o.status === 'PENDING').length
  const obPaid = obFiltered.length - obPending

  return (
    <div className="animate-rise flex flex-col gap-6">
      <Card
        title="Política de dívida de resgate"
        description="Como o “resgate a repor” de cada cotista é medido. Nominal trava a dívida em reais (repôs o que tirou, quitou). Participação mede em cotas — restaura a fatia exata queimada, então o valor a repor oscila com a cota. Mudar recalcula as dívidas em aberto de todos (não altera lançamentos nem dispara reconstrução)."
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={debtMode === 'NOMINAL' ? 'primary' : 'secondary'}
              disabled={debtBusy}
              onClick={() => handleSetDebtMode('NOMINAL')}
            >
              Nominal (R$)
            </Button>
            <Button
              type="button"
              variant={debtMode === 'PARTICIPACAO' ? 'primary' : 'secondary'}
              disabled={debtBusy}
              onClick={() => handleSetDebtMode('PARTICIPACAO')}
            >
              Participação (cotas)
            </Button>
          </div>
          <p className="text-xs text-sage">
            Política atual:{' '}
            <span className="font-medium text-bone">
              {debtMode === 'PARTICIPACAO' ? 'Participação' : 'Nominal'}
            </span>
          </p>
          {debtMsg && <Alert kind={debtMsg.kind}>{debtMsg.text}</Alert>}
        </div>
      </Card>

      <Card
        title="Saldo de abertura"
        description="Ponto de partida do fundo. Cada contribuição é um título aportado por um irmão na data de corte (dá lastro ao PL e aos resgates); a cota de cada um deriva do valor que aportou. Reenviar substitui o saldo anterior."
      >
        <form onSubmit={handleOpening} className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Data de corte (D0)">
              <DateInput value={date} onChange={setDate} max={today()} />
            </Field>
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
          </div>

          <div className="flex flex-col gap-3">
            <span className="eyebrow text-sage">Contribuições (irmão × título)</span>
            <p className="-mt-1 text-xs text-sage">
              Cada linha é um título aportado por um irmão. O valor (= quantidade ×
              preço unitário em D0) define o lote e as cotas do irmão (valor ÷ valor
              da cota).
            </p>
            {contributions.map((c, i) => (
              <div
                key={i}
                className="flex flex-col gap-2 rounded-lg border border-line bg-raised/40 p-3"
              >
                <div className="flex items-end gap-2">
                  <div className="w-32 sm:w-44">
                    <Select
                      value={c.profileId}
                      onChange={(v) => updateContribution(i, { profileId: v })}
                      disabled={profiles.length === 0}
                    >
                      <option value="" disabled>
                        Irmão
                      </option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="flex-1">
                    <Select
                      value={c.bondId}
                      onChange={(v) => updateContribution(i, { bondId: v })}
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
                  </div>
                  <button
                    type="button"
                    onClick={() => removeContribution(i)}
                    disabled={contributions.length === 1}
                    className="h-[42px] rounded-lg border border-line px-3 text-sm text-bone-dim transition-colors hover:border-clay/50 hover:text-clay disabled:opacity-30"
                    aria-label="Remover contribuição"
                  >
                    ✕
                  </button>
                </div>
                <TreasuryAmountInput
                  bondId={c.bondId}
                  date={date}
                  priceSide="buy"
                  defaultMode="unit"
                  quantity={c.quantity}
                  amount={c.amount}
                  onQuantityChange={(v) => updateContribution(i, { quantity: v })}
                  onAmountChange={(v) => updateContribution(i, { amount: v })}
                  quantityPlaceholder="Qtd"
                  unitPlaceholder="Preço unit. D0"
                  amountLabel="Valor aportado (R$)"
                  quantityRequired={false}
                  amountRequired={false}
                />
              </div>
            ))}
            <div>
              <Button variant="secondary" onClick={addContribution}>
                + Adicionar contribuição
              </Button>
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-line bg-pine/40 p-4">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
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
              </dl>
              {perOwnerAmount.size > 0 && (
                <dl className="flex flex-col gap-2 border-t border-line pt-3">
                  {profiles
                    .filter((p) => (perOwnerAmount.get(p.id) ?? 0) > 0)
                    .map((p) => {
                      const cot = qp > 0 ? (perOwnerAmount.get(p.id) ?? 0) / qp : 0
                      const pct =
                        totalQuotas > 0 ? (cot / totalQuotas) * 100 : 0
                      return (
                        <div
                          key={p.id}
                          className="flex items-baseline justify-between gap-2"
                        >
                          <dt className="text-sm text-bone-dim">{p.name}</dt>
                          <dd className="nums text-sm text-bone">
                            {formatQuotas(cot)} cota(s) · {pct.toFixed(1)}%
                          </dd>
                        </div>
                      )
                    })}
                </dl>
              )}
            </div>
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
        title="Catálogo de títulos"
        description="Títulos que o fundo acompanha. Só os títulos cadastrados aqui recebem atualização de preço do job diário — quando o Tesouro lançar um vencimento novo, busque-o abaixo e cadastre. A disponibilidade controla se o título aparece no dropdown de aporte."
      >
        <div className="flex flex-col gap-6">
          {/* Cadastro de título novo a partir do CSV do Tesouro */}
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-pine/40 p-4">
            <div>
              <h3 className="font-display text-base font-medium text-bone">
                Adicionar título do Tesouro
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-bone-dim">
                Consulta o CSV oficial e lista os títulos Selic/IPCA+ ainda não
                cadastrados. Escolher pelo dropdown garante o nome exato que o job
                diário usa para casar o preço.
              </p>
            </div>

            {candidates === null ? (
              <div>
                <Button
                  variant="secondary"
                  onClick={handleFetchCandidates}
                  disabled={bondsBusy}
                >
                  {bondsBusy ? 'Consultando…' : 'Buscar títulos no Tesouro'}
                </Button>
              </div>
            ) : candidates.length === 0 ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-bone-dim">
                  Nenhum título novo disponível.
                </p>
                <Button
                  variant="secondary"
                  onClick={handleFetchCandidates}
                  disabled={bondsBusy}
                >
                  {bondsBusy ? 'Consultando…' : 'Buscar de novo'}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-56 flex-1">
                  <Field label="Título disponível">
                    <Select
                      value={candidateName}
                      onChange={setCandidateName}
                    >
                      <option value="" disabled>
                        Selecione um título
                      </option>
                      {candidates.map((c) => (
                        <option
                          key={c.api_reference_name}
                          value={c.api_reference_name}
                        >
                          {c.api_reference_name} · {formatBRL(c.current_price)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div className="w-40">
                  <Field label="Disponível p/ compra">
                    <Select
                      value={newBondAvailable}
                      onChange={setNewBondAvailable}
                    >
                      <option value="true">Sim</option>
                      <option value="false">Não</option>
                    </Select>
                  </Field>
                </div>
                <Button onClick={handleAddBond} disabled={bondsBusy || !candidateName}>
                  {bondsBusy ? 'Adicionando…' : 'Adicionar'}
                </Button>
              </div>
            )}

            {catalogMsg && (
              <Alert kind={catalogMsg.kind}>{catalogMsg.text}</Alert>
            )}
          </div>

          {/* Catálogo atual */}
          {bonds.length === 0 ? (
            <p className="text-sm text-bone-dim">Nenhum título cadastrado.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {bonds.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between gap-3 py-2.5 first:pt-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-bone">{bondLabel(b)}</p>
                    <p className="nums text-xs text-sage">
                      {b.current_price != null
                        ? formatBRL(b.current_price)
                        : 'sem preço'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={`eyebrow ${
                        b.is_available_for_purchase ? 'text-emerald' : 'text-sage'
                      }`}
                    >
                      {b.is_available_for_purchase ? 'Comprável' : 'Indisponível'}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleBondAvailability(b)}
                      className="rounded-lg border border-line px-2.5 py-1 text-xs text-bone-dim transition-colors hover:border-brass/50 hover:text-bone"
                    >
                      {b.is_available_for_purchase
                        ? 'Tornar indisponível'
                        : 'Tornar comprável'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card
        title="Gestão de histórico"
        description="Manutenção da série histórica do fundo: preços diários do Tesouro, reconstrução da curva de PL e limpeza do livro de movimentações."
      >
        <div className="flex flex-col divide-y divide-line">
          {/* 1 — Backfill dos preços diários do Tesouro */}
          <div className="flex flex-col gap-3 pb-6">
            <div>
              <h3 className="font-display text-base font-medium text-bone">
                Atualizar preços diários do Tesouro
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-bone-dim">
                Baixa o histórico oficial de Preços e Taxas do Tesouro
                Transparente e grava as cotações diárias por título. É o lastro da
                reconstrução do histórico — rode após um reset ou quando faltarem
                preços. Pode levar alguns segundos (CSV de ~13MB).
              </p>
            </div>
            {backfillMsg && (
              <Alert kind={backfillMsg.kind}>{backfillMsg.text}</Alert>
            )}
            <div>
              <Button
                variant="secondary"
                onClick={handleBackfill}
                disabled={backfilling}
              >
                {backfilling ? 'Atualizando…' : 'Atualizar preços diários'}
              </Button>
            </div>
          </div>

          {/* 2 — Reconstrução da curva de PL */}
          <div className="flex flex-col gap-3 py-6">
            <div>
              <h3 className="font-display text-base font-medium text-bone">
                Reconstruir histórico de PL
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-bone-dim">
                Reprocessa todos os eventos em ordem cronológica contra os preços
                históricos, recompondo as cotas de cada lançamento pela cotação do
                dia e gerando a série diária de PL/cota desde o primeiro evento.
                Aportes, resgates e reinvestimentos já reconstroem a curva
                automaticamente ao serem lançados — use este botão após{' '}
                <strong className="font-medium text-bone">atualizar os preços</strong>{' '}
                (ação acima) para que a série passe a refletir as novas cotações.
              </p>
            </div>
            {rebuildMsg && (
              <Alert kind={rebuildMsg.kind}>{rebuildMsg.text}</Alert>
            )}
            <div>
              <Button
                variant="secondary"
                onClick={handleRebuild}
                disabled={rebuilding}
              >
                {rebuilding ? 'Reconstruindo…' : 'Reconstruir histórico'}
              </Button>
            </div>
          </div>

          {/* 3 — Limpeza destrutiva do livro de movimentações */}
          <div className="flex flex-col gap-3 pt-6">
            <div>
              <h3 className="font-display text-base font-medium text-clay">
                Limpar todas as movimentações
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-bone-dim">
                Apaga <strong className="font-medium">todos</strong> os aportes,
                resgates, despesas, reinvestimentos, obrigações mensais e a série
                de PL — inclusive o saldo de abertura. Preserva apenas o catálogo
                de títulos e os preços históricos diários. Ação{' '}
                <strong className="font-medium text-clay">irreversível</strong>:
                para confirmar, escreva{' '}
                <span className="font-medium text-clay">{CLEAR_PHRASE}</span> no
                campo abaixo.
              </p>
            </div>
            {clearMsg && <Alert kind={clearMsg.kind}>{clearMsg.text}</Alert>}
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-56">
                <Field label="Confirmação">
                  <TextInput
                    value={clearConfirm}
                    onChange={setClearConfirm}
                    placeholder={CLEAR_PHRASE}
                  />
                </Field>
              </div>
              <Button
                variant="danger"
                onClick={handleClear}
                disabled={
                  clearing ||
                  clearConfirm.trim().toLowerCase() !== CLEAR_PHRASE
                }
              >
                {clearing ? 'Limpando…' : 'Limpar tudo'}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card
        title="Obrigações mensais"
        description="Gera as faturas de aporte (uma por cotista por mês) da data de início do fundo até o mês corrente. O status de cada mês é automático: quitado quando os aportes do cotista cobrem ≥90% do esperado acumulado até aquele mês. Use o override (Marcar paga) só para casos fora do sistema — um mês marcado como pago some da dívida do saldo total. Remover apaga o mês de vez (não é recriado ao gerar de novo). Gerar de novo não duplica nem sobrescreve o que já existe."
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

          {obMsg && <Alert kind={obMsg.kind}>{obMsg.text}</Alert>}

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
                {/* Desktop: tabela em 5 colunas com cabeçalho fixo. */}
                <table className="hidden w-full text-sm sm:table">
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
                              <button
                                type="button"
                                onClick={() => deleteObligation(o)}
                                className="rounded-lg border border-line px-2.5 py-1 text-xs text-bone-dim transition-colors hover:border-clay/50 hover:text-clay"
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

                {/* Mobile: cada obrigação empilhada (cotista+valor / mês+status / ações). */}
                <ul className="flex flex-col sm:hidden">
                  {obFiltered.map((o) => {
                    const paid = o.status === 'PAID'
                    const overridden = o.status_override !== null
                    return (
                      <li
                        key={o.id}
                        className="flex flex-col gap-1.5 border-t border-line py-3 first:border-t-0 first:pt-0"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm text-bone">
                            {profileName.get(o.profile_id) ?? '—'}
                          </p>
                          <p className="nums shrink-0 text-sm text-bone">
                            {formatBRL(o.amount_expected ?? 0)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="nums text-xs text-bone-dim">
                            {formatDate(o.reference_month).slice(3)}
                          </span>
                          <span
                            className={`eyebrow ${paid ? 'text-emerald' : 'text-clay'}`}
                          >
                            {paid ? 'Paga' : 'Pendente'}
                          </span>
                          {overridden && (
                            <span className="eyebrow rounded-full border border-line px-1.5 py-0.5 text-[0.5rem] text-sage">
                              manual
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex gap-1.5">
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
                          <button
                            type="button"
                            onClick={() => deleteObligation(o)}
                            className="rounded-lg border border-line px-2.5 py-1 text-xs text-bone-dim transition-colors hover:border-clay/50 hover:text-clay"
                          >
                            Remover
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}
