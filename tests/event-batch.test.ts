import { beforeEach, afterAll, describe, expect, it } from 'vitest'
import { bondId, createUser, num, one, pool, resetDb, supabase } from './helpers/db'

const SELIC = 'Tesouro Selic 2027'

async function setPrice(name: string, price: number): Promise<void> {
  await pool.query(
    'UPDATE treasury_bonds SET current_price = $2 WHERE api_reference_name = $1',
    [name, price],
  )
}

beforeEach(resetDb)
afterAll(async () => {
  await pool.end()
})

describe('apply_event_changes — alterações em batch', () => {
  it('aplica create + update + delete numa transação só (1 rebuild)', async () => {
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await setPrice(SELIC, 10000)

    const { data: aporteA } = await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.1,
      p_amount_brl: 1000,
    })
    const { data: aporteB } = await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.2,
      p_amount_brl: 2000,
    })

    const { data, error } = await supabase.rpc('apply_event_changes', {
      p_caller_id: joao,
      p_changes: [
        { ref: 'del-B', op: 'delete', transaction_id: aporteB as string },
        {
          ref: 'upd-A',
          op: 'update',
          transaction_id: aporteA as string,
          bond_id: bond,
          quantity: 0.25,
          amount_brl: 2500,
          event_date: '2026-02-15',
        },
        {
          ref: 'new',
          op: 'create',
          kind: 'APORTE',
          profile_id: joao,
          bond_id: bond,
          quantity: 0.3,
          amount_brl: 3000,
          event_date: '2026-03-01',
        },
      ],
    })
    expect(error).toBeNull()
    expect((data as { applied: number }).applied).toBe(3)

    // B removido; A editado; um aporte novo criado.
    expect(
      await num('SELECT count(*) AS v FROM transactions WHERE id = $1', [aporteB]),
    ).toBe(0)
    const a = await one<{ amount_brl: string; quantity: string }>(
      'SELECT amount_brl, quantity FROM transactions WHERE id = $1',
      [aporteA],
    )
    expect(Number(a.amount_brl)).toBeCloseTo(2500, 2)
    expect(Number(a.quantity)).toBeCloseTo(0.25, 6)

    // 2 aportes APPROVED (A editado + novo); lote de B sumiu.
    expect(
      await num(
        "SELECT count(*) AS v FROM transactions WHERE status='APPROVED' AND is_opening=FALSE",
      ),
    ).toBe(2)
    expect(
      await num('SELECT count(*) AS v FROM fund_bond_lots'),
    ).toBe(2)

    // O rebuild rodou: lote de A resetado para a qtd emitida (0.25) e série de PL gerada.
    expect(
      await num(
        'SELECT quantity AS v FROM fund_bond_lots WHERE transaction_id = $1',
        [aporteA],
      ),
    ).toBeCloseTo(0.25, 6)
    expect(await num('SELECT count(*) AS v FROM pl_history')).toBeGreaterThan(0)
  })

  it('é atômico: item inválido aborta o lote inteiro e reporta o ref', async () => {
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await setPrice(SELIC, 10000)

    const { data: aporte } = await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 0.1,
      p_amount_brl: 1000,
    })

    const { error } = await supabase.rpc('apply_event_changes', {
      p_caller_id: joao,
      p_changes: [
        { ref: 'del-ok', op: 'delete', transaction_id: aporte as string },
        {
          ref: 'upd-bad',
          op: 'update',
          transaction_id: aporte as string,
          bond_id: bond,
          quantity: -1, // inválido
          amount_brl: 2500,
          event_date: '2026-02-15',
        },
      ],
    })
    expect(error).not.toBeNull()
    expect(error?.message).toContain('ref=upd-bad')

    // Rollback total: o delete válido NÃO persistiu — o aporte continua lá.
    expect(
      await num('SELECT count(*) AS v FROM transactions WHERE id = $1', [aporte]),
    ).toBe(1)
  })

  it('admin cria aporte em nome de outro cotista', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await setPrice(SELIC, 10000)

    const { error } = await supabase.rpc('apply_event_changes', {
      p_caller_id: admin,
      p_changes: [
        {
          ref: 'new',
          op: 'create',
          kind: 'APORTE',
          profile_id: joao, // em nome do João
          bond_id: bond,
          quantity: 0.1,
          amount_brl: 1000,
          event_date: '2026-01-10',
        },
      ],
    })
    expect(error).toBeNull()
    // O aporte pertence ao João (não ao admin).
    expect(
      await num(
        "SELECT count(*) AS v FROM transactions WHERE profile_id = $1 AND type='APORTE'",
        [joao],
      ),
    ).toBe(1)
  })

  it('recusa criar lançamento de outro cotista (não-admin)', async () => {
    const joao = await createUser('Joao')
    const maria = await createUser('Maria')
    const bond = await bondId(SELIC)
    await setPrice(SELIC, 10000)

    const { error } = await supabase.rpc('apply_event_changes', {
      p_caller_id: maria, // cotista comum
      p_changes: [
        {
          ref: 'new',
          op: 'create',
          kind: 'APORTE',
          profile_id: joao, // de outro
          bond_id: bond,
          quantity: 0.1,
          amount_brl: 1000,
          event_date: '2026-01-10',
        },
      ],
    })
    expect(error).not.toBeNull()
    expect(error?.message).toContain('autor')
    expect(
      await num(
        "SELECT count(*) AS v FROM transactions WHERE status='APPROVED'",
      ),
    ).toBe(0)
  })
})
