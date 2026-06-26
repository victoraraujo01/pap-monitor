// Semeia um CENÁRIO DE TESTE no Supabase LOCAL = só o SALDO DE ABERTURA do fundo.
//
// Reproduz exatamente o saldo de abertura capturado no painel admin (data de corte
// 16/01/2026, 6 lotes reais, 2 cotistas) e reconstrói a curva diária de PL/cota a
// partir dele, usando os PREÇOS REAIS do Tesouro (bond_price_history, alimentada por
// `npm run db:backfill`). NÃO cria aportes, saídas nem obrigações mensais — essas o
// dono lança manualmente depois.
//
// Self-contained e idempotente:
//   - garante os dois usuários: Victor (ADMIN) e Ana (COTISTA), senha paplocal123;
//   - zera só os dados operacionais (preserva contas, catálogo e bond_price_history);
//   - grava a abertura via set_opening_balance e roda rebuild_fund_history.
//
// Pré-requisitos: Supabase local de pé (npm run db:start) + preços carregados
// (npm run db:backfill — senão a curva fica chapada por falta de histórico).
// Uso: npm run db:sim   (ou: node scripts/seed-sim.mjs)

import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const PASSWORD = 'paplocal123'

// Os dois cotistas do cenário.
const USERS = [
  { email: 'victor@pap.local', name: 'Victor', role: 'ADMIN' },
  { email: 'ana@pap.local', name: 'Ana', role: 'COTISTA' },
]

// Data de corte (D0) e carteira em D0 — idêntica ao print do painel. A abertura é
// consolidada: cada CONTRIBUIÇÃO (irmão × título) é um lançamento; a cota de cada
// irmão deriva do valor que ele aportou (cota de gênese R$1,00). A partição abaixo
// fecha com as cotas do cenário: Victor = 54.299,65 / Ana = 107.701,84 (≈162.001,49).
const OPENING_DATE = '2026-01-16'
const CONTRIBUTIONS = [
  { name: 'Tesouro Selic 2029', quantity: 0.23, price: 18156.06, owner: 'victor@pap.local' },
  { name: 'Tesouro Selic 2031', quantity: 2.77, price: 18095.22, owner: 'victor@pap.local' },
  { name: 'Tesouro IPCA+ 2026', quantity: 0.01, price: 4332.14, owner: 'ana@pap.local' },
  { name: 'Tesouro Selic 2027', quantity: 2.26, price: 18189.34, owner: 'ana@pap.local' },
  { name: 'Tesouro Selic 2029', quantity: 2.32, price: 18156.06, owner: 'ana@pap.local' },
  { name: 'Tesouro Selic 2031', quantity: 1.35, price: 18095.22, owner: 'ana@pap.local' },
]

function localConfig() {
  const cfg = JSON.parse(
    execSync('npx supabase status -o json', { encoding: 'utf8' }),
  )
  const url = cfg.API_URL ?? cfg.api_url
  const key = cfg.SERVICE_ROLE_KEY ?? cfg.service_role_key
  if (!url || !key)
    throw new Error('API_URL/SERVICE_ROLE_KEY ausentes no status.')
  return { url, key }
}

const { url, key } = localConfig()
const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const pool = new pg.Pool({ connectionString: DB_URL })

const money = (n) => `R$ ${Number(n).toFixed(2)}`

function rpc(fn, args) {
  return supabase.rpc(fn, args).then(({ data, error }) => {
    if (error) throw new Error(`${fn}: ${error.message}`)
    return data
  })
}

