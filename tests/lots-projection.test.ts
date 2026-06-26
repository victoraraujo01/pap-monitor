import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { bondId, createUser, num, one, pool, resetDb, supabase } from './helpers/db'

// fund_bond_lots como PROJEÇÃO do livro-razão: a abertura e os destinos do
// reinvestimento agora vivem em transactions, e pap_rebuild_history TRUNCA e
// RECRIA todos os lotes a partir do ledger. Estes testes provam que o estado
// dos lotes sobrevive a um rebuild "do zero" e que a abertura materializa lotes
// via replay (não mais por insert direto).

const SOURCE = 'Tesouro Selic 2027'
const TGT_A = 'Tesouro IPCA+ 2035'
const TGT_B = 'Tesouro IPCA+ 2032'

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

async function makePurchasable(name: string): Promise<string> {
  const id = await bondId(name)
  await pool.query(
    'UPDATE treasury_bonds SET is_available_for_purchase = TRUE WHERE id = $1',
    [id],
  )
  return id
}

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await pool.end()
})

describe('Abertura materializada por replay', () => {
  it('cria lotes is_opening a partir de transações-semente (não insert direto)', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const selic = await bondId(SOURCE)
    const ipca = await makePurchasable(TGT_A)

    const { error } = await supabase.rpc('set_opening_balance', {
      p_admin_id: admin,
      p_date: '2026-01-01',
      p_lots: [
        { bond_id: selic, quantity: 10, price: 100 },
        { bond_id: ipca, quantity: 4, price: 250 },
      ],
      p_quotas: [{ profile_id: joao, quotas: 2000 }],
      p_quota_price: 1,
    })
    expect(error).toBeNull()

    // Toda semente virou uma transação is_opening com target_bond_id e cota 0.
    const seeds = await num(
      `SELECT COUNT(*) v FROM transactions
       WHERE is_opening AND target_bond_id IS NOT NULL AND quotas_amount = 0`,
    )
    expect(seeds).toBe(2)

    // Os lotes de abertura existem, vieram do replay (transaction_id NÃO nulo,
    // ao contrário do modelo antigo) e refletem qtd/preço informados.
    const lots = (
      await pool.query(
        `SELECT b.api_reference_name AS name, l.quantity, l.purchase_price,
                l.transaction_id IS NOT NULL AS tied
         FROM fund_bond_lots l JOIN treasury_bonds b ON b.id = l.bond_id
         WHERE l.is_opening ORDER BY b.api_reference_name`,
      )
    ).rows as Array<{
      name: string
      quantity: string
      purchase_price: string
      tied: boolean
    }>
    expect(lots).toHaveLength(2)
    expect(lots.every((l) => l.tied)).toBe(true)
    const ipcaLot = lots.find((l) => l.name === TGT_A)!
    expect(Number(ipcaLot.quantity)).toBe(4)
    expect(Number(ipcaLot.purchase_price)).toBeCloseTo(250, 4)
  })

  it('sementes (amount_brl > 0) NÃO inflam a adimplência do cotista', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const selic = await bondId(SOURCE)

    await supabase.rpc('set_opening_balance', {
      p_admin_id: admin,
      p_date: '2026-01-01',
      p_lots: [{ bond_id: selic, quantity: 10, price: 100 }],
      p_quotas: [{ profile_id: joao, quotas: 1000 }],
      p_quota_price: 1,
    })

    // Sem nenhum APORTE real, total_paid = 0 (a view exclui is_opening).
    const paid = await num(
      'SELECT total_paid v FROM v_cotista_balance WHERE profile_id = $1',
      [joao],
    )
    expect(paid).toBe(0)
  })
})

describe('Reinvestimento multi-destino sobrevive ao rebuild do zero', () => {
  it('recria os N lotes idênticos e mantém PL/cota contínuos', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const src = await bondId(SOURCE)
    const tgtA = await makePurchasable(TGT_A)
    const tgtB = await makePurchasable(TGT_B)
    await seedPriceHistory(SOURCE, [
      ['2026-01-01', 100],
      ['2026-06-01', 100],
    ])

    await supabase.rpc('set_opening_balance', {
      p_admin_id: admin,
      p_date: '2026-01-01',
      p_lots: [{ bond_id: src, quantity: 10, price: 100 }],
      p_quotas: [{ profile_id: joao, quotas: 1000 }],
      p_quota_price: 1,
    })
    // Rotaciona todo o Selic (10 @ R$100 = R$1.000 líquido, preço estável) em
    // dois destinos: 12 @ R$50 (R$600) + 8 @ R$50 (R$400).
    const { error: reErr } = await supabase.rpc('register_reinvestment', {
      p_profile_id: joao,
      p_source_bond_id: src,
      p_source_quantity: 10,
      p_targets: [
        { bond_id: tgtA, quantity: 12, amount_brl: 600 },
        { bond_id: tgtB, quantity: 8, amount_brl: 400 },
      ],
      p_event_date: '2026-06-01',
    })
    expect(reErr).toBeNull()

    const snapshot = async () =>
      (
        await pool.query(
          `SELECT b.api_reference_name AS name, l.quantity, l.purchase_price
           FROM fund_bond_lots l JOIN treasury_bonds b ON b.id = l.bond_id
           WHERE l.is_active ORDER BY b.api_reference_name, l.quantity`,
        )
      ).rows
    const before = await snapshot()
    const plBefore = await num(
      'SELECT total_pl_brl v FROM pl_history ORDER BY date DESC LIMIT 1',
    )

    // Rebuild do zero (TRUNCATE + recria lotes a partir do ledger).
    const { error: rbErr } = await supabase.rpc('rebuild_fund_history', {
      p_admin_id: admin,
    })
    expect(rbErr).toBeNull()

    const after = await snapshot()
    const plAfter = await num(
      'SELECT total_pl_brl v FROM pl_history ORDER BY date DESC LIMIT 1',
    )

    // Origem zerada, dois lotes de destino com qtd/preço preservados.
    expect(after).toHaveLength(2)
    expect(after).toEqual(before)
    const names = after.map((l) => (l as { name: string }).name)
    expect(names).toContain(TGT_A)
    expect(names).toContain(TGT_B)
    expect(plAfter).toBeCloseTo(plBefore, 2)
    expect(plAfter).toBeCloseTo(1000, 2)
  })
})

