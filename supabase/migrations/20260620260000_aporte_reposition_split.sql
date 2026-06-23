-- Aporte dividido entre OBRIGAÇÃO MENSAL e REPOSIÇÃO DE RESGATE.
--
-- Contexto: um RESGATE_PESSOAL tira caixa do fundo e queima as cotas do solicitante,
-- mas sumia das duas lentes de adimplência (v_cotista_balance / v_monthly_obligations
-- só somam APORTE). O cotista não via quanto havia retirado nem quanto faltava repor.
--
-- Decisão de produto (com o dono): o resgate NÃO contamina a obrigação mensal de
-- R$1000 — vira um indicador separado ("resgate a repor"). A reposição é EXPLÍCITA: um
-- aporte pode destinar parte do valor a abater esse saldo, e essa parte NÃO conta como
-- contribuição mensal. Um único aporte se divide entre os dois baldes.
--
-- Modelagem: a divisão é só RÓTULO CONTÁBIL. O aporte inteiro (amount_brl) continua
-- comprando o título, mintando cotas e recompondo a participação — o motor de PL/
-- cotas / pap_rebuild_history NÃO muda (o replay só reescreve quotas_amount/
-- quota_price/quantity, nunca esta coluna). A coluna só altera as views de adimplência:
--   • contribuição mensal contabilizada = amount_brl − reposition_amount
--   • resgate a repor = Σ RESGATE_PESSOAL.amount_brl − Σ reposition_amount

-- ---------------------------------------------------------------------------
-- Coluna aditiva. Só é significativa em type='APORTE'. DEFAULT 0 => todos os
-- lançamentos existentes seguem 100% como contribuição (comportamento atual).
-- ---------------------------------------------------------------------------
ALTER TABLE transactions
    ADD COLUMN reposition_amount NUMERIC(15, 2) NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- register_aporte: + p_reposition_amount (parte destinada a abater o resgate).
-- DROP+recreate por mudança de assinatura. Corpo = versão de auto-rebuild (…250000)
-- + validação e gravação da coluna nova. O full amount_brl segue mintando cotas.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS register_aporte(UUID, UUID, NUMERIC, NUMERIC, DATE);

CREATE OR REPLACE FUNCTION register_aporte(
    p_profile_id UUID,
    p_bond_id UUID,
    p_quantity NUMERIC,
    p_amount_brl NUMERIC,
    p_event_date DATE DEFAULT CURRENT_DATE,
    p_reposition_amount NUMERIC DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_bond treasury_bonds;
    v_amount NUMERIC(15, 2);
    v_reposition NUMERIC(15, 2);
    v_unit_price NUMERIC(15, 6);
    v_quota_price NUMERIC(15, 6);
    v_quotas NUMERIC(15, 6);
    v_txn_id UUID;
BEGIN
    IF p_quantity <= 0 OR p_amount_brl <= 0 THEN
        RAISE EXCEPTION 'Quantidade e valor aportado devem ser positivos.';
    END IF;

    v_amount := ROUND(p_amount_brl, 2);
    v_reposition := ROUND(COALESCE(p_reposition_amount, 0), 2);
    IF v_reposition < 0 OR v_reposition > v_amount THEN
        RAISE EXCEPTION 'Reposição (%) deve estar entre 0 e o valor do aporte (%).',
            v_reposition, v_amount;
    END IF;

    SELECT * INTO v_bond FROM treasury_bonds WHERE id = p_bond_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Título % não encontrado no catálogo.', p_bond_id;
    END IF;
    IF NOT v_bond.is_available_for_purchase THEN
        RAISE EXCEPTION 'Título % não está disponível para compra.', v_bond.api_reference_name;
    END IF;

    v_unit_price := ROUND(v_amount / p_quantity, 6);   -- preço unitário derivado
    v_quota_price := pap_latest_quota_price();
    v_quotas := v_amount / v_quota_price;

    INSERT INTO transactions
        (profile_id, type, status, amount_brl, quota_price, quotas_amount,
         target_bond_id, event_date, quantity, reposition_amount)
    VALUES
        (p_profile_id, 'APORTE', 'APPROVED', v_amount, v_quota_price, v_quotas,
         p_bond_id, p_event_date, p_quantity, v_reposition)
    RETURNING id INTO v_txn_id;

    INSERT INTO fund_bond_lots
        (transaction_id, bond_id, purchase_date, purchase_price, quantity, is_active)
    VALUES
        (v_txn_id, p_bond_id, p_event_date, v_unit_price, p_quantity, TRUE);

    PERFORM pap_autorebuild();
    RETURN v_txn_id;
END;
$$;

GRANT EXECUTE ON FUNCTION
    register_aporte(UUID, UUID, NUMERIC, NUMERIC, DATE, NUMERIC) TO authenticated;

-- ---------------------------------------------------------------------------
-- v_monthly_obligations: a contribuição que quita mês exclui a reposição.
-- (Resto idêntico à versão de …200000.)
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
-- v_cotista_balance: contribuição mensal exclui reposição + 3 colunas novas para
-- o indicador "resgate a repor". balance segue = Σ esperado − Σ contribuído.
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
)
SELECT
    o.profile_id,
    SUM(o.amount_expected)                       AS total_expected,
    COALESCE(c.total_paid, 0)                     AS total_paid,
    SUM(o.amount_expected) - COALESCE(c.total_paid, 0) AS balance,
    COALESCE(w.withdrawn_total, 0)               AS withdrawn_total,
    COALESCE(c.reposed_total, 0)                 AS reposed_total,
    COALESCE(w.withdrawn_total, 0) - COALESCE(c.reposed_total, 0)
                                                 AS repayment_outstanding
