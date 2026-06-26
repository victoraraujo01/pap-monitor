import { beforeEach, afterAll, describe, expect, it } from 'vitest'
import {
  bondId,
  createUser,
  num,
  one,
  pool,
  resetDb,
  seedObligations,
  supabase,
} from './helpers/db'

const SELIC = 'Tesouro Selic 2027'

async function setPrice(name: string, price: number): Promise<void> {
  await pool.query(
    'UPDATE treasury_bonds SET current_price = $1 WHERE api_reference_name = $2',
    [price, name],
  )
}

beforeEach(resetDb)
afterAll(async () => {
  await pool.end()
})

describe('CdU 1 — IR e cálculo de PL', () => {
  it('aplica a tabela regressiva de IR nos limites de cada faixa', async () => {
    const cases: [number, number][] = [
      [180, 0.225],
      [181, 0.2],
      [360, 0.2],
      [361, 0.175],
      [720, 0.175],
      [721, 0.15],
    ]
    for (const [days, rate] of cases) {
      expect(await num('SELECT pap_ir_rate($1) AS v', [days])).toBeCloseTo(
        rate,
        6,
      )
    }
  })

  it('bootstrap: cota vale 1,00 quando não há histórico', async () => {
    expect(await num('SELECT pap_latest_quota_price() AS v')).toBeCloseTo(1, 6)

    const { error } = await supabase.rpc('recalculate_pl', {})
    expect(error).toBeNull()
    const snap = await one<{
      total_pl_brl: string
      total_quotas: string
      quota_price: string
    }>('SELECT total_pl_brl, total_quotas, quota_price FROM pl_history')
    expect(Number(snap.total_pl_brl)).toBe(0)
    expect(Number(snap.total_quotas)).toBe(0)
    expect(Number(snap.quota_price)).toBeCloseTo(1, 6)
  })

  it('calcula PL líquido aplicando IR sobre o lucro do lote', async () => {
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    // Aporte: 1 unidade a R$10.000 → 10.000 cotas (cota bootstrap 1,00).
    const { error } = await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 1,
      p_amount_brl: 10000,
    })
    expect(error).toBeNull()

    // Preço sobe para 12.000 → lucro 2.000; lote tem 0 dias → IR 22,5% = 450.
    await setPrice(SELIC, 12000)
    expect((await supabase.rpc('recalculate_pl', {})).error).toBeNull()

    const snap = await one<{ total_pl_brl: string; quota_price: string }>(
      'SELECT total_pl_brl, quota_price FROM pl_history',
    )
    expect(Number(snap.total_pl_brl)).toBeCloseTo(11550, 2) // 12000 - 450
    expect(Number(snap.quota_price)).toBeCloseTo(1.155, 6) // 11550 / 10000
  })
})

describe('CdU 2 — Aporte', () => {
  it('gera cotas pela última cotação e grava o lote', async () => {
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    const { data: txnId, error } = await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.15,
      p_amount_brl: 2285.184,
    })
    expect(error).toBeNull()

    const txn = await one<{
      type: string
      status: string
      amount_brl: string
      quotas_amount: string
    }>(
      'SELECT type, status, amount_brl, quotas_amount FROM transactions WHERE id = $1',
      [txnId],
    )
    expect(txn.type).toBe('APORTE')
    expect(txn.status).toBe('APPROVED')
    expect(Number(txn.amount_brl)).toBeCloseTo(2285.18, 2) // 0.15 * 15234.56
    expect(Number(txn.quotas_amount)).toBeCloseTo(2285.18, 2)

    const lot = await one<{ quantity: string; is_active: boolean }>(
      'SELECT quantity, is_active FROM fund_bond_lots WHERE transaction_id = $1',
      [txnId],
    )
    expect(Number(lot.quantity)).toBeCloseTo(0.15, 6)
    expect(lot.is_active).toBe(true)
  })

  it('status derivado (FIFO 90%): aporte cobre os 2 meses mais antigos', async () => {
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await seedObligations(joao, ['2026-04-01', '2026-05-01', '2026-06-01'])

    await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.15,
      p_amount_brl: 2285.184, // cobre o acumulado de mai (1800) mas não de jun (2700)
    })

    const paid = await num(
      "SELECT count(*) AS v FROM v_monthly_obligations WHERE profile_id = $1 AND status = 'PAID'",
      [joao],
    )
    const pending = await num(
      "SELECT count(*) AS v FROM v_monthly_obligations WHERE profile_id = $1 AND status = 'PENDING'",
      [joao],
    )
    expect(paid).toBe(2)
    expect(pending).toBe(1)
    // O mês mais recente é o que sobra pendente (FIFO preenche do mais antigo).
    const stillPending = await one<{ reference_month: string }>(
      "SELECT to_char(reference_month, 'YYYY-MM') AS reference_month FROM v_monthly_obligations WHERE profile_id = $1 AND status = 'PENDING'",
      [joao],
    )
    expect(stillPending.reference_month).toBe('2026-06')
  })

  it('aporte abaixo de 90% do mês não quita nenhuma', async () => {
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await seedObligations(joao, ['2026-04-01'])

    await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.05,
      p_amount_brl: 500, // 50% < 90%
    })

    expect(
      await num(
        "SELECT count(*) AS v FROM v_monthly_obligations WHERE profile_id = $1 AND status = 'PAID'",
        [joao],
      ),
    ).toBe(0)
  })

  it('rejeita aporte em título indisponível para compra', async () => {
    const joao = await createUser('Joao')
    // O seed só tem Selic/IPCA disponíveis; cria um título desabilitado dedicado
    // (idempotente — resetDb não limpa treasury_bonds).
    await pool.query(
      `INSERT INTO treasury_bonds (api_reference_name, display_name, current_price, is_available_for_purchase)
       VALUES ('TEST Indisponível', 'TEST Indisponível', 1000, false)
       ON CONFLICT (api_reference_name) DO NOTHING`,
    )
    const bond = await bondId('TEST Indisponível')
    const { error } = await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 1,
      p_amount_brl: 1000,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toContain('disponível')
  })
})

