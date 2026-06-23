import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createUser, one, pool, resetDb, supabase } from './helpers/db'

// Título fictício para não colidir com o catálogo do seed; removido a cada teste
// (resetDb preserva treasury_bonds, então limpamos manualmente).
const TEST_BOND = 'Tesouro Selic 2099'

type BondRow = {
  display_name: string
  is_available_for_purchase: boolean
  current_price: string | null
}

beforeEach(resetDb)
afterEach(async () => {
  await pool.query('DELETE FROM treasury_bonds WHERE api_reference_name = $1', [
    TEST_BOND,
  ])
})
afterAll(async () => {
  await pool.end()
})

describe('Catálogo de títulos — upsert_treasury_bond', () => {
  it('admin cadastra um título novo com preço e disponibilidade', async () => {
    const admin = await createUser('Admin', 'ADMIN')

    const { error } = await supabase.rpc('upsert_treasury_bond', {
      p_admin_id: admin,
      p_api_reference_name: TEST_BOND,
      p_display_name: TEST_BOND,
      p_is_available: true,
      p_current_price: 12345.678901,
    })
    expect(error).toBeNull()

    const row = await one<BondRow>(
      'SELECT display_name, is_available_for_purchase, current_price FROM treasury_bonds WHERE api_reference_name = $1',
      [TEST_BOND],
    )
    expect(row.display_name).toBe(TEST_BOND)
    expect(row.is_available_for_purchase).toBe(true)
    expect(Number(row.current_price)).toBeCloseTo(12345.678901, 6)
  })

  it('upsert altera a disponibilidade sem sobrescrever o preço já conhecido', async () => {
    const admin = await createUser('Admin', 'ADMIN')

    await supabase.rpc('upsert_treasury_bond', {
      p_admin_id: admin,
      p_api_reference_name: TEST_BOND,
      p_display_name: TEST_BOND,
      p_is_available: true,
      p_current_price: 1000,
    })

    // Segundo upsert (toggle de disponibilidade) sem informar preço.
    const { error } = await supabase.rpc('upsert_treasury_bond', {
      p_admin_id: admin,
      p_api_reference_name: TEST_BOND,
      p_is_available: false,
    })
    expect(error).toBeNull()

    const row = await one<BondRow>(
      'SELECT display_name, is_available_for_purchase, current_price FROM treasury_bonds WHERE api_reference_name = $1',
      [TEST_BOND],
    )
    expect(row.is_available_for_purchase).toBe(false)
    // Preço preservado (território do job diário).
    expect(Number(row.current_price)).toBeCloseTo(1000, 6)
  })

  it('cotista comum não pode cadastrar título', async () => {
    const joao = await createUser('Joao')

    const { error } = await supabase.rpc('upsert_treasury_bond', {
      p_admin_id: joao,
      p_api_reference_name: TEST_BOND,
      p_display_name: TEST_BOND,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/administrador/i)
  })
})
