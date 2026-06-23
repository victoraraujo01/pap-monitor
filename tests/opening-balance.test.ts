import { beforeEach, afterAll, describe, expect, it } from 'vitest'
import {
  bondId,
  createUser,
  num,
  one,
  pool,
  resetDb,
  supabase,
} from './helpers/db'

const SELIC = 'Tesouro Selic 2027'

// Zera o preço corrente do título (resetDb preserva treasury_bonds) para exercitar
// o seed de current_price feito pelo saldo de abertura.
async function clearPrice(name: string): Promise<void> {
  await pool.query(
    'UPDATE treasury_bonds SET current_price = NULL WHERE api_reference_name = $1',
    [name],
  )
}

beforeEach(resetDb)
afterAll(async () => {
  await pool.end()
})

describe('Fase 1 — Saldo de abertura', () => {
  it('exige ADMIN para configurar o saldo de abertura', async () => {
    const joao = await createUser('Joao') // COTISTA
    const bond = await bondId(SELIC)
    const { error } = await supabase.rpc('set_opening_balance', {
      p_admin_id: joao,
      p_date: '2026-01-01',
      p_lots: [{ bond_id: bond, quantity: 1, price: 10000 }],
      p_quotas: [{ profile_id: joao, quotas: 1000, amount: 1000 }],
    })
    expect(error).not.toBeNull()
    expect(error?.message).toContain('administradores')
  })

  it('lança carteira (lotes) + cotas por irmão e calcula a participação', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const maria = await createUser('Maria')
    const bond = await bondId(SELIC)
    await clearPrice(SELIC)

    const { error } = await supabase.rpc('set_opening_balance', {
      p_admin_id: admin,
      p_date: '2026-01-01',
      p_lots: [{ bond_id: bond, quantity: 1, price: 10000 }],
      p_quotas: [
        { profile_id: joao, quotas: 6000, amount: 6000 },
        { profile_id: maria, quotas: 4000, amount: 4000 },
      ],
    })
    expect(error).toBeNull()

    // Lote de abertura: 1 unidade, real e ativo, marcado is_opening.
    const lot = await one<{
      quantity: string
      is_active: boolean
      is_opening: boolean
      transaction_id: string | null
    }>(
      'SELECT quantity, is_active, is_opening, transaction_id FROM fund_bond_lots WHERE is_opening = TRUE',
    )
    expect(Number(lot.quantity)).toBeCloseTo(1, 6)
    expect(lot.is_active).toBe(true)
    expect(lot.transaction_id).toBeNull()

    // current_price semeado com o preço de D0 (estava nulo).
    expect(
      await num('SELECT current_price AS v FROM treasury_bonds WHERE id = $1', [
        bond,
      ]),
    ).toBeCloseTo(10000, 2)

    // Cotas totais = 10.000; participação do João = 60%.
    expect(
      await num(
        "SELECT COALESCE(SUM(quotas_amount),0) AS v FROM transactions WHERE status='APPROVED'",
      ),
    ).toBeCloseTo(10000, 6)
    const joaoQuotas = await num(
      'SELECT COALESCE(SUM(quotas_amount),0) AS v FROM transactions WHERE profile_id = $1',
      [joao],
    )
    expect(joaoQuotas / 10000).toBeCloseTo(0.6, 6)

    // Snapshot diário gerado: PL = 10.000 (lucro zero, sem IR), cota = 1,00.
    const snap = await one<{ total_pl_brl: string; quota_price: string }>(
      'SELECT total_pl_brl, quota_price FROM pl_history',
    )
    expect(Number(snap.total_pl_brl)).toBeCloseTo(10000, 2)
    expect(Number(snap.quota_price)).toBeCloseTo(1, 6)
  })

  it('é idempotente: reconfigurar substitui o genesis anterior', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)

    const call = (quotas: number) =>
      supabase.rpc('set_opening_balance', {
        p_admin_id: admin,
        p_date: '2026-01-01',
        p_lots: [{ bond_id: bond, quantity: 1, price: 10000 }],
        p_quotas: [{ profile_id: joao, quotas, amount: quotas }],
      })

    expect((await call(5000)).error).toBeNull()
    expect((await call(7000)).error).toBeNull()

    // Sem duplicar: 1 lote de abertura, 1 transação de abertura, valor atualizado.
    expect(
      await num('SELECT count(*) AS v FROM fund_bond_lots WHERE is_opening'),
    ).toBe(1)
    expect(
      await num('SELECT count(*) AS v FROM transactions WHERE is_opening'),
    ).toBe(1)
    expect(
      await num('SELECT quotas_amount AS v FROM transactions WHERE is_opening'),
    ).toBeCloseTo(7000, 6)
  })
})