describe('CdU 3 — Saídas', () => {
  it('DESPESA_PAIS nasce pendente sem liquidar lote nem queimar cota', async () => {
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await setPrice(SELIC, 15234.56)
    await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.15,
      p_amount_brl: 2285.184,
    })
    const quotasBefore = await num(
      "SELECT COALESCE(SUM(quotas_amount),0) AS v FROM transactions WHERE status='APPROVED'",
    )

    const { data: txnId, error } = await supabase.rpc('request_withdrawal', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_type: 'DESPESA_PAIS',
      p_quantity: 0.03,
      p_amount_brl: 500,
    })
    expect(error).toBeNull()

    const txn = await one<{ status: string; quotas_amount: string }>(
      'SELECT status, quotas_amount FROM transactions WHERE id = $1',
      [txnId],
    )
    expect(txn.status).toBe('PENDING_APPROVAL')
    expect(Number(txn.quotas_amount)).toBe(0)
    // Lote intacto e total de cotas inalterado.
    expect(await num('SELECT quantity AS v FROM fund_bond_lots')).toBeCloseTo(
      0.15,
      6,
    )
    expect(
      await num(
        "SELECT COALESCE(SUM(quotas_amount),0) AS v FROM transactions WHERE status='APPROVED'",
      ),
    ).toBeCloseTo(quotasBefore, 6)
  })

  it('RESGATE_PESSOAL: APPROVED, FIFO no lote e queima de cotas do solicitante', async () => {
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await setPrice(SELIC, 15234.56)
    await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.15,
      p_amount_brl: 2285.184, // 2285.18 cotas
    })

    const { data: txnId, error } = await supabase.rpc('request_withdrawal', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_type: 'RESGATE_PESSOAL',
      p_quantity: 200 / 15234.56, // unidades liquidadas (verdade da carteira)
      p_amount_brl: 200, // bruto resgatado
    })
    expect(error).toBeNull()

    const txn = await one<{ status: string; quotas_amount: string }>(
      'SELECT status, quotas_amount FROM transactions WHERE id = $1',
      [txnId],
    )
    expect(txn.status).toBe('APPROVED')
    expect(Number(txn.quotas_amount)).toBeCloseTo(-200, 6) // 200 / cota 1,00

    // FIFO: 200 / 15234.56 = 0.013129 unidades liquidadas.
    expect(await num('SELECT quantity AS v FROM fund_bond_lots')).toBeCloseTo(
      0.15 - 200 / 15234.56,
      6,
    )
  })

  it('RESGATE_PESSOAL rejeita quando o saldo de cotas é insuficiente', async () => {
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await setPrice(SELIC, 15234.56)
    await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.01,
      p_amount_brl: 100, // 100 cotas
    })

    const { error } = await supabase.rpc('request_withdrawal', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_type: 'RESGATE_PESSOAL',
      p_quantity: 0.02,
      p_amount_brl: 200, // exige 200 cotas > saldo 100
    })
    expect(error).not.toBeNull()
    expect(error?.message).toContain('Cotas insuficientes')
  })

  it('FIFO rejeita quando a carteira não comporta a quantidade', async () => {
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await setPrice(SELIC, 15234.56)
    await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.01,
      p_amount_brl: 200, // 200 cotas; bruto cobre as cotas, mas faltam unidades
    })

    const { error } = await supabase.rpc('request_withdrawal', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_type: 'RESGATE_PESSOAL',
      p_quantity: 0.013, // > 0,01 disponível → FIFO falha
      p_amount_brl: 200, // cotas 200 ≤ saldo 200 (passa a checagem de cotas)
    })
    expect(error).not.toBeNull()
    expect(error?.message).toContain('insuficiente')
  })

  it('FIFO consome o lote mais antigo primeiro', async () => {
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await setPrice(SELIC, 10000)

    const { data: txnA } = await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.1,
      p_amount_brl: 1000,
    })
    // Envelhece o APORTE A pela event_date para garantir a ordem FIFO por data.
    // O lote é projeção do ledger (recriado pelo rebuild), então a data de compra
    // vem da transação — patchear fund_bond_lots direto não sobrevive ao replay.
    await pool.query(
      "UPDATE transactions SET event_date = '2020-01-01' WHERE id = $1",
      [txnA],
    )
    await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.1,
      p_amount_brl: 1000,
    })

    // Saca 0,05 unidades (bruto 500): deve sair só do lote A (antigo).
    const { error } = await supabase.rpc('request_withdrawal', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_type: 'RESGATE_PESSOAL',
      p_quantity: 0.05,
      p_amount_brl: 500,
    })
    expect(error).toBeNull()

    const lotA = await num(
      'SELECT quantity AS v FROM fund_bond_lots WHERE transaction_id = $1',
      [txnA],
    )
    const lotB = await num(
      'SELECT quantity AS v FROM fund_bond_lots WHERE transaction_id <> $1',
      [txnA],
    )
    expect(lotA).toBeCloseTo(0.05, 6)
    expect(lotB).toBeCloseTo(0.1, 6)
  })
})

