import { beforeEach, afterAll, describe, expect, it } from 'vitest'
import { bondId, createUser, num, one, pool, resetDb, supabase } from './helpers/db'

const SELIC = 'Tesouro Selic 2027'

// Nº de meses (inclusive) do mês de `start` até o mês corrente.
function monthsSince(start: string): number {
  const s = new Date(start)
  const n = new Date()
  return (n.getFullYear() - s.getFullYear()) * 12 + (n.getMonth() - s.getMonth()) + 1
}

async function openFund(admin: string, joao: string, date: string) {
  const bond = await bondId(SELIC)
  const { error } = await supabase.rpc('set_opening_balance', {
    p_admin_id: admin,
    p_date: date,
    p_lots: [{ bond_id: bond, quantity: 1, price: 10000 }],
    p_quotas: [{ profile_id: joao, quotas: 10000, amount: 10000 }],
  })
  expect(error).toBeNull()
}

beforeEach(resetDb)
afterAll(async () => {
  await pool.end()
})

describe('Obrigações mensais', () => {
  it('gera uma fatura por cotista por mês, da abertura até hoje (idempotente)', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    await createUser('Maria') // 3º cotista, só para inflar a contagem
    const open = '2026-04-02'
    await openFund(admin, joao, open)

    const expected = monthsSince(open) * 3 // 3 cotistas (admin/joao/maria)

    const { data: created, error } = await supabase.rpc(
      'generate_monthly_obligations',
      { p_admin_id: admin, p_amount: 1200 },
    )
    expect(error).toBeNull()
    expect(created).toBe(expected)

    // Todas PENDING, valor configurado.
    expect(
      await num("SELECT count(*) AS v FROM monthly_obligations WHERE status='PENDING'"),
    ).toBe(expected)
    expect(
      await num('SELECT DISTINCT amount_expected AS v FROM monthly_obligations'),
    ).toBeCloseTo(1200, 2)

    // 2ª chamada não duplica.
    const { data: again } = await supabase.rpc('generate_monthly_obligations', {
      p_admin_id: admin,
      p_amount: 1200,
    })
    expect(again).toBe(0)
    expect(await num('SELECT count(*) AS v FROM monthly_obligations')).toBe(expected)
  })

  it('exige ADMIN para gerar', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    await openFund(admin, joao, '2026-05-01')

    const { error } = await supabase.rpc('generate_monthly_obligations', {
      p_admin_id: joao, // cotista comum
      p_amount: 1000,
    })
    expect(error?.message).toContain('administradores')
  })

  it('exige saldo de abertura antes de gerar', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const { error } = await supabase.rpc('generate_monthly_obligations', {
      p_admin_id: admin,
      p_amount: 1000,
    })
    expect(error?.message).toContain('saldo de abertura')
  })

  it('admin corrige o status de uma fatura (PENDING ↔ PAID)', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    await openFund(admin, joao, '2026-06-01')
    await supabase.rpc('generate_monthly_obligations', {
      p_admin_id: admin,
      p_amount: 1000,
    })

    const ob = await one<{ id: string }>(
      'SELECT id FROM monthly_obligations WHERE profile_id = $1 LIMIT 1',
      [joao],
    )

    const { error } = await supabase.rpc('set_obligation_status', {
      p_admin_id: admin,
      p_obligation_id: ob.id,
      p_status: 'PAID',
    })
    expect(error).toBeNull()
    expect(
      await num('SELECT count(*) AS v FROM monthly_obligations WHERE id=$1 AND status=$2', [
        ob.id,
        'PAID',
      ]),
    ).toBe(1)

    // Cotista comum não pode corrigir.
    const negado = await supabase.rpc('set_obligation_status', {
      p_admin_id: joao,
      p_obligation_id: ob.id,
      p_status: 'PENDING',
    })
    expect(negado.error?.message).toContain('administradores')
  })
})