describe('Fase 1 — Eventos datados', () => {
  it('register_aporte grava event_date e quantity, e data o lote', async () => {
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    const { data: txnId, error } = await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.2,
      p_amount_brl: 2000,
      p_event_date: '2025-03-15',
    })
    expect(error).toBeNull()

    const txn = await one<{ event_date: string; quantity: string }>(
      "SELECT to_char(event_date,'YYYY-MM-DD') AS event_date, quantity FROM transactions WHERE id = $1",
      [txnId],
    )
    expect(txn.event_date).toBe('2025-03-15')
    expect(Number(txn.quantity)).toBeCloseTo(0.2, 6)

    const lotDate = await one<{ purchase_date: string }>(
      "SELECT to_char(purchase_date,'YYYY-MM-DD') AS purchase_date FROM fund_bond_lots WHERE transaction_id = $1",
      [txnId],
    )
    expect(lotDate.purchase_date).toBe('2025-03-15')
  })

  it('RESGATE_PESSOAL grava a quantidade liquidada e a data', async () => {
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await pool.query(
      'UPDATE treasury_bonds SET current_price = 10000 WHERE id = $1',
      [bond],
    )
    // Aporte de financiamento datado ANTES do resgate: o auto-rebuild replaya por
    // event_date, então o lote precisa existir na data da saída.
    await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.2,
      p_amount_brl: 2000,
      p_event_date: '2026-01-01',
    })

    const { data: txnId, error } = await supabase.rpc('request_withdrawal', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_type: 'RESGATE_PESSOAL',
      p_quantity: 0.05,
      p_amount_brl: 500,
      p_event_date: '2026-02-10',
    })
    expect(error).toBeNull()

    const txn = await one<{ event_date: string; quantity: string }>(
      "SELECT to_char(event_date,'YYYY-MM-DD') AS event_date, quantity FROM transactions WHERE id = $1",
      [txnId],
    )
    expect(txn.event_date).toBe('2026-02-10')
    expect(Number(txn.quantity)).toBeCloseTo(0.05, 6) // unidades resgatadas (verdade)
  })

  it('aprovar despesa pendente liquida pela quantidade registrada', async () => {
    const joao = await createUser('Joao')
    const maria = await createUser('Maria')
    const bond = await bondId(SELIC)
    await pool.query(
      'UPDATE treasury_bonds SET current_price = 10000 WHERE id = $1',
      [bond],
    )
    await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.2,
      p_amount_brl: 2000,
    })
    const { data: despesa } = await supabase.rpc('request_withdrawal', {
      p_profile_id: maria,
      p_bond_id: bond,
      p_type: 'DESPESA_PAIS',
      p_quantity: 0.05,
      p_amount_brl: 500,
    })
    await supabase.rpc('approve_expense', {
      p_transaction_id: despesa as string,
      p_approver_id: joao,
    })

    // Quantidade registrada no pedido (0,05), não derivada de preço.
    expect(
      await num('SELECT quantity AS v FROM transactions WHERE id = $1', [
        despesa,
      ]),
    ).toBeCloseTo(0.05, 6)
    // Lote do João reduzido em 0,05.
    expect(
      await num('SELECT quantity AS v FROM fund_bond_lots WHERE is_active'),
    ).toBeCloseTo(0.15, 6)
  })
})

