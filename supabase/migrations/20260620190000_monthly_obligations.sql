-- Geração de obrigações mensais (faturas de aporte) a partir da data de início do
-- fundo até o mês corrente, + correção manual de status pelo admin.
--
-- Contexto: nada criava `monthly_obligations` (a tabela só tinha defaults e o
-- register_aporte apenas dava baixa nas pendentes). Aqui um gerador idempotente,
-- ancorado na data de abertura do fundo (genesis), cria uma fatura por cotista por
-- mês — acionável pelo admin (catch-up até hoje) e por um pg_cron mensal (vai
-- indo pra frente). Os meses retroativos nascem PENDING; o admin reconcilia os que
-- já foram contribuídos via set_obligation_status (toggle PAID/PENDING na UI).

-- ---------------------------------------------------------------------------
-- Idempotência: uma fatura por (cotista, mês). Necessário para o ON CONFLICT.
-- ---------------------------------------------------------------------------
ALTER TABLE monthly_obligations
    ADD CONSTRAINT monthly_obligations_profile_month_key
    UNIQUE (profile_id, reference_month);

-- ---------------------------------------------------------------------------
-- Gerador interno (SEM gate) — reusado pelo wrapper do admin e pelo cron. Cria,
-- para CADA profile e CADA mês entre a abertura do fundo e o mês corrente, uma
-- fatura PENDING de valor p_amount. ON CONFLICT DO NOTHING: meses já existentes
-- (inclusive os corrigidos para PAID) são preservados. Retorna quantas criou.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pap_generate_obligations(p_amount NUMERIC)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_start DATE;
    v_count INTEGER;
BEGIN
    -- Início do fundo = mês do saldo de abertura (genesis).
    SELECT date_trunc('month', MIN(event_date))::date
    INTO v_start
    FROM transactions
    WHERE is_opening;

    IF v_start IS NULL THEN
        RAISE EXCEPTION 'Defina o saldo de abertura antes de gerar obrigações.';
    END IF;

    WITH months AS (
        SELECT generate_series(
            v_start,
            date_trunc('month', CURRENT_DATE)::date,
            INTERVAL '1 month'
        )::date AS ref
    ),
    targets AS (
        SELECT p.id AS profile_id, m.ref
        FROM profiles p
        CROSS JOIN months m
    )
    INSERT INTO monthly_obligations (profile_id, reference_month, amount_expected, status)
    SELECT profile_id, ref, p_amount, 'PENDING'
    FROM targets
    ON CONFLICT (profile_id, reference_month) DO NOTHING;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Wrapper gateado por admin (chamado pela UI). Valor mensal configurável.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_monthly_obligations(
    p_admin_id UUID,
    p_amount NUMERIC DEFAULT 1000
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM pap_require_admin(p_admin_id);
    IF COALESCE(p_amount, 0) <= 0 THEN
        RAISE EXCEPTION 'O valor mensal da obrigação deve ser positivo.';
    END IF;
    RETURN pap_generate_obligations(p_amount);
END;
$$;

GRANT EXECUTE ON FUNCTION generate_monthly_obligations(UUID, NUMERIC) TO authenticated;

-- ---------------------------------------------------------------------------
-- Correção manual de status (admin) — marca uma fatura como paga/pendente. É como
-- o admin reconcilia os meses retroativos que já foram contribuídos.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_obligation_status(
    p_admin_id UUID,
    p_obligation_id UUID,
    p_status obligation_status
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM pap_require_admin(p_admin_id);
    UPDATE monthly_obligations
    SET status = p_status
    WHERE id = p_obligation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Obrigação % não encontrada.', p_obligation_id;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION set_obligation_status(UUID, UUID, obligation_status)
    TO authenticated;

-- ---------------------------------------------------------------------------
-- Cron mensal: no 1º dia de cada mês cria a fatura do mês corrente (e qualquer
-- mês faltante). Carrega o último valor usado, fallback R$1.000. Idempotente por
-- nome; seguro reaplicar/db reset. No-op enquanto não houver saldo de abertura
-- (o gerador levanta exceção, mas o cron só registra no log e não quebra o fundo).
-- ---------------------------------------------------------------------------
SELECT cron.schedule(
    'pap-monthly-obligations',
    '0 6 1 * *',
    $$ SELECT public.pap_generate_obligations(
         COALESCE(
           (SELECT amount_expected FROM public.monthly_obligations
            ORDER BY reference_month DESC, id DESC LIMIT 1),
           1000
         )
       ); $$
);
