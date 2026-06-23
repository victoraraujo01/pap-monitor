-- Obrigações: (1) override do admin passa a zerar a dívida do mês no saldo total,
-- (2) remoção PERMANENTE de uma obrigação (não recriada pelo gerador).
--
-- Contexto / bugs corrigidos:
--   1. O override (status_override) era respeitado SÓ no status mensal
--      (v_monthly_obligations, via COALESCE), mas o SALDO TOTAL
--      (v_cotista_balance.balance = Σ esperado − Σ aportado) o ignorava. Resultado:
--      marcar um mês como PAGO no admin (caso fora do sistema, ex. pago em dinheiro
--      sem APORTE) tirava o mês da lista de pendentes, mas o saldo continuava
--      devedor — o MyPatrimony seguia mostrando "saldo devedor". Decisão: override
--      PAGO = mês liquidado fora do sistema ⇒ sai do esperado (some da dívida e da
--      acumulação FIFO); override PENDENTE = conta normalmente.
--   2. Não havia como REMOVER uma obrigação, só marcá-la paga/auto. Hard-delete não
--      serve: o gerador (pap_generate_obligations / cron mensal) recriaria o mês
--      (INSERT … ON CONFLICT DO NOTHING preenche meses faltantes da abertura até
--      hoje). Solução: soft-delete (is_dismissed) — a linha continua ocupando o slot
--      único (profile_id, reference_month), então o ON CONFLICT a preserva e o mês
--      NÃO é recriado, enquanto as views/UI a escondem.

-- ---------------------------------------------------------------------------
-- Tombstone de remoção. A linha permanece (ocupa o slot único ⇒ o gerador não
-- recria), mas é escondida de todas as views/UI.
-- ---------------------------------------------------------------------------
ALTER TABLE monthly_obligations
    ADD COLUMN is_dismissed BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- v_monthly_obligations: esconde dismissed; override=PAID não conta na acumulação
-- FIFO (mês liquidado fora do sistema não deve consumir a cobertura dos aportes
-- dos meses seguintes). Resto idêntico à versão de …260000 (reposição fora do
-- paid; status efetivo = COALESCE(override, regra FIFO-90%)).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_monthly_obligations AS
WITH paid AS (
    -- Contribuição mensal = aportado − reposição (exclui abertura/genesis).
    SELECT profile_id,
           COALESCE(SUM(amount_brl - reposition_amount), 0) AS total_paid
    FROM transactions
    WHERE type = 'APORTE' AND status = 'APPROVED' AND NOT is_opening
    GROUP BY profile_id
),
cum AS (
    SELECT
        o.id,
        o.profile_id,
        o.reference_month,
        o.amount_expected,
        o.status_override,
        -- override=PAID contribui 0 para o esperado acumulado (liquidado fora).
        SUM(
            CASE WHEN o.status_override = 'PAID' THEN 0 ELSE o.amount_expected END
        ) OVER (
            PARTITION BY o.profile_id
            ORDER BY o.reference_month
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS cum_expected
    FROM monthly_obligations o
    WHERE NOT o.is_dismissed
)
SELECT
    cum.id,
    cum.profile_id,
    cum.reference_month,
    cum.amount_expected,
    cum.status_override,
    cum.cum_expected,
    COALESCE(paid.total_paid, 0) AS total_paid,
    COALESCE(
        cum.status_override,
        CASE
            WHEN COALESCE(paid.total_paid, 0) >= 0.90 * cum.cum_expected
                THEN 'PAID'::obligation_status
            ELSE 'PENDING'::obligation_status
        END
    ) AS status
FROM cum
LEFT JOIN paid ON paid.profile_id = cum.profile_id;

GRANT SELECT ON v_monthly_obligations TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- v_cotista_balance: o esperado exclui meses dismissed E meses com override=PAID
-- (liquidados fora do sistema ⇒ não são dívida). Demais colunas/semântica
-- idênticas à versão de …270000.
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
    WHERE NOT is_dismissed
      AND status_override IS DISTINCT FROM 'PAID'::obligation_status
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

-- ---------------------------------------------------------------------------
-- delete_obligation: remoção PERMANENTE (soft-delete). O slot único permanece, o
-- gerador não recria. Gateado por admin.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_obligation(
    p_admin_id UUID,
    p_obligation_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM pap_require_admin(p_admin_id);
    UPDATE monthly_obligations
    SET is_dismissed = TRUE
    WHERE id = p_obligation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Obrigação % não encontrada.', p_obligation_id;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_obligation(UUID, UUID) TO authenticated;
