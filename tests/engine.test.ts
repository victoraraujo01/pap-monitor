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
      p_purchase_price: 10000,
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
      p_purchase_price: 15234.56,
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

  it('baixa greedy: quita as 2 obrigações mais antigas que cabem no aporte', async () => {
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await seedObligations(joao, ['2026-04-01', '2026-05-01', '2026-06-01'])

    await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.15,
      p_purchase_price: 15234.56, // ~2285 → cobre 2 faturas de 1000
    })

    const paid = await num(
      "SELECT count(*) AS v FROM monthly_obligations WHERE profile_id = $1 AND status = 'PAID'",
      [joao],
    )
    const pending = await num(
      "SELECT count(*) AS v FROM monthly_obligations WHERE profile_id = $1 AND status = 'PENDING'",
      [joao],
    )
    expect(paid).toBe(2)
    expect(pending).toBe(1)
    // A fatura mais recente deve ser a que sobrou pendente.
    const stillPending = await one<{ reference_month: string }>(
      "SELECT to_char(reference_month, 'YYYY-MM') AS reference_month FROM monthly_obligations WHERE status = 'PENDING'",
    )
    expect(stillPending.reference_month).toBe('2026-06')
  })

  it('aporte que não cobre uma fatura inteira não quita nenhuma', async () => {
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await seedObligations(joao, ['2026-04-01'])

    await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.05,
      p_purchase_price: 10000, // 500 < 1000
    })

    expect(
      await num(
        "SELECT count(*) AS v FROM monthly_obligations WHERE status = 'PAID'",
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
      p_purchase_price: 1000,
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
      p_purchase_price: 15234.56,
    })
    const quotasBefore = await num(
      "SELECT COALESCE(SUM(quotas_amount),0) AS v FROM transactions WHERE status='APPROVED'",
    )

    const { data: txnId, error } = await supabase.rpc('request_withdrawal', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_amount_brl: 500,
      p_type: 'DESPESA_PAIS',
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
      p_purchase_price: 15234.56, // 2285.18 cotas
    })

    const { data: txnId, error } = await supabase.rpc('request_withdrawal', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_amount_brl: 200,
      p_type: 'RESGATE_PESSOAL',
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
      p_purchase_price: 10000, // 100 cotas
    })

    const { error } = await supabase.rpc('request_withdrawal', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_amount_brl: 200, // exige 200 cotas > saldo 100
      p_type: 'RESGATE_PESSOAL',
    })
    expect(error).not.toBeNull()
    expect(error?.message).toContain('Cotas insuficientes')
  })

  it('FIFO rejeita quando a carteira não comporta a quantidade', async () => {
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await setPrice(SELIC, 15234.56)
    // Compra cara (preço > preço atual) → exige mais unidades do que existem.
    await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.01,
      p_purchase_price: 20000, // 200 cotas; saca 200 → cotas ok, mas unidades não
    })

    const { error } = await supabase.rpc('request_withdrawal', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_amount_brl: 200,
      p_type: 'RESGATE_PESSOAL',
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
      p_purchase_price: 10000,
    })
    // Envelhece o lote A para garantir a ordem FIFO por data.
    await pool.query(
      "UPDATE fund_bond_lots SET purchase_date = '2020-01-01' WHERE transaction_id = $1",
      [txnA],
    )
    await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.1,
      p_purchase_price: 10000,
    })

    // Saca 0,05 unidades (500 / 10000): deve sair só do lote A (antigo).
    const { error } = await supabase.rpc('request_withdrawal', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_amount_brl: 500,
      p_type: 'RESGATE_PESSOAL',
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
      p_purchase_price: 15234.56,
    })
    const { data: despesa } = await supabase.rpc('request_withdrawal', {
      p_profile_id: maria,
      p_bond_id: bond,
      p_amount_brl: 500,
      p_type: 'DESPESA_PAIS',
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
    // Lote reduzido (500 / 15234.56), cotas totais inalteradas.
    expect(await num('SELECT quantity AS v FROM fund_bond_lots')).toBeCloseTo(
      0.15 - 500 / 15234.56,
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
      p_purchase_price: 10000,
    })
    const { error } = await supabase.rpc('approve_expense', {
      p_transaction_id: aporte as string,
      p_approver_id: maria,
    })
    expect(error).not.toBeNull()
  })

  it('reject_expense marca REJECTED sem liquidar o lote', async () => {
    const { joao, despesa } = await setupPendingExpense()
    const { error } = await supabase.rpc('reject_expense', {
      p_transaction_id: despesa,
      p_approver_id: joao,
    })
    expect(error).toBeNull()

    const status = await one<{ status: string }>(
      'SELECT status FROM transactions WHERE id = $1',
      [despesa],
    )
    expect(status.status).toBe('REJECTED')
    // Lote do aporte permanece intacto.
    expect(await num('SELECT quantity AS v FROM fund_bond_lots')).toBeCloseTo(
      0.15,
      6,
    )
  })
})
