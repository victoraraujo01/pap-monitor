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
import { DEFAULT_TESOURO_API_URL, parseTesouroTransparente } from './prices.ts'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json({ error: 'Método não permitido.' }, 405)
  }

  // Proteção por segredo compartilhado (só aplica se PAP_CRON_SECRET estiver setado).
  const cronSecret = Deno.env.get('PAP_CRON_SECRET')
  if (cronSecret) {
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

  // 1. Baixa o CSV do Tesouro Transparente e fica com o preço mais recente.
  const apiUrl = Deno.env.get('TESOURO_API_URL') ?? DEFAULT_TESOURO_API_URL
  let priceMap: Map<string, number>
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
    priceMap = parseTesouroTransparente(await res.text())
  } catch (err) {
    return json(
      { error: `Erro de rede ao buscar preços: ${(err as Error).message}` },
      502,
    )
  }
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
