-- Gestão de eventos: edição/remoção de lançamentos por admin OU pelo próprio
-- cotista, com replay automático para manter o fundo consistente.
--
-- Decisões deste módulo:
--   - QUALQUER tipo de lançamento pode ser editado/removido (inclusive saídas).
--     A consistência (cotas, FIFO, série diária de PL) é restaurada por um rebuild
--     rodado DENTRO da própria RPC (SECURITY DEFINER) — sem exigir admin e sem um
--     passo manual. Reverter a liquidação de uma saída cai naturalmente do replay
--     (que reseta os lotes a original_quantity e reaplica o FIFO só dos remanescentes).
--   - Permissão: admin edita/remove qualquer lançamento; cotista, só os PRÓPRIOS.
--   - Lançamentos de ABERTURA (is_opening) não passam por aqui — são geridos por
--     set_opening_balance (substituição do genesis).

-- ---------------------------------------------------------------------------
-- 1) Replay extraído para função interna SEM gate, reaproveitada pelo rebuild
--    manual (admin) e pelas RPCs de edição/remoção. Corpo idêntico ao
--    rebuild_fund_history original (migração do motor de histórico).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pap_rebuild_history()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total_quotas NUMERIC(15, 6) := 0;
    v_prev_day DATE := NULL;
    v_day DATE;
    v_ev RECORD;
    v_pl NUMERIC(15, 2);
    v_qp NUMERIC(15, 6);
    v_q NUMERIC(15, 6);
    v_qty NUMERIC(15, 6);
    v_price NUMERIC;
BEGIN
    TRUNCATE pl_history;

    UPDATE fund_bond_lots
    SET quantity = original_quantity,
        is_active = (is_opening AND COALESCE(original_quantity, 0) > 0)
    WHERE TRUE;

    FOR v_ev IN
        SELECT id, type, profile_id, amount_brl, quotas_amount, quantity,
               target_bond_id, is_opening, event_date
        FROM transactions
        WHERE status = 'APPROVED'
        ORDER BY event_date ASC, is_opening DESC, created_at ASC, id ASC
    LOOP
        IF v_prev_day IS NOT NULL AND v_ev.event_date > v_prev_day THEN
            v_day := v_prev_day + 1;
            WHILE v_day < v_ev.event_date LOOP
                PERFORM pap_emit_pl(v_day, v_total_quotas);
                v_day := v_day + 1;
            END LOOP;
        END IF;

        v_pl := pap_portfolio_net_value(v_ev.event_date);
        v_qp := CASE WHEN v_total_quotas > 0 THEN v_pl / v_total_quotas ELSE 1.0 END;

        IF v_ev.is_opening THEN
            v_total_quotas := v_total_quotas + v_ev.quotas_amount;

        ELSIF v_ev.type = 'APORTE' THEN
            v_q := v_ev.amount_brl / v_qp;
            UPDATE transactions
            SET quotas_amount = v_q, quota_price = v_qp
            WHERE id = v_ev.id;
            UPDATE fund_bond_lots
            SET is_active = TRUE
            WHERE transaction_id = v_ev.id AND COALESCE(original_quantity, 0) > 0;
            v_total_quotas := v_total_quotas + v_q;

        ELSIF v_ev.type = 'RESGATE_PESSOAL' THEN
            v_q := CASE WHEN v_qp > 0 THEN v_ev.amount_brl / v_qp ELSE 0 END;
            UPDATE transactions
            SET quotas_amount = -v_q, quota_price = v_qp
            WHERE id = v_ev.id;
            v_total_quotas := v_total_quotas - v_q;
            PERFORM pap_liquidate_fifo(v_ev.target_bond_id, v_ev.quantity);

        ELSIF v_ev.type = 'DESPESA_PAIS' THEN
            v_price := COALESCE(pap_price_on(v_ev.target_bond_id, v_ev.event_date), 0);
            v_qty := COALESCE(
                v_ev.quantity,
                CASE WHEN v_price > 0 THEN v_ev.amount_brl / v_price ELSE 0 END
            );
            UPDATE transactions
            SET quota_price = v_qp, quantity = v_qty
            WHERE id = v_ev.id;
            PERFORM pap_liquidate_fifo(v_ev.target_bond_id, v_qty);
        END IF;

        PERFORM pap_emit_pl(v_ev.event_date, v_total_quotas);
        v_prev_day := v_ev.event_date;
    END LOOP;

    IF v_prev_day IS NOT NULL THEN
        v_day := v_prev_day + 1;
        WHILE v_day <= CURRENT_DATE LOOP
            PERFORM pap_emit_pl(v_day, v_total_quotas);
            v_day := v_day + 1;
        END LOOP;
    END IF;
END;
$$;

-- rebuild_fund_history vira um wrapper gateado por admin sobre o replay interno.
CREATE OR REPLACE FUNCTION rebuild_fund_history(p_admin_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM pap_require_admin(p_admin_id);
    PERFORM pap_rebuild_history();
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) Gate compartilhado: passa se o chamador é ADMIN ou é o dono do lançamento.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pap_require_admin_or_owner(
    p_caller_id UUID,
    p_owner_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_caller_id = p_owner_id THEN
        RETURN;
    END IF;
    IF EXISTS (
        SELECT 1 FROM profiles WHERE id = p_caller_id AND role = 'ADMIN'
    ) THEN
        RETURN;
    END IF;
    RAISE EXCEPTION 'Só o autor do lançamento ou um administrador pode alterá-lo.';
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) delete_transaction reescrito: chamador-based (admin OU dono), qualquer
--    tipo de lançamento, com replay automático. DROP da versão anterior
--    (admin-only + só APORTE) por mudança de nome do 1º parâmetro.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS delete_transaction(UUID, UUID);

CREATE OR REPLACE FUNCTION delete_transaction(
    p_caller_id UUID,
    p_transaction_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_txn transactions;
BEGIN
    SELECT * INTO v_txn FROM transactions WHERE id = p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transação % não encontrada.', p_transaction_id;
    END IF;
    IF v_txn.is_opening THEN
        RAISE EXCEPTION 'Lançamentos de abertura são geridos pelo saldo de abertura.';
    END IF;

    PERFORM pap_require_admin_or_owner(p_caller_id, v_txn.profile_id);

    -- Lote vinculado (existe só no APORTE). As saídas não têm lote próprio: o
    -- replay restaura a liquidação ao resetar os lotes e reaplicar o FIFO.
    DELETE FROM fund_bond_lots WHERE transaction_id = p_transaction_id;
    DELETE FROM transactions WHERE id = p_transaction_id;

    PERFORM pap_rebuild_history();
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) update_transaction: edição de campos completos (título, quantidade, valor
--    total/bruto e data) de um lançamento, por admin OU pelo dono. O lote do
--    APORTE é reescrito junto; saídas só atualizam a transação (o replay refaz
--    cotas e FIFO). Pendentes podem ser editadas; o replay as ignora até a
--    classificação. quotas_amount/quota_price são recompostos pelo rebuild.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_transaction(
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
        target_bond_id = p_bond_id
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

    PERFORM pap_rebuild_history();
END;
$$;

GRANT EXECUTE ON FUNCTION delete_transaction(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION update_transaction(UUID, UUID, UUID, NUMERIC, NUMERIC, DATE)
    TO authenticated;
