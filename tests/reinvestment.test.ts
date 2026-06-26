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
    p_contributions: [
      { profile_id: joao, bond_id: src, quantity: 10, amount: 1000 },
    ],
  })
  const { data: rid, error } = await supabase.rpc('register_reinvestment', {
    p_profile_id: joao,
    p_source_bond_id: src,
    p_source_quantity: 10,
    p_targets: [{ bond_id: tgt, quantity: 20, amount_brl: 1000 }],
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
      p_targets: [{ bond_id: src, quantity: 1, amount_brl: 100 }],
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

const TARGET2 = 'Tesouro Selic 2029'

describe('Reinvestimento — múltiplos destinos', () => {
  it('liquida a origem uma vez e abre um lote por destino (PL/cota contínuos)', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const src = await bondId(SOURCE)
    const tgtA = await bondId(TARGET)
    const tgtB = await bondId(TARGET2)
    await pool.query(
      'UPDATE treasury_bonds SET is_available_for_purchase = TRUE WHERE id = ANY($1)',
      [[tgtA, tgtB]],
    )
    await seedPriceHistory(SOURCE, [
      ['2026-01-01', 100],
      ['2026-06-01', 100],
    ])
    // Abertura: Selic 20 @ R$100 = R$2.000, João 2.000 cotas → cota R$1,00.
    await supabase.rpc('set_opening_balance', {
      p_admin_id: admin,
      p_date: '2026-01-01',
      p_contributions: [
        { profile_id: joao, bond_id: src, quantity: 20, amount: 2000 },
      ],
    })
    // Rotaciona TODO o Selic (líquido R$2.000, sem ganho) em DOIS destinos.
    const { data: rid, error } = await supabase.rpc('register_reinvestment', {
      p_profile_id: joao,
      p_source_bond_id: src,
      p_source_quantity: 20,
      p_targets: [
        { bond_id: tgtA, quantity: 10, amount_brl: 1200 },
        { bond_id: tgtB, quantity: 8, amount_brl: 800 },
      ],
      p_event_date: '2026-06-01',
    })
    expect(error).toBeNull()

    // Transação única: amount_brl = soma dos destinos; target_bond_id NULL (vários).
    const txn = await one<{ amount_brl: string; target_bond_id: string | null }>(
      'SELECT amount_brl, target_bond_id FROM transactions WHERE id=$1',
      [rid as unknown as string],
    )
    expect(Number(txn.amount_brl)).toBeCloseTo(2000, 2)
    expect(txn.target_bond_id).toBeNull()
    // Dois lotes de destino apontando para a transação.
    expect(
      await num('SELECT count(*) AS v FROM fund_bond_lots WHERE transaction_id=$1', [
        rid as unknown as string,
      ]),
    ).toBe(2)
    // Origem totalmente liquidada.
    expect(
      await num(
        'SELECT COALESCE(SUM(quantity),0) AS v FROM fund_bond_lots WHERE bond_id=$1 AND is_active',
        [src],
      ),
    ).toBeCloseTo(0, 6)

    await supabase.rpc('rebuild_fund_history', { p_admin_id: admin })
    const jun = await one<{ total_pl_brl: string; quota_price: string }>(
      "SELECT total_pl_brl, quota_price FROM pl_history WHERE date='2026-06-01'",
    )
    // − R$2.000 (Selic) + R$2.000 (dois destinos) = PL conservado; cota intacta.
    expect(Number(jun.total_pl_brl)).toBeCloseTo(2000, 2)
    expect(Number(jun.quota_price)).toBeCloseTo(1.0, 6)
  })

  it('exige ao menos um destino e valores positivos', async () => {
    const joao = await createUser('Joao')
    const src = await bondId(SOURCE)
    const tgt = await bondId(TARGET)
    await pool.query(
      'UPDATE treasury_bonds SET is_available_for_purchase = TRUE WHERE id = $1',
      [tgt],
    )
    const empty = await supabase.rpc('register_reinvestment', {
      p_profile_id: joao,
      p_source_bond_id: src,
      p_source_quantity: 1,
      p_targets: [],
    })
    expect(empty.error?.message).toContain('ao menos um título')

    const zero = await supabase.rpc('register_reinvestment', {
      p_profile_id: joao,
      p_source_bond_id: src,
      p_source_quantity: 1,
      p_targets: [{ bond_id: tgt, quantity: 0, amount_brl: 100 }],
    })
    expect(zero.error?.message).toContain('positivos')
  })
})

describe('reinvestment_source_proceeds — bruto/IR/líquido', () => {
  it('aplica a faixa de IR sobre o ganho FIFO da origem', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const src = await bondId(SOURCE)
    // Lote antigo (compra a R$100 em 2024 → >720 dias → IR 15%).
    await seedPriceHistory(SOURCE, [
      ['2024-01-01', 100],
      ['2026-06-01', 150],
    ])
    await supabase.rpc('set_opening_balance', {
      p_admin_id: admin,
      p_date: '2024-01-01',
      p_contributions: [
        { profile_id: joao, bond_id: src, quantity: 10, amount: 1000 },
      ],
    })

    const { data, error } = await supabase.rpc('reinvestment_source_proceeds', {
      p_bond_id: src,
      p_quantity: 10,
      p_date: '2026-06-01',
    })
    expect(error).toBeNull()
    const p = data as unknown as {
      gross: number
      ir: number
      net: number
      available: number
      priced: boolean
    }
    // Bruto = 10 × 150 = 1.500; ganho = 10 × 50 = 500; IR = 500 × 15% = 75.
    expect(Number(p.gross)).toBeCloseTo(1500, 2)
    expect(Number(p.ir)).toBeCloseTo(75, 2)
    expect(Number(p.net)).toBeCloseTo(1425, 2)
    expect(Number(p.available)).toBeCloseTo(10, 6)
    expect(p.priced).toBe(true)
  })
})
