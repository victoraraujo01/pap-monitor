import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { bondId, createUser, num, pool, resetDb, supabase } from './helpers/db'

const SELIC = 'Tesouro Selic 2027'

// Abertura: dá ao cotista cotas e um lote do título (lastro para resgatar/aportar).
async function openFund(admin: string, joao: string, date: string) {
  const bond = await bondId(SELIC)
  const { error } = await supabase.rpc('set_opening_balance', {
    p_admin_id: admin,
    p_date: date,
    p_lots: [{ bond_id: bond, quantity: 100, price: 19250.24 }],
    p_quotas: [{ profile_id: joao, quotas: 100000 }],
  })
  expect(error).toBeNull()
}

function outstanding(pid: string) {
  return num(
    `SELECT repayment_outstanding AS v FROM v_cotista_balance WHERE profile_id='${pid}'`,
  )
}
function contribPaid(pid: string) {
  return num(
    `SELECT total_paid AS v FROM v_cotista_balance WHERE profile_id='${pid}'`,
  )
}

beforeEach(resetDb)
afterAll(async () => {
  await pool.end()
})

describe('Reposição de resgate', () => {
  it('resgate pessoal alimenta o saldo a repor; reposição abate; obrigação ignora a reposição', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await openFund(admin, joao, '2026-04-02')
    await supabase.rpc('generate_monthly_obligations', {
      p_admin_id: admin,
      p_amount: 1000,
    })

    // Resgate pessoal de R$1000 (10 unidades) → vira saldo a repor.
    const { error: wErr } = await supabase.rpc('request_withdrawal', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 10,
      p_amount_brl: 1000,
      p_type: 'RESGATE_PESSOAL',
      p_event_date: '2026-05-15',
    })
    expect(wErr).toBeNull()
    expect(await outstanding(joao)).toBeCloseTo(1000, 2)

    // Aporte de R$1500 com R$600 destinados à reposição.
    const { error: aErr } = await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 5,
      p_amount_brl: 1500,
      p_event_date: '2026-06-15',
      p_reposition_amount: 600,
    })
    expect(aErr).toBeNull()

    // Saldo a repor cai 600 (1000 − 600 = 400).
    expect(await outstanding(joao)).toBeCloseTo(400, 2)
    // Contribuição mensal = aporte − reposição = 1500 − 600 = 900.
    expect(await contribPaid(joao)).toBeCloseTo(900, 2)
    // A view mensal também enxerga só os 900 (reposição não quita mês).
    expect(
      await num(
        `SELECT DISTINCT total_paid AS v FROM v_monthly_obligations WHERE profile_id='${joao}'`,
      ),
    ).toBeCloseTo(900, 2)
  })

  it('aporte 100% reposição não conta como contribuição mensal', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await openFund(admin, joao, '2026-04-02')
    await supabase.rpc('generate_monthly_obligations', {
      p_admin_id: admin,
      p_amount: 1000,
    })
    await supabase.rpc('request_withdrawal', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 10,
      p_amount_brl: 1000,
      p_type: 'RESGATE_PESSOAL',
      p_event_date: '2026-05-15',
    })

    await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 5,
      p_amount_brl: 800,
      p_event_date: '2026-06-15',
      p_reposition_amount: 800,
    })

    expect(await outstanding(joao)).toBeCloseTo(200, 2)
    expect(await contribPaid(joao)).toBeCloseTo(0, 2)
  })

  it('aporte sem reposição mantém o comportamento atual (tudo é contribuição)', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await openFund(admin, joao, '2026-04-02')
    await supabase.rpc('generate_monthly_obligations', {
      p_admin_id: admin,
      p_amount: 1000,
    })

    await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 5,
      p_amount_brl: 1200,
      p_event_date: '2026-06-15',
    })

    expect(await contribPaid(joao)).toBeCloseTo(1200, 2)
    expect(await outstanding(joao)).toBeCloseTo(0, 2)
  })

  it('cotista com resgate e SEM obrigações geradas ainda aparece no saldo (Item 8)', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await openFund(admin, joao, '2026-04-02')
    // Propositalmente NÃO gera obrigações mensais.
    const { error } = await supabase.rpc('request_withdrawal', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 10,
      p_amount_brl: 1000,
      p_type: 'RESGATE_PESSOAL',
      p_event_date: '2026-05-15',
    })
    expect(error).toBeNull()

    // A view é ancorada em profiles, então retorna linha mesmo sem obrigações —
    // o "resgate a repor" não fica invisível.
    const { rows } = await pool.query(
      `SELECT total_expected, repayment_outstanding
         FROM v_cotista_balance WHERE profile_id = $1`,
      [joao],
    )
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].total_expected)).toBeCloseTo(0, 2)
    expect(Number(rows[0].repayment_outstanding)).toBeCloseTo(1000, 2)
  })

  it('reposição maior que o valor do aporte é rejeitada', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await openFund(admin, joao, '2026-04-02')

    const { error } = await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 5,
      p_amount_brl: 1000,
      p_event_date: '2026-06-15',
      p_reposition_amount: 2000,
    })
    expect(error).not.toBeNull()
  })

  it('editar a reposição via apply_event_changes ajusta adimplência sem mexer em cotas', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await openFund(admin, joao, '2026-04-02')
    await supabase.rpc('generate_monthly_obligations', {
      p_admin_id: admin,
      p_amount: 1000,
    })
    await supabase.rpc('request_withdrawal', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 10,
      p_amount_brl: 1000,
      p_type: 'RESGATE_PESSOAL',
      p_event_date: '2026-05-15',
    })

    // Aporte SEM reposição: tudo conta como contribuição, saldo a repor intacto.
    const { data: aporteId, error: aErr } = await supabase.rpc(
      'register_aporte',
      {
        p_profile_id: joao,
        p_bond_id: bond,
        p_quantity: 5,
        p_amount_brl: 1500,
        p_event_date: '2026-06-15',
      },
    )
    expect(aErr).toBeNull()
    expect(await outstanding(joao)).toBeCloseTo(1000, 2)
    expect(await contribPaid(joao)).toBeCloseTo(1500, 2)

    const quotasBefore = await num(
      `SELECT total_quotas AS v FROM pl_history ORDER BY date DESC LIMIT 1`,
    )

    // Edita o mesmo aporte destinando R$600 à reposição.
    const { error: eErr } = await supabase.rpc('apply_event_changes', {
      p_caller_id: joao,
      p_changes: [
        {
          ref: aporteId,
          op: 'update',
          transaction_id: aporteId,
          bond_id: bond,
          quantity: 5,
          amount_brl: 1500,
          event_date: '2026-06-15',
          reposition_amount: 600,
        },
      ],
    })
    expect(eErr).toBeNull()

    expect(await outstanding(joao)).toBeCloseTo(400, 2)
    expect(await contribPaid(joao)).toBeCloseTo(900, 2)
    // Reposição é rótulo contábil: total de cotas/PL não muda.
    const quotasAfter = await num(
      `SELECT total_quotas AS v FROM pl_history ORDER BY date DESC LIMIT 1`,
    )
    expect(quotasAfter).toBeCloseTo(quotasBefore, 4)
  })

  it('criar aporte com reposição via apply_event_changes (batch) abate o saldo', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await openFund(admin, joao, '2026-04-02')
    await supabase.rpc('generate_monthly_obligations', {
      p_admin_id: admin,
      p_amount: 1000,
    })
    await supabase.rpc('request_withdrawal', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 10,
      p_amount_brl: 1000,
      p_type: 'RESGATE_PESSOAL',
      p_event_date: '2026-05-15',
    })

    const { error } = await supabase.rpc('apply_event_changes', {
      p_caller_id: joao,
      p_changes: [
        {
          ref: 'novo-1',
          op: 'create',
          kind: 'APORTE',
          profile_id: joao,
          bond_id: bond,
          quantity: 5,
          amount_brl: 1500,
          event_date: '2026-06-15',
          reposition_amount: 600,
        },
      ],
    })
    expect(error).toBeNull()
    expect(await outstanding(joao)).toBeCloseTo(400, 2)
    expect(await contribPaid(joao)).toBeCloseTo(900, 2)
  })

  it('editar sem informar reposição preserva a reposição atual', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const bond = await bondId(SELIC)
    await openFund(admin, joao, '2026-04-02')
    await supabase.rpc('generate_monthly_obligations', {
      p_admin_id: admin,
      p_amount: 1000,
    })
    await supabase.rpc('request_withdrawal', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 10,
      p_amount_brl: 1000,
      p_type: 'RESGATE_PESSOAL',
      p_event_date: '2026-05-15',
    })
    const { data: aporteId } = await supabase.rpc('register_aporte', {
      p_profile_id: joao,
      p_bond_id: bond,
      p_quantity: 5,
      p_amount_brl: 1500,
      p_event_date: '2026-06-15',
      p_reposition_amount: 600,
    })
    expect(await outstanding(joao)).toBeCloseTo(400, 2)

    // Edita o valor (omitindo reposition_amount) → reposição mantida em 600.
    const { error } = await supabase.rpc('apply_event_changes', {
      p_caller_id: joao,
      p_changes: [
        {
          ref: aporteId,
          op: 'update',
          transaction_id: aporteId,
          bond_id: bond,
          quantity: 5,
          amount_brl: 1600,
          event_date: '2026-06-15',
        },
      ],
    })
    expect(error).toBeNull()
    expect(await outstanding(joao)).toBeCloseTo(400, 2)
  })
})