FROM monthly_obligations o
LEFT JOIN contrib c   ON c.profile_id = o.profile_id
LEFT JOIN withdrawn w ON w.profile_id = o.profile_id
GROUP BY o.profile_id, c.total_paid, c.reposed_total, w.withdrawn_total;

GRANT SELECT ON v_cotista_balance TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- pap_update_transaction_core: ao reescrever um APORTE, clampar reposition_amount
-- ao novo valor (a edição do histórico não expõe o campo; evita ficar > amount).
-- Resto idêntico à versão de …180000.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pap_update_transaction_core(
    p_caller_id UUID,
    p_transaction_id UUID,
    p_bond_id UUID,
    p_quantity NUMERIC,
    p_amount_brl NUMERIC,
    p_event_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_txn transactions;
    v_amount NUMERIC(15, 2);
    v_unit_price NUMERIC(15, 6);
BEGIN
    SELECT * INTO v_txn FROM transactions WHERE id = p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transação % não encontrada.', p_transaction_id;
    END IF;
    IF v_txn.is_opening THEN
        RAISE EXCEPTION 'Lançamentos de abertura são geridos pelo saldo de abertura.';
    END IF;
    IF v_txn.type = 'REINVESTIMENTO' THEN
        RAISE EXCEPTION 'Reinvestimentos não são editáveis; remova e recrie.';
    END IF;

    PERFORM pap_require_admin_or_owner(p_caller_id, v_txn.profile_id);

    IF COALESCE(p_quantity, 0) <= 0 OR COALESCE(p_amount_brl, 0) <= 0 THEN
        RAISE EXCEPTION 'Quantidade e valor devem ser positivos.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM treasury_bonds WHERE id = p_bond_id) THEN
        RAISE EXCEPTION 'Título % não encontrado no catálogo.', p_bond_id;
    END IF;

    v_amount := ROUND(p_amount_brl, 2);

    UPDATE transactions
    SET amount_brl = v_amount,
        quantity = p_quantity,
        event_date = p_event_date,
        target_bond_id = p_bond_id,
        reposition_amount = LEAST(reposition_amount, v_amount)
    WHERE id = p_transaction_id;

    -- APORTE: reescreve o lote vinculado (base de custo do IR = valor/quantidade).
    IF v_txn.type = 'APORTE' THEN
        v_unit_price := ROUND(v_amount / p_quantity, 6);
        UPDATE fund_bond_lots
        SET bond_id = p_bond_id,
            purchase_date = p_event_date,
            purchase_price = v_unit_price,
            quantity = p_quantity,
            original_quantity = p_quantity
        WHERE transaction_id = p_transaction_id;
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- apply_event_changes: o ramo create APORTE repassa reposition_amount (default 0).
-- Resto idêntico à versão de …250000 (mantém a flag de supressão + 1 rebuild final).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_event_changes(
    p_caller_id UUID,
    p_changes JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item JSONB;
    v_idx INT := 0;
    v_ref TEXT;
    v_op TEXT;
    v_kind TEXT;
    v_count INT := 0;
BEGIN
    PERFORM set_config('pap.suppress_rebuild', 'on', true);

    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_changes, '[]'::jsonb))
    LOOP
        v_idx := v_idx + 1;
        v_ref := COALESCE(v_item->>'ref', v_idx::TEXT);
        v_op := v_item->>'op';

        BEGIN
            IF v_op = 'delete' THEN
                PERFORM pap_delete_transaction_core(
                    p_caller_id, (v_item->>'transaction_id')::UUID
                );

            ELSIF v_op = 'update' THEN
                PERFORM pap_update_transaction_core(
                    p_caller_id,
                    (v_item->>'transaction_id')::UUID,
                    (v_item->>'bond_id')::UUID,
                    (v_item->>'quantity')::NUMERIC,
                    (v_item->>'amount_brl')::NUMERIC,
                    (v_item->>'event_date')::DATE
                );

            ELSIF v_op = 'create' THEN
                PERFORM pap_require_admin_or_owner(
                    p_caller_id, (v_item->>'profile_id')::UUID
                );
                v_kind := v_item->>'kind';

                IF v_kind = 'APORTE' THEN
                    PERFORM register_aporte(
                        (v_item->>'profile_id')::UUID,
                        (v_item->>'bond_id')::UUID,
                        (v_item->>'quantity')::NUMERIC,
                        (v_item->>'amount_brl')::NUMERIC,
                        (v_item->>'event_date')::DATE,
                        COALESCE((v_item->>'reposition_amount')::NUMERIC, 0)
                    );
                ELSIF v_kind = 'WITHDRAWAL' THEN
                    PERFORM request_withdrawal(
                        (v_item->>'profile_id')::UUID,
                        (v_item->>'bond_id')::UUID,
                        (v_item->>'quantity')::NUMERIC,
                        (v_item->>'amount_brl')::NUMERIC,
                        (v_item->>'type')::transaction_type,
                        (v_item->>'event_date')::DATE,
                        COALESCE((v_item->>'direct')::BOOLEAN, FALSE)
                    );
                ELSIF v_kind = 'REINVESTIMENTO' THEN
                    PERFORM register_reinvestment(
                        (v_item->>'profile_id')::UUID,
                        (v_item->>'source_bond_id')::UUID,
                        (v_item->>'source_quantity')::NUMERIC,
                        COALESCE(
                            v_item->'targets',
                            jsonb_build_array(jsonb_build_object(
                                'bond_id', v_item->>'target_bond_id',
                                'quantity', v_item->>'target_quantity',
                                'amount_brl', v_item->>'amount_brl'
                            ))
                        ),
                        (v_item->>'event_date')::DATE
                    );
                ELSE
                    RAISE EXCEPTION 'Tipo de criação inválido: %', v_kind;
                END IF;

            ELSE
                RAISE EXCEPTION 'Operação inválida: %', v_op;
            END IF;

            v_count := v_count + 1;

        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'ref=%|item %: %', v_ref, v_idx, SQLERRM;
        END;
    END LOOP;

    PERFORM pap_rebuild_history();

    RETURN jsonb_build_object('applied', v_count);
END;
$$;
