// Edge Function do CdU 1 — fechamento diário de preços e PL.
//
// Fluxo (docs/04, Caso de Uso 1):
//   1. Baixa o CSV de Preços e Taxas do Tesouro Transparente (oficial, gratuito,
//      sem token). Pega a Data Base mais recente de cada título (Selic/IPCA+).
//   2. UPSERT de `current_price` no catálogo via RPC `update_bond_prices`
//      (escrita encapsulada em RPC; o service_role não tem GRANT direto nas
//      tabelas — mesma razão das demais RPCs do projeto). Só casa títulos já
//      existentes (catálogo é governado pelo Admin; nada é criado).
//   3. Chama `recalculate_pl()` (IR regressivo + consolidação do PL + gravação
//      da cota do dia em `pl_history`).
//
// Acionada pelo `pg_cron` via `pg_net` (ver migração ..._daily_pl_schedule.sql).
// `verify_jwt = false` no config.toml: a proteção é um segredo compartilhado
// (PAP_CRON_SECRET) conferido abaixo quando configurado.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  DEFAULT_TESOURO_API_URL,
  parseTesouroHistory,
  parseTesouroTransparente,
} from './prices.ts'

// CORS: os modos `backfill` e `catalog` são acionados pelo NAVEGADOR do admin
// (supabase.functions.invoke), que dispara um preflight OPTIONS por causa do
// header Authorization. Sem estes headers o preflight falha com "Failed to send a
// request to the Edge Function". O modo `daily` (cron, server-to-server) não usa
// CORS, mas devolvê-lo é inofensivo.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-pap-cron-secret',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

// Modo backfill (Fase 2): carrega TODO o histórico de preços do CSV em
// bond_price_history (em lotes), para o replay (rebuild_fund_history) poder
// reconstruir a curva. Acionado manualmente por um admin com ?mode=backfill.
async function runBackfill(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  csv: string,
): Promise<Response> {
  const rows = parseTesouroHistory(csv)
  if (rows.length === 0) {
    return json({ error: 'CSV do Tesouro sem linhas de histórico utilizáveis.' }, 502)
  }

  const CHUNK = 5000
  let upserted = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    // Remapeia buyPrice (camelCase do parser) → buy_price (chave que a RPC lê).
    const batch = rows.slice(i, i + CHUNK).map((r) => ({
      name: r.name,
      date: r.date,
      price: r.price,
      buy_price: r.buyPrice,
    }))
    const { data, error } = await supabase.rpc('update_bond_price_history', {
      p_rows: batch,
    })
    if (error) {
      return json({ error: `Erro no update_bond_price_history: ${error.message}` }, 500)
    }
    upserted += data ?? 0
  }

  return json({
    ok: true,
    mode: 'backfill',
    rows_parsed: rows.length,
    rows_upserted: upserted,
    finished_at: new Date().toISOString(),
  })
}

// Modo catalog: lista os títulos Selic/IPCA+ presentes no CSV do Tesouro que
// AINDA NÃO estão no catálogo (treasury_bonds), para a UI do admin oferecer um
// dropdown de cadastro sem risco de errar o api_reference_name (que precisa casar
// exatamente com o nome derivado pelo parser). Read-only: não escreve nada nem
// recalcula PL — por isso é isento do segredo do cron (ver Deno.serve abaixo).
async function runCatalog(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  csv: string,
): Promise<Response> {
  const priceMap = parseTesouroTransparente(csv)
  if (priceMap.size === 0) {
    return json({ error: 'CSV do Tesouro não retornou preços utilizáveis.' }, 502)
  }

  const { data: existing, error } = await supabase
    .from('treasury_bonds')
    .select('api_reference_name')
  if (error) {
    return json({ error: `Erro ao ler o catálogo: ${error.message}` }, 500)
  }

  const known = new Set(
    (existing ?? []).map((b: { api_reference_name: string }) => b.api_reference_name),
  )
  const candidates = [...priceMap.entries()]
    .filter(([name]) => !known.has(name))
    .map(([name, price]) => ({ api_reference_name: name, current_price: price }))
    .sort((a, b) => a.api_reference_name.localeCompare(b.api_reference_name))

  return json({ ok: true, mode: 'catalog', candidates })
}

Deno.serve(async (req) => {
  // Preflight CORS do navegador (modos backfill/catalog acionados pelo admin).
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return json({ error: 'Método não permitido.' }, 405)
  }

  const mode =
    new URL(req.url).searchParams.get('mode') ?? 'daily' // 'daily' | 'backfill' | 'catalog'

  // Proteção por segredo compartilhado (só aplica se PAP_CRON_SECRET estiver
  // setado). Apenas o modo 'daily' (fechamento agendado pelo cron, que recalcula o
  // PL) é protegido. Os modos 'backfill' (carrega preços de referência) e 'catalog'
  // (lista títulos do CSV) são acionados pelo NAVEGADOR do admin — que não pode
  // portar o segredo — e ficam atrás da UI gateada por ADMIN.
  const cronSecret = Deno.env.get('PAP_CRON_SECRET')
  if (cronSecret && mode === 'daily') {
    const provided =
      req.headers.get('x-pap-cron-secret') ??
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (provided !== cronSecret) {
      return json({ error: 'Não autorizado.' }, 401)
    }
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return json(
      { error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes no ambiente.' },
      500,
    )
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // 1. Baixa o CSV do Tesouro Transparente (uma vez, serve aos três modos).
  const apiUrl = Deno.env.get('TESOURO_API_URL') ?? DEFAULT_TESOURO_API_URL
  let csv: string
  try {
    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'pap-monitor/daily-pl', Accept: 'text/csv' },
    })
    if (!res.ok) {
      return json(
        { error: `Falha ao buscar preços (HTTP ${res.status}).` },
        502,
      )
    }
    csv = await res.text()
  } catch (err) {
    return json(
      { error: `Erro de rede ao buscar preços: ${(err as Error).message}` },
      502,
    )
  }

  if (mode === 'backfill') {
    return await runBackfill(supabase, csv)
  }

  if (mode === 'catalog') {
    return await runCatalog(supabase, csv)
  }

  const priceMap = parseTesouroTransparente(csv)
  if (priceMap.size === 0) {
    return json(
      { error: 'CSV do Tesouro não retornou preços utilizáveis.' },
      502,
    )
  }

  // 2. UPSERT de current_price via RPC (só casa títulos existentes no catálogo).
  const prices = Object.fromEntries(priceMap)
  const { data: updated, error: updErr } = await supabase.rpc(
    'update_bond_prices',
    { p_prices: prices },
  )
  if (updErr) {
    return json({ error: `Erro no update_bond_prices: ${updErr.message}` }, 500)
  }

  // 3. Recalcula o PL e grava a cota do dia.
  const { error: rpcErr } = await supabase.rpc('recalculate_pl')
  if (rpcErr) {
    return json({ error: `Erro no recalculate_pl: ${rpcErr.message}` }, 500)
  }

  return json({
    ok: true,
    prices_fetched: priceMap.size,
    bonds_updated: updated ?? 0,
    recalculated_at: new Date().toISOString(),
  })
})
