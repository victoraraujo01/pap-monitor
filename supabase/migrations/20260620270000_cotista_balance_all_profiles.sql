-- ===========================================================================
-- v_cotista_balance baseada em profiles (REFACTOR_PLAN Item 8)
-- ===========================================================================
-- A view de saldo do cotista era `FROM monthly_obligations`, então só retornava
-- linha para quem JÁ tinha obrigações mensais geradas (o gerador é manual / cron
-- mensal). Consequência: um cotista com RESGATE_PESSOAL mas sem obrigações geradas
-- NÃO aparecia na view — `withdrawn_total`/`repayment_outstanding` ficavam nulos e
-- o card "Resgate a repor" (MyPatrimony) nunca renderizava; o saldo também sumia.
--
-- Correção: ancorar a view em `profiles` (LEFT JOIN obrigações + contribuições +
-- resgates), de modo que TODO cotista tenha linha mesmo sem obrigações. Um cotista
-- sem obrigações fica com total_expected = 0 → balance = −total_paid (crédito), o
-- que é coerente; e o indicador de resgate a repor passa a aparecer sempre.
--
-- Colunas/semântica idênticas à versão anterior (…260000): contribuição mensal =
-- amount_brl − reposition_amount; withdrawn_total = Σ RESGATE_PESSOAL.amount_brl;
-- repayment_outstanding = withdrawn − reposed. Só muda a base do FROM.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_cotista_balance AS
WITH contrib AS (
    SELECT profile_id,
           COALESCE(SUM(amount_brl - reposition_amount), 0) AS total_paid,
           COALESCE(SUM(reposition_amount), 0)              AS reposed_total
    FROM transactions
    WHERE type = 'APORTE' AND status = 'APPROVED' AND NOT is_opening
    GROUP BY profile_id
),
withdrawn AS (
    SELECT profile_id, COALESCE(SUM(amount_brl), 0) AS withdrawn_total
    FROM transactions
    WHERE type = 'RESGATE_PESSOAL' AND status = 'APPROVED'
    GROUP BY profile_id
),
expected AS (
    SELECT profile_id, COALESCE(SUM(amount_expected), 0) AS total_expected
    FROM monthly_obligations
    GROUP BY profile_id
)
SELECT
    p.id                                                       AS profile_id,
    COALESCE(e.total_expected, 0)                              AS total_expected,
    COALESCE(c.total_paid, 0)                                  AS total_paid,
    COALESCE(e.total_expected, 0) - COALESCE(c.total_paid, 0)  AS balance,
    COALESCE(w.withdrawn_total, 0)                             AS withdrawn_total,
    COALESCE(c.reposed_total, 0)                               AS reposed_total,
    COALESCE(w.withdrawn_total, 0) - COALESCE(c.reposed_total, 0)
                                                               AS repayment_outstanding
FROM profiles p
LEFT JOIN expected e  ON e.profile_id = p.id
LEFT JOIN contrib c   ON c.profile_id = p.id
LEFT JOIN withdrawn w ON w.profile_id = p.id;

GRANT SELECT ON v_cotista_balance TO anon, authenticated;
