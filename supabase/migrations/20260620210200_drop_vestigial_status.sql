-- Limpeza: remove a coluna vestigial monthly_obligations.status.
--
-- Desde a migração de adimplência por saldo acumulado (20260620200000) o status
-- efetivo de cada obrigação é DERIVADO na view v_monthly_obligations
-- (COALESCE(status_override, regra FIFO-90%)). A coluna `status` da tabela não é mais
-- lida por ninguém (app nem views) e só continuava sendo escrita por
-- pap_generate_obligations. Reescrevemos o gerador sem ela e dropamos a coluna para
-- não deixar um campo morto induzindo a erro.

-- Gerador sem a coluna `status` (resto idêntico: idempotente, ancorado na abertura).
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
    INSERT INTO monthly_obligations (profile_id, reference_month, amount_expected)
    SELECT profile_id, ref, p_amount
    FROM targets
    ON CONFLICT (profile_id, reference_month) DO NOTHING;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

ALTER TABLE monthly_obligations DROP COLUMN IF EXISTS status;
