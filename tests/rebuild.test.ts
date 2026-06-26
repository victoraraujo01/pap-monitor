import { beforeEach, afterAll, describe, expect, it } from 'vitest'
import { bondId, createUser, num, one, pool, resetDb, supabase } from './helpers/db'

const SELIC = 'Tesouro Selic 2027'

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

beforeEach(async () => {
  await resetDb()
  await pool.query('TRUNCATE bond_price_history')
})
afterAll(async () => {
  await pool.end()
})

describe('Fase 2 — update_bond_price_history + pap_price_on', () => {
  it('faz UPSERT por api_reference_name e carry-forward na consulta por data', async () => {
    const { error } = await supabase.rpc('update_bond_price_history', {
      p_rows: [
        { name: SELIC, date: '2026-01-01', price: 100 },
        { name: SELIC, date: '2026-06-01', price: 200 },
        { name: 'Inexistente 9999', date: '2026-01-01', price: 5 }, // ignorado
      ],
    })
    expect(error).toBeNull()

    const id = await bondId(SELIC)
    expect(await num('SELECT count(*) AS v FROM bond_price_history')).toBe(2)
    // Carry-forward: antes da 1ª data cai na mais próxima; entre datas mantém a anterior.
    expect(await num('SELECT pap_price_on($1, $2) AS v', [id, '2026-03-15'])).toBeCloseTo(100, 6)
    expect(await num('SELECT pap_price_on($1, $2) AS v', [id, '2026-12-31'])).toBeCloseTo(200, 6)
  })
})

describe('Fase 2 — rebuild_fund_history', () => {
  it('exige ADMIN', async () => {
    const joao = await createUser('Joao')
    const { error } = await supabase.rpc('rebuild_fund_history', {
      p_admin_id: joao,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toContain('administradores')
  })

  it('recompõe a cota de um aporte pela cotação histórica do dia', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)

    // Preço dobra entre a abertura e o aporte.
    await seedPriceHistory(SELIC, [
      ['2026-01-01', 100],
      ['2026-06-01', 200],
    ])

    // Abertura em 01/01: 10 unid a R$100 (carteira R$1.000), João com 1.000 cotas.
    await supabase.rpc('set_opening_balance', {
      p_admin_id: admin,
      p_date: '2026-01-01',
      p_lots: [{ bond_id: bond, quantity: 10, price: 100 }],
      p_quotas: [{ profile_id: joao, quotas: 1000, amount: 1000 }],
    })

    // Aporte em 01/06: R$1.000 (5 unid a R$200). Cota naïve do registro será
    // corrigida pelo rebuild.
    const { data: aporteId } = await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 5,
      p_amount_brl: 1000,
      p_event_date: '2026-06-01',
    })

    expect(
      (await supabase.rpc('rebuild_fund_history', { p_admin_id: admin })).error,
    ).toBeNull()

    // Em 01/06, antes do aporte: carteira de abertura = 10×200 = 2.000 bruto;
    // lucro 1.000; 151 dias → IR 22,5% = 225; líquido 1.775; cota = 1,775.
    // Aporte de 1.000 → 1.000 / 1,775 ≈ 563,38 cotas (NÃO 1.000).
    const aporte = await one<{ quotas_amount: string; quota_price: string }>(
      'SELECT quotas_amount, quota_price FROM transactions WHERE id = $1',
      [aporteId],
    )
    expect(Number(aporte.quota_price)).toBeCloseTo(1.775, 4)
    expect(Number(aporte.quotas_amount)).toBeCloseTo(1000 / 1.775, 2)

    // Abertura preserva as cotas dadas (não recomputadas). A linha de
    // participação é a de cota (target_bond_id NULL); as sementes de carteira têm cota 0.
    expect(
      await num(
        "SELECT quotas_amount AS v FROM transactions WHERE is_opening AND target_bond_id IS NULL",
      ),
    ).toBeCloseTo(1000, 6)

    // Série diária gerada de 01/01 até hoje, com pontos nas datas-chave.
    expect(
      await num("SELECT count(*) AS v FROM pl_history WHERE date = '2026-01-01'"),
    ).toBe(1)
    const jun = await one<{ total_pl_brl: string; total_quotas: string; quota_price: string }>(
      "SELECT total_pl_brl, total_quotas, quota_price FROM pl_history WHERE date = '2026-06-01'",
    )
    // PL pós-aporte: 1.775 (abertura) + 1.000 (novo lote, lucro 0) = 2.775.
    expect(Number(jun.total_pl_brl)).toBeCloseTo(2775, 2)
    expect(Number(jun.total_quotas)).toBeCloseTo(1000 + 1000 / 1.775, 2)
    expect(Number(jun.quota_price)).toBeCloseTo(1.775, 4)
  })

  it('reconstrói de forma idempotente (rodar 2x dá o mesmo resultado)', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await seedPriceHistory(SELIC, [['2026-01-01', 100], ['2026-06-01', 200]])
    await supabase.rpc('set_opening_balance', {
      p_admin_id: admin,
      p_date: '2026-01-01',
      p_lots: [{ bond_id: bond, quantity: 10, price: 100 }],
      p_quotas: [{ profile_id: joao, quotas: 1000, amount: 1000 }],
    })
    await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 5,
      p_amount_brl: 1000,
      p_event_date: '2026-06-01',
    })

    await supabase.rpc('rebuild_fund_history', { p_admin_id: admin })
    const first = await num("SELECT total_quotas AS v FROM pl_history WHERE date = '2026-06-01'")
    const rows1 = await num('SELECT count(*) AS v FROM pl_history')

    await supabase.rpc('rebuild_fund_history', { p_admin_id: admin })
    const second = await num("SELECT total_quotas AS v FROM pl_history WHERE date = '2026-06-01'")
    const rows2 = await num('SELECT count(*) AS v FROM pl_history')

    expect(second).toBeCloseTo(first, 6)
    expect(rows2).toBe(rows1)
  })
})