// Cria o usuário via Admin API se faltar (idempotente) e GARANTE o profile com nome/
// papel certos — conserta o caso de auth.users existir mas o profile ter sido truncado
// (ex.: após a suíte de testes), que é o que faz o "admin sumir".
async function ensureUser(u) {
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      email: u.email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name: u.name, role: u.role },
    }),
  })
  if (!res.ok && res.status !== 422) {
    const body = await res.json().catch(() => ({}))
    const msg = String(body.msg ?? body.error_description ?? '')
    if (!msg.toLowerCase().includes('already')) {
      throw new Error(`Falha ao criar ${u.email}: ${res.status} ${msg}`)
    }
  }
  const { rows } = await pool.query(
    `INSERT INTO public.profiles (id, name, role)
     SELECT u.id, $2, $3::user_role FROM auth.users u WHERE u.email = $1
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role
     RETURNING id`,
    [u.email, u.name, u.role],
  )
  if (!rows[0]) throw new Error(`Usuário não materializado: ${u.email}`)
  return rows[0].id
}

async function bondId(name) {
  const { rows } = await pool.query(
    'SELECT id FROM treasury_bonds WHERE api_reference_name = $1',
    [name],
  )
  if (!rows[0]) throw new Error(`Título não encontrado no catálogo: ${name}`)
  return rows[0].id
}

async function main() {
  // 1) Usuários (Victor admin + Ana).
  const ids = {}
  for (const u of USERS) ids[u.email] = await ensureUser(u)
  console.log(`Usuários: Victor (ADMIN) + Ana — senha ${PASSWORD}.`)
  const admin = ids['victor@pap.local']

  // 2) Aviso se não houver histórico de preços (a curva ficaria chapada).
  const { rows: pc } = await pool.query(
    'SELECT count(*) AS n FROM bond_price_history',
  )
  if (Number(pc[0].n) === 0) {
    console.warn(
      '⚠  bond_price_history vazio — rode `npm run db:backfill` antes para a curva de PL refletir os preços reais.',
    )
  }

  // 3) Zera só os dados operacionais (preserva contas, catálogo e preços).
  await pool.query(
    'TRUNCATE pl_history, fund_bond_lots, transactions, monthly_obligations CASCADE',
  )

  // 4) Abertura consolidada: 1 contribuição (irmão × título) por lançamento. O
  //    valor (qtd × preço) define o lote E as cotas do dono (cota de gênese R$1,00).
  const contributions = []
  for (const c of CONTRIBUTIONS) {
    contributions.push({
      profile_id: ids[c.owner],
      bond_id: await bondId(c.name),
      quantity: c.quantity,
      amount: c.quantity * c.price,
    })
  }
  const plLots = CONTRIBUTIONS.reduce((s, c) => s + c.quantity * c.price, 0)
  const perOwner = {}
  for (const c of CONTRIBUTIONS) {
    perOwner[c.owner] = (perOwner[c.owner] ?? 0) + c.quantity * c.price
  }
  const totalQuotas = plLots // cota de gênese = R$1,00 → cotas = valor

  await rpc('set_opening_balance', {
    p_admin_id: admin,
    p_date: OPENING_DATE,
    p_contributions: contributions,
    p_quota_price: 1,
  })
  console.log(
    `Abertura ${OPENING_DATE}: ${contributions.length} contribuições · PL ${money(plLots)} · ${totalQuotas.toFixed(4)} cotas.`,
  )
  for (const u of USERS) {
    const part = ((perOwner[u.email] ?? 0) / totalQuotas) * 100
    console.log(
      `  ${u.name}: ${(perOwner[u.email] ?? 0).toFixed(4)} cotas (${part.toFixed(1)}%)`,
    )
  }

  // 6) Replay cronológico → curva diária de PL/cota até hoje (preços reais).
  await rpc('rebuild_fund_history', { p_admin_id: admin })

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
    `PL atual ${money(last[0].total_pl_brl)} · cota ${Number(last[0].quota_price).toFixed(6)} · ${Number(last[0].total_quotas).toFixed(4)} cotas.`,
  )
  console.log(
    '\nLogin: victor@pap.local (admin) / ana@pap.local — senha paplocal123',
  )
  console.log(
    'Obrigações mensais: gere você mesmo na tela Admin quando quiser.',
  )
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('Falha na simulação:', err.message ?? err)
    await pool.end()
    process.exit(1)
  })