describe('pap_rebuild_history é determinístico', () => {
  it('rodar 2× produz os mesmos lotes e a mesma curva de PL', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const src = await bondId(SOURCE)
    await seedPriceHistory(SOURCE, [['2026-01-01', 100]])

    await supabase.rpc('set_opening_balance', {
      p_admin_id: admin,
      p_date: '2026-01-01',
      p_lots: [{ bond_id: src, quantity: 10, price: 100 }],
      p_quotas: [{ profile_id: joao, quotas: 1000 }],
      p_quota_price: 1,
    })

    const fingerprint = async () =>
      one<{ lots: string; days: string; pl: string }>(
        `SELECT
           (SELECT COUNT(*) FROM fund_bond_lots) AS lots,
           (SELECT COUNT(*) FROM pl_history) AS days,
           (SELECT COALESCE(SUM(total_pl_brl), 0) FROM pl_history) AS pl`,
      )

    const first = await fingerprint()
    await pool.query('SELECT pap_rebuild_history()')
    const second = await fingerprint()

    expect(second).toEqual(first)
    expect(Number(first.lots)).toBe(1)
  })
})

describe('Caminho de upgrade — dados pré-migração', () => {
  // Simula um REINVESTIMENTO criado ANTES da coluna `targets` (targets NULL +
  // lotes de destino soltos, vinculados por transaction_id) e confirma que o
  // backfill da migração + rebuild recuperam os lotes idênticos. É o cenário de
  // produção que a migração precisa atravessar sem perda.
  it('backfill de targets recupera os destinos de um reinvest sem targets', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const src = await bondId(SOURCE)
    const tgtA = await makePurchasable(TGT_A)
    const tgtB = await makePurchasable(TGT_B)
    await seedPriceHistory(SOURCE, [
      ['2026-01-01', 100],
      ['2026-06-01', 100],
    ])

    // Genesis pelo caminho atual (origem com 10 unid @ R$100).
    await supabase.rpc('set_opening_balance', {
      p_admin_id: admin,
      p_date: '2026-01-01',
      p_lots: [{ bond_id: src, quantity: 10, price: 100 }],
      p_quotas: [{ profile_id: joao, quotas: 1000 }],
      p_quota_price: 1,
    })

    // Reinvestimento "legado": transação SEM targets + lotes de destino soltos.
    const txn = (
      await pool.query<{ id: string }>(
        `INSERT INTO transactions
           (profile_id, type, status, amount_brl, quota_price, quotas_amount,
            source_bond_id, event_date, quantity)
         VALUES ($1, 'REINVESTIMENTO', 'APPROVED', 1000, 1, 0, $2, '2026-06-01', 10)
         RETURNING id`,
        [joao, src],
      )
    ).rows[0].id
    for (const [bond, qty, price] of [
      [tgtA, 12, 50],
      [tgtB, 8, 50],
    ] as Array<[string, number, number]>) {
      await pool.query(
        `INSERT INTO fund_bond_lots
           (transaction_id, bond_id, purchase_date, purchase_price, quantity, is_active)
         VALUES ($1, $2, '2026-06-01', $3, $4, TRUE)`,
        [txn, bond, price, qty],
      )
    }

    // --- Passo 2 da migração: backfill de `targets` a partir dos lotes atuais. ---
    await pool.query(`
      UPDATE transactions t
      SET targets = sub.arr
      FROM (
        SELECT transaction_id,
               jsonb_agg(jsonb_build_object(
                 'bond_id', bond_id,
                 'quantity', COALESCE(original_quantity, quantity),
                 'amount_brl', ROUND(COALESCE(original_quantity, quantity) * purchase_price, 2)
               ) ORDER BY purchase_date, id) AS arr
        FROM fund_bond_lots
        WHERE transaction_id IS NOT NULL
        GROUP BY transaction_id
      ) sub
      WHERE t.id = sub.transaction_id AND t.type = 'REINVESTIMENTO'`)

    const targets = (
      await one<{ targets: unknown[] }>(
        'SELECT targets FROM transactions WHERE id = $1',
        [txn],
      )
    ).targets
    expect(Array.isArray(targets)).toBe(true)
    expect(targets).toHaveLength(2)

    // Rebuild do zero: recria os lotes a partir do ledger já com targets.
    await pool.query('SELECT pap_rebuild_history()')

    const lots = (
      await pool.query(
        `SELECT b.api_reference_name AS name, l.quantity
         FROM fund_bond_lots l JOIN treasury_bonds b ON b.id = l.bond_id
         WHERE l.is_active ORDER BY b.api_reference_name`,
      )
    ).rows as Array<{ name: string; quantity: string }>
    // Origem liquidada; dois destinos recuperados com a quantidade original.
    expect(lots).toHaveLength(2)
    expect(lots.find((l) => l.name === TGT_A)!.quantity).toBe('12.000000')
    expect(lots.find((l) => l.name === TGT_B)!.quantity).toBe('8.000000')
    expect(
      await num('SELECT total_pl_brl v FROM pl_history ORDER BY date DESC LIMIT 1'),
    ).toBeCloseTo(1000, 2)
  })
})
