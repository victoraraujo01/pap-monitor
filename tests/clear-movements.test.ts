import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { bondId, createUser, num, pool, resetDb, supabase } from './helpers/db'

const BOND = 'Tesouro Selic 2027'

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await pool.end()
})

// Monta um cenário com abertura + aporte + obrigações + preço histórico, e devolve
// os ids relevantes.
async function seedScenario() {
  const admin = await createUser('AdminClr', 'ADMIN')
  const joao = await createUser('JoaoClr')
  const bond = await bondId(BOND)
  await pool.query(
    'UPDATE treasury_bonds SET is_available_for_purchase = TRUE WHERE id = $1',
    [bond],
  )
  await pool.query(
    `INSERT INTO bond_price_history (bond_id, date, price) VALUES ($1, $2, $3)
     ON CONFLICT (bond_id, date) DO UPDATE SET price = EXCLUDED.price`,
    [bond, '2026-01-01', 100],
  )
  await supabase.rpc('set_opening_balance', {
    p_admin_id: admin,
    p_date: '2026-01-01',
    p_lots: [{ bond_id: bond, quantity: 10, price: 100 }],
    p_quotas: [{ profile_id: joao, quotas: 1000 }],
  })
  await supabase.rpc('register_aporte', {
    p_profile_id: joao,
    p_bond_id: bond,
    p_quantity: 5,
    p_amount_brl: 600,
    p_event_date: '2026-02-01',
  })
  await supabase.rpc('generate_monthly_obligations', {
    p_admin_id: admin,
    p_amount: 1000,
  })
  return { admin, joao, bond }
}

describe('clear_all_movements', () => {
  it('apaga todo o livro de movimentações, preservando catálogo e preços', async () => {
    const { admin, bond } = await seedScenario()

    // Pré-condições: há movimentações lançadas.
    expect(await num('SELECT COUNT(*) v FROM transactions')).toBeGreaterThan(0)
    expect(await num('SELECT COUNT(*) v FROM fund_bond_lots')).toBeGreaterThan(0)
    expect(
      await num('SELECT COUNT(*) v FROM monthly_obligations'),
    ).toBeGreaterThan(0)
    expect(await num('SELECT COUNT(*) v FROM pl_history')).toBeGreaterThan(0)

    const { error } = await supabase.rpc('clear_all_movements', {
      p_admin_id: admin,
    })
    expect(error).toBeNull()

    // Tudo zerado…
    expect(await num('SELECT COUNT(*) v FROM transactions')).toBe(0)
    expect(await num('SELECT COUNT(*) v FROM fund_bond_lots')).toBe(0)
    expect(await num('SELECT COUNT(*) v FROM monthly_obligations')).toBe(0)
    expect(await num('SELECT COUNT(*) v FROM pl_history')).toBe(0)

    // …menos o catálogo e os preços históricos.
    expect(await num('SELECT COUNT(*) v FROM treasury_bonds')).toBeGreaterThan(0)
    expect(
      await num('SELECT COUNT(*) v FROM bond_price_history WHERE bond_id = $1', [
        bond,
      ]),
    ).toBe(1)
  })

  it('rejeita chamadores não-admin', async () => {
    const { joao } = await seedScenario()
    const { error } = await supabase.rpc('clear_all_movements', {
      p_admin_id: joao,
    })
    expect(error).not.toBeNull()
    // Nada foi apagado.
    expect(await num('SELECT COUNT(*) v FROM transactions')).toBeGreaterThan(0)
  })
})
