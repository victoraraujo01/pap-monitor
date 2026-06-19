-- Agendamento do CdU 1 (fechamento diário) via pg_cron + pg_net.
-- O cálculo precisa buscar preços por HTTP (só a Edge Function faz isso), então
-- o cron não chama recalculate_pl direto: ele dispara a Edge Function `daily-pl`,
-- que faz fetch → UPSERT current_price → recalculate_pl.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------------------------------------------------------------------------
-- UPSERT de preços do catálogo a partir da Edge Function (CdU 1, passo 2).
-- A função recebe um objeto JSON {chave: preço} (chave = api_reference_name OU
-- symbol da brapi) e atualiza current_price dos títulos que casam. Encapsula a
-- escrita em RPC (SECURITY DEFINER) porque o service_role NÃO tem GRANT direto
-- nas tabelas no Supabase local — mesmo motivo das demais RPCs do projeto.
-- Retorna quantos títulos foram atualizados.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_bond_prices(p_prices JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    WITH incoming AS (
        SELECT key AS api_reference_name, value::NUMERIC AS price
        FROM jsonb_each_text(p_prices)
        WHERE value ~ '^[0-9]+(\.[0-9]+)?$'
    )
    UPDATE treasury_bonds b
    SET current_price = i.price
    FROM incoming i
    WHERE b.api_reference_name = i.api_reference_name;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION update_bond_prices(JSONB) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Configuração por ambiente (NÃO versionar segredos). Guarda a URL pública da
-- Edge Function e o segredo compartilhado (PAP_CRON_SECRET). Tabela trancada:
-- NÃO recebe GRANT para anon/authenticated (contém segredo) — diferente das
-- tabelas operacionais lidas pelos dashboards.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
REVOKE ALL ON app_config FROM anon, authenticated;

COMMENT ON TABLE app_config IS
    'Config por ambiente do job diário. Em produção, popular:
     INSERT INTO app_config(key,value) VALUES
       (''daily_pl_function_url'', ''https://<ref>.supabase.co/functions/v1/daily-pl''),
       (''daily_pl_cron_secret'', ''<mesmo valor de PAP_CRON_SECRET da função>'')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;';

-- ---------------------------------------------------------------------------
-- Dispara a Edge Function `daily-pl` via HTTP (pg_net). No-op silencioso quando
-- a URL não está configurada (ex.: ambiente local) — assim o db reset não falha
-- e o cron simplesmente não faz nada até alguém popular app_config.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pap_run_daily_pl()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_url    TEXT;
    v_secret TEXT;
BEGIN
    SELECT value INTO v_url FROM app_config WHERE key = 'daily_pl_function_url';
    IF v_url IS NULL OR v_url = '' THEN
        RAISE NOTICE 'pap_run_daily_pl: daily_pl_function_url não configurada; pulando.';
        RETURN;
    END IF;

    SELECT value INTO v_secret FROM app_config WHERE key = 'daily_pl_cron_secret';

    PERFORM net.http_post(
        url     := v_url,
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-pap-cron-secret', COALESCE(v_secret, '')
        ),
        body    := '{}'::jsonb
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- Agendamento: dias úteis às 21:00 UTC (~18:00 BRT, após o fechamento). pg_cron
-- usa o fuso do servidor (UTC na Supabase). Agendar por nome é idempotente
-- (recria se já existir), então é seguro reaplicar/db reset.
-- ---------------------------------------------------------------------------
SELECT cron.schedule(
    'pap-daily-pl',
    '0 21 * * 1-5',
    $$ SELECT public.pap_run_daily_pl(); $$
);
