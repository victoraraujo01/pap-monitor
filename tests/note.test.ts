import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { bondId, createUser, one, pool, resetDb, supabase } from './helpers/db'

const SELIC = 'Tesouro Selic 2027'

// Abertura: dá ao cotista cotas + um lote do título (lastro para resgatar/aportar).
async function openFund(admin: string, joao: string, date: string) {
  const bond = await bondId(SELIC)
  const { error } = await supabase.rpc('set_opening_balance', {
    p_admin_id: admin,
    p_date: date,
    p_contributions: [
      { profile_id: joao, bond_id: bond, quantity: 100, amount: 1925024 },
    ],
    p_quota_price: 19.25024,
  })
  expect(error).toBeNull()
}

function noteOf(id: string) {
  return one<{ note: string | null }>(
    'SELECT note FROM transactions WHERE id = $1',
    [id],
  ).then((r) => r.note)
}

beforeEach(resetDb)
afterAll(async () => {
  await pool.end()
})

describe('Nota em movimentações', () => {
  it('grava a nota no aporte e no resgate e ela sobrevive ao rebuild', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await openFund(admin, joao, '2026-04-02')

    const { data: aporteId, error: aErr } = await supabase.rpc(
      'register_aporte',
      {
        p_profile_id: joao,
        p_bond_id: bond,
        p_quantity: 5,
        p_amount_brl: 1000,
        p_event_date: '2026-05-10',
        p_note: '  aporte do 13º  ',
      },
    )
    expect(aErr).toBeNull()
    // btrim aplicado na gravação.
    expect(await noteOf(aporteId as string)).toBe('aporte do 13º')

    const { data: resgateId, error: wErr } = await supabase.rpc(
      'request_withdrawal',
      {
        p_profile_id: joao,
        p_bond_id: bond,
        p_quantity: 2,
        p_amount_brl: 400,
        p_type: 'RESGATE_PESSOAL',
        p_event_date: '2026-05-20',
        p_note: 'consulta médica',
      },
    )
    expect(wErr).toBeNull()
    expect(await noteOf(resgateId as string)).toBe('consulta médica')

    // O replay completo não pode apagar a nota (metadata pura).
    const { error: rErr } = await supabase.rpc('rebuild_fund_history', {
      p_admin_id: admin,
    })
    expect(rErr).toBeNull()
    expect(await noteOf(aporteId as string)).toBe('aporte do 13º')
    expect(await noteOf(resgateId as string)).toBe('consulta médica')
  })

  it('aporte sem nota fica NULL (string vazia normaliza para NULL)', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await openFund(admin, joao, '2026-04-02')

    const { data: id } = await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 5,
      p_amount_brl: 1000,
      p_event_date: '2026-05-10',
      p_note: '   ',
    })
    expect(await noteOf(id as string)).toBeNull()
  })

  it('apply_event_changes: update edita a nota; "" limpa; ausência mantém', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await openFund(admin, joao, '2026-04-02')

    const { data: id } = await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 5,
      p_amount_brl: 1000,
      p_event_date: '2026-05-10',
      p_note: 'original',
    })
    const txn = id as string

    // Update sem 'note' → mantém a nota atual.
    const { error: e1 } = await supabase.rpc('apply_event_changes', {
      p_caller_id: joao,
      p_changes: [
        {
          ref: txn,
          op: 'update',
          transaction_id: txn,
          bond_id: bond,
          quantity: 6,
          amount_brl: 1200,
          event_date: '2026-05-10',
        },
      ],
    })
    expect(e1).toBeNull()
    expect(await noteOf(txn)).toBe('original')

    // Update com nova nota → substitui.
    const { error: e2 } = await supabase.rpc('apply_event_changes', {
      p_caller_id: joao,
      p_changes: [
        {
          ref: txn,
          op: 'update',
          transaction_id: txn,
          bond_id: bond,
          quantity: 6,
          amount_brl: 1200,
          event_date: '2026-05-10',
          note: 'revisada',
        },
      ],
    })
    expect(e2).toBeNull()
    expect(await noteOf(txn)).toBe('revisada')

    // Update com nota "" → limpa.
    const { error: e3 } = await supabase.rpc('apply_event_changes', {
      p_caller_id: joao,
      p_changes: [
        {
          ref: txn,
          op: 'update',
          transaction_id: txn,
          bond_id: bond,
          quantity: 6,
          amount_brl: 1200,
          event_date: '2026-05-10',
          note: '',
        },
      ],
    })
    expect(e3).toBeNull()
    expect(await noteOf(txn)).toBeNull()
  })
})