describe('Fase 2 — saída por quantidade / preço da data', () => {
  it('RESGATE grava quantidade + valor bruto como verdade (sem derivar por preço)', async () => {
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await pool.query(
      'UPDATE treasury_bonds SET current_price = 10000 WHERE id = $1',
      [bond],
    )
    await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 1,
      p_amount_brl: 10000,
    })

    // Informa unidades E bruto explicitamente (preço de execução implícito 9000,
    // diferente do current_price 10000 — e o sistema NÃO recalcula nada).
    const { data: txnId, error } = await supabase.rpc('request_withdrawal', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_type: 'RESGATE_PESSOAL',
      p_quantity: 0.05,
      p_amount_brl: 450,
    })
    expect(error).toBeNull()

    const txn = await one<{ quantity: string; amount_brl: string }>(
      'SELECT quantity, amount_brl FROM transactions WHERE id = $1',
      [txnId],
    )
    expect(Number(txn.quantity)).toBeCloseTo(0.05, 6) // unidades = verdade da carteira
    expect(Number(txn.amount_brl)).toBeCloseTo(450, 2) // bruto = verdade da queima
    expect(
      await num('SELECT quantity AS v FROM fund_bond_lots WHERE is_active'),
    ).toBeCloseTo(0.95, 6) // FIFO usa a quantidade, não o valor
  })

  it('DESPESA direta (admin) nasce aprovada e preserva qtd/valor/data informados', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await pool.query(
      'UPDATE treasury_bonds SET current_price = 10000 WHERE id = $1',
      [bond],
    )
    // Aporte de financiamento datado ANTES da despesa (auto-rebuild replaya por data).
    await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 1,
      p_amount_brl: 10000,
      p_event_date: '2025-01-01',
    })

    const { data: despesa, error } = await supabase.rpc('request_withdrawal', {
      p_profile_id: admin,
      p_bond_id: bond,
      p_type: 'DESPESA_PAIS',
      p_quantity: 0.1,
      p_amount_brl: 800,
      p_event_date: '2025-06-01',
      p_direct: true,
    })
    expect(error).toBeNull()

    const txn = await one<{
      type: string
      status: string
      quantity: string
      amount_brl: string
      event_date: string
    }>(
      "SELECT type, status, quantity, amount_brl, to_char(event_date,'YYYY-MM-DD') AS event_date FROM transactions WHERE id = $1",
      [despesa],
    )
    expect(txn.type).toBe('DESPESA_PAIS')
    expect(txn.status).toBe('APPROVED') // nasce aprovada (admin)
    expect(Number(txn.quantity)).toBeCloseTo(0.1, 6) // quantidade informada (não derivada)
    expect(Number(txn.amount_brl)).toBeCloseTo(800, 2)
    expect(txn.event_date).toBe('2025-06-01')
    // Nenhuma cota queimada (Regra de Ouro) e lote reduzido em 0,1.
    expect(Number(txn.amount_brl) >= 0).toBe(true)
    expect(
      await num('SELECT quantity AS v FROM fund_bond_lots WHERE is_active'),
    ).toBeCloseTo(0.9, 6)
  })

  it('DESPESA direta exige ADMIN', async () => {
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await pool.query(
      'UPDATE treasury_bonds SET current_price = 10000 WHERE id = $1',
      [bond],
    )
    await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 1,
      p_amount_brl: 10000,
    })
    const { error } = await supabase.rpc('request_withdrawal', {
      p_profile_id: joao, // cotista comum
      p_bond_id: bond,
      p_type: 'DESPESA_PAIS',
      p_quantity: 0.1,
      p_amount_brl: 800,
      p_direct: true,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toContain('administradores')
  })
})

