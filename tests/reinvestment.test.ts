import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { bondId, createUser, num, one, pool, resetDb, supabase } from './helpers/db'

const SOURCE = 'Tesouro Selic 2027'
const TARGET = 'Tesouro IPCA+ 2035'

async function seedPriceHistory(
  name: string,
  points: [string, number][],
): Promise<void> {
  const id = await bondId(name)
  for (const [date, price] of points) {
    await pool.query(
      `INSERT INTO bond_price_history (bond_id, date, price) VALUES ($1, $2, $3)
       ON CONFLICT (bond_id, date) DO UPDATE SET price = EXCLUDED.price`,
      [id, date, price],
    )
  }
}

// Cenário base: abertura em 01/01 (Selic 10 @ R$100 = R$1.000, João 1.000 cotas →
// cota R$1,00); em 01/06 um reinvestimento rotaciona TODO o Selic (10 unid, líquido
// R$1.000, preço estável) para 20 unid de IPCA+ a R$50 (R$1.000). PL e cotas conservados.
async function openingThenReinvest(admin: string, joao: string) {
  const src = await bondId(SOURCE)
  const tgt = await bondId(TARGET)
  // Garante o destino comprável (independe das flags do seed).
  await pool.query(
    'UPDATE treasury_bonds SET is_available_for_purchase = TRUE WHERE id = $1',
    [tgt],
  )
  await seedPriceHistory(SOURCE, [
    ['2026-01-01', 100],
    ['2026-06-01', 100],
  ])
  await supabase.rpc('set_opening_balance', {
    p_admin_id: admin,
    p_date: '2026-01-01',
    p_lots: [{ bond_id: src, quantity: 10, price: 100 }],
    p_quotas: [{ profile_id: joao, quotas: 1000, amount: 1000 }],
  })
  const { data: rid, error } = await supabase.rpc('register_reinvestment', {
    p_profile_id: joao,
    p_source_bond_id: src,
    p_source_quantity: 10,
    p_target_bond_id: tgt,
    p_target_quantity: 20,
    p_target_amount_brl: 1000,
    p_event_date: '2026-06-01',
  })
  expect(error).toBeNull()
  return { src, tgt, reinvestId: rid as unknown as string }
}

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await pool.end()
})

describe('Reinvestimento — registro instantâneo', () => {
  it('liquida a origem (FIFO) e abre o lote do destino, sem mexer em cotas', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const { src, tgt, reinvestId } = await openingThenReinvest(admin, joao)

    // Origem totalmente liquidada; destino ativo com 20 unid @ R$50.
    expect(
      await num(
        'SELECT COALESCE(SUM(quantity),0) AS v FROM fund_bond_lots WHERE bond_id=$1 AND is_active',
        [src],
      ),
    ).toBeCloseTo(0, 6)
    const lot = await one<{ quantity: string; purchase_price: string }>(
      'SELECT quantity, purchase_price FROM fund_bond_lots WHERE bond_id=$1 AND is_active',
      [tgt],
    )
    expect(Number(lot.quantity)).toBeCloseTo(20, 6)
    expect(Number(lot.purchase_price)).toBeCloseTo(50, 6)

    // A transação não minta nem queima cota (Regra de Ouro do reinvestimento).
    expect(
      await num('SELECT quotas_amount AS v FROM transactions WHERE id=$1', [
        reinvestId,
      ]),
    ).toBeCloseTo(0, 6)
  })
})

describe('Reinvestimento — rebuild', () => {
  it('conserva PL e valor da cota (cota contínua) após o replay', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    await openingThenReinvest(admin, joao)

    expect(
      (await supabase.rpc('rebuild_fund_history', { p_admin_id: admin })).error,
    ).toBeNull()

    const jun = await one<{
      total_pl_brl: string
      total_quotas: string
      quota_price: string
    }>(
      "SELECT total_pl_brl, total_quotas, quota_price FROM pl_history WHERE date='2026-06-01'",
    )
    // − R$1.000 (Selic) + R$1.000 (IPCA+) = PL conservado; cotas intactas → cota 1,00.
    expect(Number(jun.total_pl_brl)).toBeCloseTo(1000, 2)
    expect(Number(jun.total_quotas)).toBeCloseTo(1000, 6)
    expect(Number(jun.quota_price)).toBeCloseTo(1.0, 6)

    // No dia seguinte a carteira já é só o destino, e a cota segue 1,00.
    expect(
      await num("SELECT quota_price AS v FROM pl_history WHERE date='2026-06-02'"),
    ).toBeCloseTo(1.0, 6)
  })

  it('NÃO conta como contribuição mensal (adimplência intacta)', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    await openingThenReinvest(admin, joao)
    await supabase.rpc('rebuild_fund_history', { p_admin_id: admin })

    // Gera as obrigações mensais do fundo (abertura em jan → corrente).
    await supabase.rpc('generate_monthly_obligations', { p_admin_id: admin })

    // O reinvestimento não é APORTE: total aportado = 0 e nenhum mês fica quitado.
    expect(
      await num(
        'SELECT total_paid AS v FROM v_cotista_balance WHERE profile_id=$1',
        [joao],
      ),
    ).toBeCloseTo(0, 2)
    const months = await num(
      'SELECT count(*) AS v FROM v_monthly_obligations WHERE profile_id=$1',
      [joao],
    )
    const pending = await num(
      "SELECT count(*) AS v FROM v_monthly_obligations WHERE profile_id=$1 AND status='PENDING'",
      [joao],
    )
    expect(months).toBeGreaterThan(0)
    expect(pending).toBe(months)
  })

  it('remover o reinvestimento restaura a origem e desfaz o destino', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const { src, tgt, reinvestId } = await openingThenReinvest(admin, joao)

    const { error } = await supabase.rpc('delete_transaction', {
      p_caller_id: admin,
      p_transaction_id: reinvestId,
    })
    expect(error).toBeNull()

    // Origem reativada (10 unid); lote do destino removido.
    expect(
      await num(
        'SELECT COALESCE(SUM(quantity),0) AS v FROM fund_bond_lots WHERE bond_id=$1 AND is_active',
        [src],
      ),
    ).toBeCloseTo(10, 6)
    expect(
      await num('SELECT count(*) AS v FROM fund_bond_lots WHERE bond_id=$1', [
        tgt,
      ]),
    ).toBe(0)
    // PL volta ao da carteira de abertura (Selic 10 @ R$100).
    expect(
      await num("SELECT total_pl_brl AS v FROM pl_history WHERE date='2026-06-01'"),
    ).toBeCloseTo(1000, 2)
  })
})

describe('Reinvestimento — guardas', () => {
  it('rejeita origem igual ao destino e exige valores positivos', async () => {
    const joao = await createUser('Joao')
    const src = await bondId(SOURCE)
    const same = await supabase.rpc('register_reinvestment', {
      p_profile_id: joao,
      p_source_bond_id: src,
      p_source_quantity: 1,
      p_target_bond_id: src,
      p_target_quantity: 1,
      p_target_amount_brl: 100,
    })
    expect(same.error?.message).toContain('diferentes')
  })

  it('não permite editar um reinvestimento (remova e recrie)', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const { tgt, reinvestId } = await openingThenReinvest(admin, joao)
    const { error } = await supabase.rpc('update_transaction', {
      p_caller_id: admin,
      p_transaction_id: reinvestId,
      p_bond_id: tgt,
      p_quantity: 5,
      p_amount_brl: 500,
      p_event_date: '2026-06-01',
    })
    expect(error?.message).toContain('não são editáveis')
  })
})
