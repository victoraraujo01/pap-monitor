-- Adimplência por SALDO ACUMULADO + status mensal derivado (FIFO 90%).
--
-- Contexto: o modelo antigo casava cada aporte contra obrigações mensais por VALOR
-- exato (baixa greedy no register_aporte: `EXIT WHEN v_remaining < amount_expected`).
-- Isso quebrava com a realidade de preço de título não fechar redondo: aporte de
-- R$980 deixava o mês PENDING (faltou R$20), troco de aporte sobrava e sumia, e dois
-- aportes parciais no mesmo mês nunca quitavam. Além disso o `status` só era setado na
-- criação e o rebuild ignorava — estado frágil/path-dependent.
--
-- Novo modelo (duas lentes, ambas derivadas de `transactions`, sempre consistentes
-- com o rebuild):
--   1. SALDO TOTAL do cotista (dinheiro exato): Σ amount_expected − Σ aportado.
--      Sobra rola adiante como crédito, falta acumula.
--   2. STATUS MENSAL (checkmark verde/vermelho): cobertura FIFO acumulada — o total
--      aportado preenche os meses do mais antigo pro mais novo. Um mês m é "quitado"
--      quando `total_aportado >= 0,90 × Σ(amount_expected até m)`. Quitar 5 atrasados
--      num aporte só pinta os 5 de verde retroativamente (bate com o saldo).
--
-- A tabela `monthly_obligations` permanece (congela o amount_expected de cada mês — é
-- o que permite mudar o valor mensal no futuro SEM reescrever o passado). O `status`
-- gravado deixa de ser a verdade; vira só um OVERRIDE manual do admin (status_override).
-- Status efetivo = COALESCE(override, regra FIFO-90%).

-- ---------------------------------------------------------------------------
-- Override manual opcional. NULL = status automático (regra FIFO-90%). O admin pode
-- forçar PAID/PENDING (casos fora do sistema: contribuição em dinheiro, mês perdoado)
-- ou limpar (voltar ao automático) via set_obligation_status.
-- ---------------------------------------------------------------------------
ALTER TABLE monthly_obligations
    ADD COLUMN status_override obligation_status;

-- A coluna antiga `status` fica vestigial (não é mais lida nem escrita pela app; o
-- status efetivo sai da view abaixo). Mantida para não quebrar nada legado.

-- ---------------------------------------------------------------------------
-- View do status efetivo por obrigação. Expõe as mesmas colunas que a tabela + o
-- status derivado/efetivo, o esperado acumulado e o total aportado do cotista.
-- A app lê DAQUI (não mais de monthly_obligations).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_monthly_obligations AS
WITH paid AS (
    -- Total efetivamente aportado por cotista (exclui saldo de abertura: genesis da
    -- carteira, não é contribuição mensal). Conta só APORTE aprovado.
    SELECT profile_id, COALESCE(SUM(amount_brl), 0) AS total_paid
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
        SUM(o.amount_expected) OVER (
            PARTITION BY o.profile_id
            ORDER BY o.reference_month
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS cum_expected
    FROM monthly_obligations o
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
-- View do saldo total por cotista (dinheiro exato). balance > 0 = devedor;
-- balance <= 0 = em dia / adiantado (crédito).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_cotista_balance AS
SELECT
    o.profile_id,
    SUM(o.amount_expected) AS total_expected,
    COALESCE(p.total_paid, 0) AS total_paid,
    SUM(o.amount_expected) - COALESCE(p.total_paid, 0) AS balance
FROM monthly_obligations o
LEFT JOIN (
    SELECT profile_id, COALESCE(SUM(amount_brl), 0) AS total_paid
    FROM transactions
    WHERE type = 'APORTE' AND status = 'APPROVED' AND NOT is_opening
    GROUP BY profile_id
) p ON p.profile_id = o.profile_id
GROUP BY o.profile_id, p.total_paid;

GRANT SELECT ON v_cotista_balance TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- set_obligation_status: agora grava o OVERRIDE manual (não o status legado).
-- p_status NULL limpa o override (volta ao automático FIFO-90%).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_obligation_status(
    p_admin_id UUID,
    p_obligation_id UUID,
    p_status obligation_status DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM pap_require_admin(p_admin_id);
    UPDATE monthly_obligations
    SET status_override = p_status
    WHERE id = p_obligation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Obrigação % não encontrada.', p_obligation_id;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION set_obligation_status(UUID, UUID, obligation_status)
    TO authenticated;

-- ---------------------------------------------------------------------------
-- register_aporte: remove a baixa greedy de obrigações (o status mensal agora é
-- derivado pela view). Resto do corpo inalterado.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION register_aporte(
    p_profile_id UUID,
    p_bond_id UUID,
    p_quantity NUMERIC,
    p_amount_brl NUMERIC,
    p_event_date DATE DEFAULT CURRENT_DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_bond treasury_bonds;
    v_amount NUMERIC(15, 2);
    v_unit_price NUMERIC(15, 6);
    v_quota_price NUMERIC(15, 6);
    v_quotas NUMERIC(15, 6);
    v_txn_id UUID;
BEGIN
    IF p_quantity <= 0 OR p_amount_brl <= 0 THEN
        RAISE EXCEPTION 'Quantidade e valor aportado devem ser positivos.';
    END IF;

    SELECT * INTO v_bond FROM treasury_bonds WHERE id = p_bond_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Título % não encontrado no catálogo.', p_bond_id;
    END IF;
    IF NOT v_bond.is_available_for_purchase THEN
        RAISE EXCEPTION 'Título % não está disponível para compra.', v_bond.api_reference_name;
    END IF;

    v_amount := ROUND(p_amount_brl, 2);
    v_unit_price := ROUND(v_amount / p_quantity, 6);   -- preço unitário derivado
    v_quota_price := pap_latest_quota_price();
    v_quotas := v_amount / v_quota_price;

    INSERT INTO transactions
        (profile_id, type, status, amount_brl, quota_price, quotas_amount,
         target_bond_id, event_date, quantity)
    VALUES
        (p_profile_id, 'APORTE', 'APPROVED', v_amount, v_quota_price, v_quotas,
         p_bond_id, p_event_date, p_quantity)
    RETURNING id INTO v_txn_id;

    INSERT INTO fund_bond_lots
        (transaction_id, bond_id, purchase_date, purchase_price, quantity, is_active)
    VALUES
        (v_txn_id, p_bond_id, p_event_date, v_unit_price, p_quantity, TRUE);

    RETURN v_txn_id;
END;
$$;

GRANT EXECUTE ON FUNCTION register_aporte(UUID, UUID, NUMERIC, NUMERIC, DATE) TO authenticated;
