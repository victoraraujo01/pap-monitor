-- ===========================================================================
-- Política de dívida de resgate: toggle NOMINAL ⇄ PARTICIPACAO (via admin)
-- ===========================================================================
-- A dívida de "resgate a repor" pode ser lida de dois jeitos a partir do MESMO
-- ledger (nenhum dado novo é guardado):
--   • NOMINAL       — em reais: Σ amount_brl(resgate) − Σ reposition_amount.
--   • PARTICIPACAO   — em cotas: Σ(−quotas_amount)(resgate) − Σ(reposition/cota).
-- Como as duas leituras saem das mesmas colunas (quotas_amount/amount_brl/
-- reposition_amount, todas recompostas pelo pap_rebuild_history), TROCAR O MODO É
-- PURA APRESENTAÇÃO: não altera dado, NÃO dispara rebuild e é 100% reversível.
--
-- Por isso a view abaixo expõe AS DUAS leituras sempre (colunas nominais mantidas
-- + colunas _cotas novas); o modo escolhido vive em fund_settings e é consumido só
-- pelo FRONT (qual leitura exibir). O backend/testes leem a coluna que quiserem.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- fund_settings: configuração global do fundo (linha única). Legível pelo front
-- (ao contrário de app_config, que guarda segredos do cron e fica trancada).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fund_settings (
    id         INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    debt_mode  TEXT NOT NULL DEFAULT 'NOMINAL'
               CHECK (debt_mode IN ('NOMINAL', 'PARTICIPACAO')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO fund_settings (id, debt_mode)
VALUES (1, 'NOMINAL')
ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON fund_settings TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- set_debt_mode: troca a política (gate admin). Espelha set_obligation_status.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_debt_mode(p_admin_id UUID, p_mode TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM pap_require_admin(p_admin_id);

    IF p_mode NOT IN ('NOMINAL', 'PARTICIPACAO') THEN
        RAISE EXCEPTION 'Modo de dívida inválido: % (use NOMINAL ou PARTICIPACAO).',
            p_mode;
    END IF;

    UPDATE fund_settings
    SET debt_mode = p_mode, updated_at = now()
    WHERE id = 1;
END;
$$;

GRANT EXECUTE ON FUNCTION set_debt_mode(UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- v_cotista_balance: expõe as DUAS leituras da dívida de resgate.
-- Base = versão …270000 (ancorada em profiles). Colunas nominais mantidas como
-- estavam (zero quebra); adiciona *_cotas. Semântica:
--   withdrawn_total_cotas       = Σ(−quotas_amount) dos RESGATE_PESSOAL (cotas
--                                 queimadas, pela cota histórica do dia do resgate)
--   reposed_total_cotas         = Σ(reposition_amount / quota_price) dos APORTE
--                                 (cotas recompostas pela cota do dia do aporte)
--   repayment_outstanding_cotas = withdrawn_cotas − reposed_cotas
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_cotista_balance AS
WITH contrib AS (
    SELECT profile_id,
           COALESCE(SUM(amount_brl - reposition_amount), 0) AS total_paid,
           COALESCE(SUM(reposition_amount), 0)              AS reposed_total,
           COALESCE(SUM(reposition_amount / NULLIF(quota_price, 0)), 0)
                                                            AS reposed_total_cotas
    FROM transactions
    WHERE type = 'APORTE' AND status = 'APPROVED' AND NOT is_opening
    GROUP BY profile_id
),
withdrawn AS (
    SELECT profile_id,
           COALESCE(SUM(amount_brl), 0)     AS withdrawn_total,
           COALESCE(SUM(-quotas_amount), 0) AS withdrawn_total_cotas
    FROM transactions
    WHERE type = 'RESGATE_PESSOAL' AND status = 'APPROVED'
    GROUP BY profile_id
),
expected AS (
    -- Esperado exclui meses dismissed e meses com override=PAID (migração …300000).
    SELECT profile_id, COALESCE(SUM(amount_expected), 0) AS total_expected
    FROM monthly_obligations
    WHERE NOT is_dismissed
      AND status_override IS DISTINCT FROM 'PAID'::obligation_status
    GROUP BY profile_id
)
SELECT
    p.id                                                       AS profile_id,
    COALESCE(e.total_expected, 0)                              AS total_expected,
    COALESCE(c.total_paid, 0)                                  AS total_paid,
    COALESCE(e.total_expected, 0) - COALESCE(c.total_paid, 0)  AS balance,
    -- Leitura NOMINAL (R$) — mantida
    COALESCE(w.withdrawn_total, 0)                             AS withdrawn_total,
    COALESCE(c.reposed_total, 0)                               AS reposed_total,
    COALESCE(w.withdrawn_total, 0) - COALESCE(c.reposed_total, 0)
                                                               AS repayment_outstanding,
    -- Leitura PARTICIPACAO (cotas) — nova
    COALESCE(w.withdrawn_total_cotas, 0)                       AS withdrawn_total_cotas,
    COALESCE(c.reposed_total_cotas, 0)                         AS reposed_total_cotas,
    COALESCE(w.withdrawn_total_cotas, 0) - COALESCE(c.reposed_total_cotas, 0)
                                                               AS repayment_outstanding_cotas
FROM profiles p
LEFT JOIN expected e  ON e.profile_id = p.id
LEFT JOIN contrib c   ON c.profile_id = p.id
LEFT JOIN withdrawn w ON w.profile_id = p.id;

GRANT SELECT ON v_cotista_balance TO anon, authenticated;
