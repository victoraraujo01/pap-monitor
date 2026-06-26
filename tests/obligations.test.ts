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

// Nº de meses (inclusive) do mês de `start` até o mês corrente.
function monthsSince(start: string): number {
  const s = new Date(start)
  const n = new Date()
  return (
    (n.getFullYear() - s.getFullYear()) * 12 + (n.getMonth() - s.getMonth()) + 1
  )
}

async function openFund(admin: string, joao: string, date: string) {
  const bond = await bondId(SELIC)
  const { error } = await supabase.rpc('set_opening_balance', {
    p_admin_id: admin,
    p_date: date,
    p_contributions: [
      { profile_id: joao, bond_id: bond, quantity: 1, amount: 10000 },
    ],
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

    // Sem aportes, todas PENDING no status DERIVADO (view), valor configurado.
    expect(
      await num(
        "SELECT count(*) AS v FROM v_monthly_obligations WHERE status='PENDING'",
      ),
    ).toBe(expected)
    expect(
      await num(
        'SELECT DISTINCT amount_expected AS v FROM monthly_obligations',
      ),
    ).toBeCloseTo(1200, 2)

    // 2ª chamada não duplica.
    const { data: again } = await supabase.rpc('generate_monthly_obligations', {
      p_admin_id: admin,
      p_amount: 1200,
    })
    expect(again).toBe(0)
    expect(await num('SELECT count(*) AS v FROM monthly_obligations')).toBe(
      expected,
    )
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

  it('admin força e limpa o override de status (sobrepõe a regra automática)', async () => {
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

    // Sem aporte → derivado PENDING. Override força PAID.
    const { error } = await supabase.rpc('set_obligation_status', {
      p_admin_id: admin,
      p_obligation_id: ob.id,
      p_status: 'PAID',
    })
    expect(error).toBeNull()
    const forced = await one<{
      status: string
      status_override: string | null
    }>(
      'SELECT status, status_override FROM v_monthly_obligations WHERE id=$1',
      [ob.id],
    )
    expect(forced.status).toBe('PAID')
    expect(forced.status_override).toBe('PAID')

    // Limpar (omitir p_status = NULL) → volta ao automático (PENDING).
    const cleared = await supabase.rpc('set_obligation_status', {
      p_admin_id: admin,
      p_obligation_id: ob.id,
    })
    expect(cleared.error).toBeNull()
    const auto = await one<{ status: string; status_override: string | null }>(
      'SELECT status, status_override FROM v_monthly_obligations WHERE id=$1',
      [ob.id],
    )
    expect(auto.status).toBe('PENDING')
    expect(auto.status_override).toBeNull()

    // Cotista comum não pode corrigir.
    const negado = await supabase.rpc('set_obligation_status', {
      p_admin_id: joao,
      p_obligation_id: ob.id,
      p_status: 'PENDING',
    })
    expect(negado.error?.message).toContain('administradores')
  })

  it('override PAGO zera a dívida do mês no saldo total', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    await openFund(admin, joao, '2026-06-01') // único mês (mês corrente)
    await supabase.rpc('generate_monthly_obligations', {
      p_admin_id: admin,
      p_amount: 1000,
    })

    const balBefore = await num(
      'SELECT balance AS v FROM v_cotista_balance WHERE profile_id=$1',
      [joao],
    )
    const months = await num(
      'SELECT count(*) AS v FROM monthly_obligations WHERE profile_id=$1',
      [joao],
    )
    // Sem aporte, devedor = nº de meses × 1000.
    expect(balBefore).toBeCloseTo(months * 1000, 2)

    const ob = await one<{ id: string }>(
      'SELECT id FROM monthly_obligations WHERE profile_id=$1 ORDER BY reference_month LIMIT 1',
      [joao],
    )
    // Admin marca o 1º mês como pago (fora do sistema) → some da dívida.
    await supabase.rpc('set_obligation_status', {
      p_admin_id: admin,
      p_obligation_id: ob.id,
      p_status: 'PAID',
    })
    const balAfter = await num(
      'SELECT balance AS v FROM v_cotista_balance WHERE profile_id=$1',
      [joao],
    )
    expect(balAfter).toBeCloseTo(balBefore - 1000, 2)
  })

  it('remove uma obrigação de vez (não é recriada pelo gerador)', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    await openFund(admin, joao, '2026-04-01')
    await supabase.rpc('generate_monthly_obligations', {
      p_admin_id: admin,
      p_amount: 1000,
    })

    const ob = await one<{ id: string }>(
      'SELECT id FROM monthly_obligations WHERE profile_id=$1 ORDER BY reference_month LIMIT 1',
      [joao],
    )
    const visibleBefore = await num(
      'SELECT count(*) AS v FROM v_monthly_obligations WHERE profile_id=$1',
      [joao],
    )

    // Cotista comum não remove.
    const negado = await supabase.rpc('delete_obligation', {
      p_admin_id: joao,
      p_obligation_id: ob.id,
    })
    expect(negado.error?.message).toContain('administradores')

    // Admin remove → some da view.
    const { error } = await supabase.rpc('delete_obligation', {
      p_admin_id: admin,
      p_obligation_id: ob.id,
    })
    expect(error).toBeNull()
    expect(
      await num(
        'SELECT count(*) AS v FROM v_monthly_obligations WHERE profile_id=$1',
        [joao],
      ),
    ).toBe(visibleBefore - 1)

    // Gerar de novo NÃO recria o mês removido (tombstone ocupa o slot único).
    await supabase.rpc('generate_monthly_obligations', {
      p_admin_id: admin,
      p_amount: 1000,
    })
    expect(
      await num(
        'SELECT count(*) AS v FROM v_monthly_obligations WHERE profile_id=$1',
        [joao],
      ),
    ).toBe(visibleBefore - 1)
  })
})