describe('delete_transaction (gestão de eventos)', () => {
  it('admin remove um aporte e seu lote', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    const { data: txnId } = await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.1,
      p_amount_brl: 1000,
    })

    const { error } = await supabase.rpc('delete_transaction', {
      p_caller_id: admin,
      p_transaction_id: txnId as string,
    })
    expect(error).toBeNull()
    expect(
      await num('SELECT count(*) AS v FROM transactions WHERE id = $1', [
        txnId,
      ]),
    ).toBe(0)
    expect(
      await num(
        'SELECT count(*) AS v FROM fund_bond_lots WHERE transaction_id = $1',
        [txnId],
      ),
    ).toBe(0)
  })

  it('cotista remove o PRÓPRIO lançamento, mas não o de outro', async () => {
    const joao = await createUser('Joao')
    const maria = await createUser('Maria')
    const bond = await bondId(SELIC)
    const { data: aporte } = await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.2,
      p_amount_brl: 2000,
    })

    // Outro cotista (não dono, não admin) é barrado.
    const negado = await supabase.rpc('delete_transaction', {
      p_caller_id: maria,
      p_transaction_id: aporte as string,
    })
    expect(negado.error?.message).toContain('autor')

    // O dono remove o próprio aporte.
    const ok = await supabase.rpc('delete_transaction', {
      p_caller_id: joao,
      p_transaction_id: aporte as string,
    })
    expect(ok.error).toBeNull()
    expect(
      await num('SELECT count(*) AS v FROM transactions WHERE id = $1', [
        aporte,
      ]),
    ).toBe(0)
  })

  it('remove um resgate e o replay restaura o lote liquidado', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await pool.query(
      'UPDATE treasury_bonds SET current_price = 10000 WHERE id = $1',
      [bond],
    )
    const { data: aporte } = await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.2,
      p_amount_brl: 2000,
    })
    const { data: resgate } = await supabase.rpc('request_withdrawal', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_type: 'RESGATE_PESSOAL',
      p_quantity: 0.05,
      p_amount_brl: 500,
    })

    // Após o resgate, o lote do aporte ficou com 0.15 (FIFO liquidou 0.05).
    const { error } = await supabase.rpc('delete_transaction', {
      p_caller_id: admin,
      p_transaction_id: resgate as string,
    })
    expect(error).toBeNull()
    expect(
      await num('SELECT count(*) AS v FROM transactions WHERE id = $1', [
        resgate,
      ]),
    ).toBe(0)
    // O replay resetou o lote para a quantidade emitida (0.2).
    expect(
      await num(
        'SELECT quantity AS v FROM fund_bond_lots WHERE transaction_id = $1',
        [aporte],
      ),
    ).toBeCloseTo(0.2, 6)
  })
})

describe('update_transaction (edição de lançamentos)', () => {
  it('edita um aporte (valor/quantidade/título) e reescreve o lote', async () => {
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    const { data: aporte } = await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.1,
      p_amount_brl: 1000,
    })

    const { error } = await supabase.rpc('update_transaction', {
      p_caller_id: joao,
      p_transaction_id: aporte as string,
      p_bond_id: bond,
      p_quantity: 0.25,
      p_amount_brl: 2500,
      p_event_date: '2026-02-15',
    })
    expect(error).toBeNull()

    const txn = await one<{
      amount_brl: string
      quantity: string
      event_date: string
    }>(
      'SELECT amount_brl, quantity, event_date FROM transactions WHERE id = $1',
      [aporte],
    )
    expect(Number(txn.amount_brl)).toBeCloseTo(2500, 2)
    expect(Number(txn.quantity)).toBeCloseTo(0.25, 6)

    const lot = await one<{
      quantity: string
      original_quantity: string
      purchase_price: string
    }>(
      'SELECT quantity, original_quantity, purchase_price FROM fund_bond_lots WHERE transaction_id = $1',
      [aporte],
    )
    expect(Number(lot.quantity)).toBeCloseTo(0.25, 6)
    expect(Number(lot.original_quantity)).toBeCloseTo(0.25, 6)
    expect(Number(lot.purchase_price)).toBeCloseTo(10000, 2) // 2500 / 0.25
  })

  it('recusa edição por quem não é dono nem admin', async () => {
    const joao = await createUser('Joao')
    const maria = await createUser('Maria')
    const bond = await bondId(SELIC)
    const { data: aporte } = await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.1,
      p_amount_brl: 1000,
    })

    const { error } = await supabase.rpc('update_transaction', {
      p_caller_id: maria,
      p_transaction_id: aporte as string,
      p_bond_id: bond,
      p_quantity: 0.2,
      p_amount_brl: 2000,
      p_event_date: '2026-02-15',
    })
    expect(error?.message).toContain('autor')
  })
})