describe('CdU 4 — Aprovação de despesa', () => {
  async function setupPendingExpense() {
    const joao = await createUser('Joao')
    const maria = await createUser('Maria', 'ADMIN')
    const bond = await bondId(SELIC)
    await setPrice(SELIC, 15234.56)
    await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.15,
      p_amount_brl: 2285.184,
    })
    const { data: despesa } = await supabase.rpc('request_withdrawal', {
      p_profile_id: maria,
      p_bond_id: bond,
      p_type: 'DESPESA_PAIS',
      p_quantity: 0.03,
      p_amount_brl: 500,
    })
    return { joao, maria, bond, despesa: despesa as string }
  }

  it('Regra de Ouro: aprovação liquida via FIFO sem queimar cotas', async () => {
    const { joao, despesa } = await setupPendingExpense()
    const quotasBefore = await num(
      "SELECT COALESCE(SUM(quotas_amount),0) AS v FROM transactions WHERE status='APPROVED'",
    )

    const { error } = await supabase.rpc('approve_expense', {
      p_transaction_id: despesa,
      p_approver_id: joao,
    })
    expect(error).toBeNull()

    const txn = await one<{ status: string; approved_by: string | null }>(
      'SELECT status, approved_by FROM transactions WHERE id = $1',
      [despesa],
    )
    expect(txn.status).toBe('APPROVED')
    expect(txn.approved_by).toBe(joao)
    // Lote reduzido pela quantidade registrada (0,03), cotas totais inalteradas.
    expect(await num('SELECT quantity AS v FROM fund_bond_lots')).toBeCloseTo(
      0.15 - 0.03,
      6,
    )
    expect(
      await num(
        "SELECT COALESCE(SUM(quotas_amount),0) AS v FROM transactions WHERE status IN ('APPROVED')",
      ),
    ).toBeCloseTo(quotasBefore, 6)
  })

  it('bloqueia auto-aprovação pelo próprio solicitante', async () => {
    const { maria, despesa } = await setupPendingExpense()
    const { error } = await supabase.rpc('approve_expense', {
      p_transaction_id: despesa,
      p_approver_id: maria, // mesma pessoa que solicitou
    })
    expect(error).not.toBeNull()
    expect(error?.message).toContain('outro cotista')
  })

  it('não aprova transação que não seja DESPESA_PAIS pendente', async () => {
    const joao = await createUser('Joao')
    const maria = await createUser('Maria')
    const bond = await bondId(SELIC)
    const { data: aporte } = await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.1,
      p_amount_brl: 1000,
    })
    const { error } = await supabase.rpc('approve_expense', {
      p_transaction_id: aporte as string,
      p_approver_id: maria,
    })
    expect(error).not.toBeNull()
  })

  it('reprovar classifica como RESGATE_PESSOAL: liquida e queima cotas do solicitante', async () => {
    // O solicitante precisa ter cotas (a queima recai sobre ele): João pede e Maria reprova.
    const joao = await createUser('Joao')
    const maria = await createUser('Maria')
    const bond = await bondId(SELIC)
    await setPrice(SELIC, 15234.56)
    await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.15,
      p_amount_brl: 2285.184, // ~2285 cotas (cota 1,00)
    })
    const { data: despesa } = await supabase.rpc('request_withdrawal', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_type: 'DESPESA_PAIS',
      p_quantity: 0.03,
      p_amount_brl: 400,
    })

    const { error } = await supabase.rpc('reject_expense', {
      p_transaction_id: despesa as string,
      p_approver_id: maria,
    })
    expect(error).toBeNull()

    const txn = await one<{
      type: string
      status: string
      quotas_amount: string
    }>('SELECT type, status, quotas_amount FROM transactions WHERE id = $1', [
      despesa,
    ])
    expect(txn.type).toBe('RESGATE_PESSOAL')
    expect(txn.status).toBe('APPROVED')
    expect(Number(txn.quotas_amount)).toBeCloseTo(-400, 6) // 400 / cota 1,00
    // Lote reduzido pela quantidade (0,03).
    expect(await num('SELECT quantity AS v FROM fund_bond_lots')).toBeCloseTo(
      0.15 - 0.03,
      6,
    )
  })
})
