// Semeia um HISTÓRICO DE SIMULAÇÃO no Supabase LOCAL para testes manuais.
//
// Monta um cenário completo do fundo PAP ao longo de ~1,5 ano:
//   - saldo de abertura (carteira em D0 + cotas por irmão);
//   - série de preços históricos (bond_price_history) com valorização mensal;
//   - aportes mensais de Ana e Bruno;
//   - um resgate pessoal e uma despesa dos pais (proposta + aprovada);
//   - rebuild do histórico → curva diária de PL/cota.
//
// Idempotente: zera os dados operacionais (preserva contas e catálogo) e remonta.
//
// Pré-requisitos: Supabase local de pé + cotistas semeados (npm run db:seed).
// Uso: node scripts/seed-sim.mjs

import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

function localConfig() {
  const cfg = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8' }))
  const url = cfg.API_URL ?? cfg.api_url
  const key = cfg.SERVICE_ROLE_KEY ?? cfg.service_role_key
  if (!url || !key) throw new Error('API_URL/SERVICE_ROLE_KEY ausentes no status.')
  return { url, key }
}

const { url, key } = localConfig()
const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const pool = new pg.Pool({ connectionString: DB_URL })

const money = (n) => `R$ ${n.toFixed(2)}`

async function profileId(email) {
  const { rows } = await pool.query(
    'SELECT p.id FROM profiles p JOIN auth.users u ON u.id = p.id WHERE u.email = $1',
    [email],
  )
  if (!rows[0]) throw new Error(`Perfil não encontrado: ${email} (rode npm run db:seed)`)
  return rows[0].id
}

async function bondId(name) {
  const { rows } = await pool.query(
    'SELECT id FROM treasury_bonds WHERE api_reference_name = $1',
    [name],
  )
  if (!rows[0]) throw new Error(`Título não encontrado: ${name}`)
  return rows[0].id
}

function rpc(fn, args) {
  return supabase.rpc(fn, args).then(({ data, error }) => {
    if (error) throw new Error(`${fn}: ${error.message}`)
    return data
  })
}

// Meses de 2025-01 a 2026-06 (1º dia de cada mês), como 'YYYY-MM-01'.
function months() {
  const out = []
  for (let y = 2025; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === 2026 && m > 6) break
      out.push(`${y}-${String(m).padStart(2, '0')}-01`)
    }
  }
  return out
}

// Preço de um título num mês: base com valorização composta mensal.
function priceSeries(base, monthlyRate) {
  const map = new Map()
  months().forEach((d, i) => map.set(d, +(base * (1 + monthlyRate) ** i).toFixed(6)))
  return map
}

