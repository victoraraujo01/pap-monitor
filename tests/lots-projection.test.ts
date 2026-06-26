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
  it('cria lotes e minta cotas a partir das contribuições de abertura', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const selic = await bondId(SOURCE)
    const ipca = await makePurchasable(TGT_A)

    const { error } = await supabase.rpc('set_opening_balance', {
      p_admin_id: admin,
      p_date: '2026-01-01',
      p_contributions: [
        { profile_id: joao, bond_id: selic, quantity: 10, amount: 1000 },
        { profile_id: joao, bond_id: ipca, quantity: 4, amount: 1000 },
      ],
      p_quota_price: 1,
    })
    expect(error).toBeNull()

    // Cada contribuição virou uma transação is_opening com título + dono, e as
    // cotas derivam do valor (1000 + 1000 = 2000 cotas a cota R$1,00).
    const opening = (
      await pool.query(
        `SELECT target_bond_id, profile_id, quotas_amount
         FROM transactions WHERE is_opening`,
      )
    ).rows as Array<{
      target_bond_id: string | null
      profile_id: string | null
      quotas_amount: string
    }>
    expect(opening).toHaveLength(2)
    expect(
      opening.every((t) => t.target_bond_id && t.profile_id === joao),
    ).toBe(true)
    expect(
      opening.reduce((s, t) => s + Number(t.quotas_amount), 0),
    ).toBeCloseTo(2000, 6)

    // Os lotes de abertura vieram do replay (transaction_id NÃO nulo) e refletem
    // qtd/preço informados.
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

  it('abertura (is_opening) NÃO infla a adimplência do cotista', async () => {
    const admin = await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const selic = await bondId(SOURCE)

    await supabase.rpc('set_opening_balance', {
      p_admin_id: admin,
      p_date: '2026-01-01',
      p_contributions: [
        { profile_id: joao, bond_id: selic, quantity: 10, amount: 1000 },
      ],
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
      p_contributions: [
        { profile_id: joao, bond_id: src, quantity: 10, amount: 1000 },
      ],
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
      p_contributions: [
        { profile_id: joao, bond_id: src, quantity: 10, amount: 1000 },
      ],
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
      p_contributions: [
        { profile_id: joao, bond_id: src, quantity: 10, amount: 1000 },
      ],
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

describe('Abertura: retrocompat do split + migração para consolidado', () => {
  // Reproduz o estado PRÉ-migração (modelo …350000): sementes de carteira (profile
  // NULL, cota 0) + participações por irmão (sem título). Valida (A) que o rebuild
  // não conta dobrado e (B) que o passo de dados em produção (atribuir o dono de
  // cada título + remover as participações) consolida sem mudar as cotas.
  it('split antigo não dobra cotas; atribuir dono + remover participações consolida', async () => {
    await createUser('Admin', 'ADMIN')
    const joao = await createUser('Joao')
    const maria = await createUser('Maria')
    const src = await bondId(SOURCE)
    const tgt = await bondId(TGT_A)

    // João aportou o Selic (6 un, R$600), Maria o IPCA+ (4 un, R$400); cota R$1,00.
    const insOpening = (
      profileId: string | null,
      bond: string | null,
      qty: number | null,
      amount: number,
      quotas: number,
    ) =>
      pool.query(
        `INSERT INTO transactions
           (profile_id, type, status, amount_brl, quota_price, quotas_amount,
            target_bond_id, event_date, quantity, is_opening)
         VALUES ($1,'APORTE','APPROVED',$2,1,$3,$4,'2026-01-01',$5,TRUE)`,
        [profileId, amount, quotas, bond, qty],
      )
    await insOpening(null, src, 6, 600, 0) // semente de carteira (Selic)
    await insOpening(null, tgt, 4, 400, 0) // semente de carteira (IPCA+)
    await insOpening(joao, null, null, 600, 600) // participação João
    await insOpening(maria, null, null, 400, 400) // participação Maria

    const cotasByOwner = async () =>
      Object.fromEntries(
        (
          await pool.query(
            `SELECT profile_id, ROUND(SUM(quotas_amount), 6) AS q
             FROM transactions WHERE status='APPROVED' AND profile_id IS NOT NULL
             GROUP BY profile_id`,
          )
        ).rows.map((r) => [r.profile_id, Number(r.q)]),
      )
    const totalQuotas = () =>
      num('SELECT total_quotas v FROM pl_history ORDER BY date DESC LIMIT 1')

    // (A) Retrocompat: sementes sem dono = lastro de 0 cota; participações dão as cotas.
    await pool.query('SELECT pap_rebuild_history()')
    const before = await cotasByOwner()
    expect(before[joao]).toBeCloseTo(600, 6)
    expect(before[maria]).toBeCloseTo(400, 6)
    expect(await totalQuotas()).toBeCloseTo(1000, 6)

    // (B) Migração de dados: atribui o dono de cada título + remove as participações.
    await pool.query(
      'UPDATE transactions SET profile_id=$1 WHERE is_opening AND target_bond_id=$2',
      [joao, src],
    )
    await pool.query(
      'UPDATE transactions SET profile_id=$1 WHERE is_opening AND target_bond_id=$2',
      [maria, tgt],
    )
    await pool.query(
      'DELETE FROM transactions WHERE is_opening AND target_bond_id IS NULL',
    )
    await pool.query('SELECT pap_rebuild_history()')

    // Cotas por irmão idênticas e total preservado; só as 2 linhas consolidadas restam.
    const after = await cotasByOwner()
    expect(after[joao]).toBeCloseTo(600, 6)
    expect(after[maria]).toBeCloseTo(400, 6)
    expect(await totalQuotas()).toBeCloseTo(1000, 6)
    expect(
      await num('SELECT COUNT(*) v FROM transactions WHERE is_opening'),
    ).toBe(2)
  })
})