describe('Status derivado (FIFO 90%) + saldo acumulado', () => {
  async function aporte(
    profile: string,
    amount: number,
    date: string,
    quantity = 1,
  ) {
    const bond = await bondId(SELIC)
    const { error } = await supabase.rpc('register_aporte', {
      p_profile_id: profile,
      p_bond_id: bond,
      p_quantity: quantity,
      p_amount_brl: amount,
      p_event_date: date,
    })
    expect(error).toBeNull()
  }

  // Status mensal de um cotista (cronológico) e saldo total.
  async function paidMonths(profile: string): Promise<number> {
    return num(
      "SELECT count(*) AS v FROM v_monthly_obligations WHERE profile_id=$1 AND status='PAID'",
      [profile],
    )
  }
  async function balance(profile: string): Promise<number> {
    return num(
      'SELECT balance AS v FROM v_cotista_balance WHERE profile_id=$1',
      [profile],
    )
  }
  // Nº de meses gerados para o cotista (fonte da verdade no banco — evita o bug de
  // fuso ao parsear datas no JS).
  async function monthsCount(profile: string): Promise<number> {
    return num(
      'SELECT count(*) AS v FROM v_monthly_obligations WHERE profile_id=$1',
      [profile],
    )
  }

  it('aporte de R$980 (98%) quita o mês; saldo guarda o troco de R$20', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const open = '2026-01-01'
    await openFund(admin, joao, open)
    await supabase.rpc('generate_monthly_obligations', {
      p_admin_id: admin,
      p_amount: 1000,
    })

    await aporte(joao, 980, open)

    expect(await paidMonths(joao)).toBe(1) // só o 1º mês cobre ≥90%
    expect(await balance(joao)).toBeCloseTo(
      (await monthsCount(joao)) * 1000 - 980,
      2,
    )
  })

  it('aporte de R$800 (80%) não quita o mês', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const open = '2026-01-01'
    await openFund(admin, joao, open)
    await supabase.rpc('generate_monthly_obligations', {
      p_admin_id: admin,
      p_amount: 1000,
    })

    await aporte(joao, 800, open)

    expect(await paidMonths(joao)).toBe(0) // 80% < 90%
    expect(await balance(joao)).toBeCloseTo(
      (await monthsCount(joao)) * 1000 - 800,
      2,
    )
  })

  it('quitar todos os atrasados num aporte único pinta todos os meses (FIFO)', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const open = '2026-01-01'
    await openFund(admin, joao, open)
    await supabase.rpc('generate_monthly_obligations', {
      p_admin_id: admin,
      p_amount: 1000,
    })

    const n = await monthsCount(joao)
    // Aporte único do total devido, datado no mês corrente.
    await aporte(joao, n * 1000, new Date().toISOString().slice(0, 10))

    expect(await paidMonths(joao)).toBe(n) // todos verdes, retroativamente
    expect(await balance(joao)).toBeCloseTo(0, 2)
  })

  it('saldo de abertura não conta como aporte mensal', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const open = '2026-01-01'
    await openFund(admin, joao, open) // 10000 de carteira inicial
    await supabase.rpc('generate_monthly_obligations', {
      p_admin_id: admin,
      p_amount: 1000,
    })

    // Apesar dos R$10000 de abertura, nada foi "aportado" → tudo pendente.
    expect(await paidMonths(joao)).toBe(0)
    expect(await balance(joao)).toBeCloseTo((await monthsCount(joao)) * 1000, 2)
  })
})