async function main() {
  const admin = await profileId('admin@pap.local')
  const ana = await profileId('ana@pap.local')
  const bruno = await profileId('bruno@pap.local')
  const selic = await bondId('Tesouro Selic 2027')
  const ipca29 = await bondId('Tesouro IPCA+ 2029')

  // Séries de preço (valorização mensal suave).
  const pSelic = priceSeries(18000, 0.009) // ~+0,9%/mês
  const pIpca = priceSeries(3500, 0.011) // ~+1,1%/mês
  const priceOn = (bond, month) =>
    bond === selic ? pSelic.get(month) : pIpca.get(month)

  // 1) Limpa dados operacionais (preserva contas e catálogo). TRUNCATE por causa
  //    do safeupdate local; CASCADE para os FKs entre lotes/transações.
  await pool.query(
    'TRUNCATE pl_history, bond_price_history, fund_bond_lots, transactions, monthly_obligations CASCADE',
  )

  // 2) Preços históricos (carry-forward entre os pontos mensais).
  for (const [bond, series] of [
    [selic, pSelic],
    [ipca29, pIpca],
  ]) {
    for (const [date, price] of series) {
      await pool.query(
        'INSERT INTO bond_price_history (bond_id, date, price) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [bond, date, price],
      )
    }
  }
  // current_price = último preço da série (composição da carteira no painel).
  for (const [bond, series] of [
    [selic, pSelic],
    [ipca29, pIpca],
  ]) {
    const last = [...series.values()].at(-1)
    await pool.query('UPDATE treasury_bonds SET current_price = $2 WHERE id = $1', [
      bond,
      last,
    ])
  }

  // 3) Saldo de abertura em 2025-01-02 (preço de D0 = ponto de janeiro).
  const open = '2025-01-02'
  const lots = [
    { bond_id: selic, quantity: 0.5, price: pSelic.get('2025-01-01') },
    { bond_id: ipca29, quantity: 2, price: pIpca.get('2025-01-01') },
  ]
  const openPL =
    0.5 * pSelic.get('2025-01-01') + 2 * pIpca.get('2025-01-01')
  // Cotas de abertura = PL (cota inicial R$1,00). Ana 60% / Bruno 40%.
  await rpc('set_opening_balance', {
    p_admin_id: admin,
    p_date: open,
    p_lots: lots,
    p_quotas: [
      { profile_id: ana, quotas: openPL * 0.6, amount: openPL * 0.6 },
      { profile_id: bruno, quotas: openPL * 0.4, amount: openPL * 0.4 },
    ],
  })
  console.log(`Abertura ${open}: PL ${money(openPL)} (Ana 60% / Bruno 40%).`)

  // 4) Meses em que Ana/Bruno aportam (obrigações geradas no passo 9).
  const aporteMonths = months().filter(
    (d) => d >= '2025-02-01' && d <= '2025-11-01',
  )

  // 5) Aportes mensais de R$1000 (Ana compra Selic; Bruno alterna Selic/IPCA).
  let nAportes = 0
  for (const d of aporteMonths) {
    const ev = d.slice(0, 8) + '05' // dia 05 do mês
    // Ana → Selic
    {
      const price = priceOn(selic, d)
      await rpc('register_aporte', {
        p_profile_id: ana,
        p_bond_id: selic,
        p_quantity: +(1000 / price).toFixed(6),
        p_amount_brl: 1000,
        p_event_date: ev,
      })
      nAportes++
    }
    // Bruno → IPCA nos meses pares, Selic nos ímpares
    {
      const bond = Number(d.slice(5, 7)) % 2 === 0 ? ipca29 : selic
      const price = priceOn(bond, d)
      await rpc('register_aporte', {
        p_profile_id: bruno,
        p_bond_id: bond,
        p_quantity: +(1000 / price).toFixed(6),
        p_amount_brl: 1000,
        p_event_date: ev,
      })
      nAportes++
    }
  }
  console.log(`${nAportes} aportes mensais lançados (Ana/Bruno).`)

  // 6) Resgate pessoal da Ana (out/2025): vende 0,02 de Selic.
  {
    const d = '2025-10-12'
    const price = priceOn(selic, '2025-10-01')
    const qty = 0.02
    await rpc('request_withdrawal', {
      p_profile_id: ana,
      p_bond_id: selic,
      p_quantity: qty,
      p_amount_brl: +(qty * price).toFixed(2),
      p_type: 'RESGATE_PESSOAL',
      p_event_date: d,
    })
    console.log(`Resgate pessoal da Ana em ${d}: ${money(qty * price)}.`)
  }

  // 7) Despesa dos pais (nov/2025): Bruno propõe, Ana classifica como despesa.
  {
    const d = '2025-11-20'
    const price = priceOn(ipca29, '2025-11-01')
    const qty = 0.5
    const desp = await rpc('request_withdrawal', {
      p_profile_id: bruno,
      p_bond_id: ipca29,
      p_quantity: qty,
      p_amount_brl: +(qty * price).toFixed(2),
      p_type: 'DESPESA_PAIS',
      p_event_date: d,
    })
    await rpc('approve_expense', { p_transaction_id: desp, p_approver_id: ana })
    console.log(`Despesa dos pais em ${d} (${money(qty * price)}) aprovada.`)
  }

  // 8) Replay cronológico → curva diária de PL/cota até hoje.
  await rpc('rebuild_fund_history', { p_admin_id: admin })

  // 9) Obrigações mensais (R$1000) da abertura até hoje — todas PENDING — e
  //    reconciliação: marca PAID os meses que Ana/Bruno de fato aportaram. Sobram
  //    meses pendentes (admin nunca aporta; meses sem aporte) → adimplência real.
  const created = await rpc('generate_monthly_obligations', {
    p_admin_id: admin,
    p_amount: 1000,
  })
  const paidMonths = aporteMonths.map((d) => d.slice(0, 7))
  await pool.query(
    `UPDATE monthly_obligations SET status = 'PAID'
     WHERE profile_id = ANY($1) AND to_char(reference_month, 'YYYY-MM') = ANY($2)`,
    [[ana, bruno], paidMonths],
  )
  const { rows: ob } = await pool.query(
    "SELECT count(*) FILTER (WHERE status='PENDING') AS pend, count(*) AS tot FROM monthly_obligations",
  )
  console.log(
    `Obrigações: ${created} criadas · ${ob[0].pend}/${ob[0].tot} pendentes após reconciliar.`,
  )

  const { rows: snap } = await pool.query(
    'SELECT count(*) AS dias, max(date) AS ultimo FROM pl_history',
  )
  const { rows: last } = await pool.query(
    'SELECT total_pl_brl, quota_price, total_quotas FROM pl_history ORDER BY date DESC LIMIT 1',
  )
  console.log(
    `\nHistórico reconstruído: ${snap[0].dias} dias (até ${snap[0].ultimo?.toISOString?.().slice(0, 10) ?? snap[0].ultimo}).`,
  )
  console.log(
    `PL atual ${money(Number(last[0].total_pl_brl))} · cota ${Number(
      last[0].quota_price,
    ).toFixed(6)} · ${Number(last[0].total_quotas).toFixed(2)} cotas.`,
  )
  console.log('\nLogin: ana@pap.local / bruno@pap.local / admin@pap.local — senha paplocal123')
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('Falha na simulação:', err.message ?? err)
    await pool.end()
    process.exit(1)
  })
