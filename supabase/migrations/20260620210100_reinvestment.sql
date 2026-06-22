-- REINVESTIMENTO — corpo: coluna de origem, RPC de registro, replay e guardas.
--
-- Forma da operação: uma transação que toca DOIS títulos.
--   - source_bond_id (coluna nova) = título liquidado (vencido/vendido); FIFO baixa
--     `quantity` unidades dele.
--   - target_bond_id (coluna existente) = título comprado; o lote novo aponta para a
--     transação via transaction_id (mesmo padrão do APORTE) e guarda qtd + preço.
--   - quantity = unidades da ORIGEM liquidadas (verdade do que saiu da carteira).
--   - amount_brl = valor investido no DESTINO (= valor do lote novo).
--   - quotas_amount = 0 → total_quotas do fundo intacto → cota contínua.
-- PL conservado: o lote novo entra com o valor reaplicado; se o cotista reinvestiu o
-- líquido recebido, o PL não dá salto no dia (− valor da origem + valor do destino).

-- ---------------------------------------------------------------------------
-- Schema aditivo: título de origem do reinvestimento.
-- ---------------------------------------------------------------------------
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS source_bond_id UUID REFERENCES treasury_bonds(id);

-- ---------------------------------------------------------------------------
-- register_reinvestment: liquida a origem (FIFO) e abre o lote do destino. Nasce
-- APPROVED (PL-neutro, não queima cota de ninguém). A cota gravada é provisória — o
-- rebuild recompõe quota_price (quotas_amount continua 0). Qualquer cotista pode lançar.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION register_reinvestment(
    p_profile_id UUID,
    p_source_bond_id UUID,
    p_source_quantity NUMERIC,
    p_target_bond_id UUID,
    p_target_quantity NUMERIC,
    p_target_amount_brl NUMERIC,
    p_event_date DATE DEFAULT CURRENT_DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target treasury_bonds;
    v_amount NUMERIC(15, 2);
    v_unit_price NUMERIC(15, 6);
    v_quota_price NUMERIC(15, 6);
    v_txn_id UUID;
BEGIN
    IF COALESCE(p_source_quantity, 0) <= 0
       OR COALESCE(p_target_quantity, 0) <= 0
       OR COALESCE(p_target_amount_brl, 0) <= 0 THEN
        RAISE EXCEPTION 'Reinvestimento exige quantidade de origem, quantidade e valor de destino positivos.';
    END IF;
    IF p_source_bond_id = p_target_bond_id THEN
        RAISE EXCEPTION 'Origem e destino do reinvestimento devem ser títulos diferentes.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM treasury_bonds WHERE id = p_source_bond_id) THEN
        RAISE EXCEPTION 'Título de origem % não encontrado no catálogo.', p_source_bond_id;
    END IF;
    SELECT * INTO v_target FROM treasury_bonds WHERE id = p_target_bond_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Título de destino % não encontrado no catálogo.', p_target_bond_id;
    END IF;
    IF NOT v_target.is_available_for_purchase THEN
        RAISE EXCEPTION 'Título de destino % não está disponível para compra.', v_target.api_reference_name;
    END IF;

    v_amount := ROUND(p_target_amount_brl, 2);
    v_unit_price := ROUND(v_amount / p_target_quantity, 6);   -- preço do lote novo
    v_quota_price := pap_latest_quota_price();                -- provisório; rebuild recompõe

    -- Baixa a origem agora (o rebuild reseta e reaplica; aqui é só p/ o estado imediato).
    PERFORM pap_liquidate_fifo(p_source_bond_id, p_source_quantity);

    INSERT INTO transactions
        (profile_id, type, status, amount_brl, quota_price, quotas_amount,
         source_bond_id, target_bond_id, event_date, quantity)
    VALUES
        (p_profile_id, 'REINVESTIMENTO', 'APPROVED', v_amount, v_quota_price, 0,
         p_source_bond_id, p_target_bond_id, p_event_date, p_source_quantity)
    RETURNING id INTO v_txn_id;

    INSERT INTO fund_bond_lots
        (transaction_id, bond_id, purchase_date, purchase_price, quantity, is_active)
    VALUES
        (v_txn_id, p_target_bond_id, p_event_date, v_unit_price, p_target_quantity, TRUE);

    -- Semeia current_price do destino se ainda nulo (painel mostra algo antes do
    -- primeiro fechamento; o job diário sobrescreve). Mesmo gesto do saldo de abertura.
    UPDATE treasury_bonds
    SET current_price = v_unit_price
    WHERE id = p_target_bond_id AND current_price IS NULL;

    RETURN v_txn_id;
END;
$$;

GRANT EXECUTE ON FUNCTION
    register_reinvestment(UUID, UUID, NUMERIC, UUID, NUMERIC, NUMERIC, DATE)
    TO authenticated;

-- ---------------------------------------------------------------------------
-- pap_rebuild_history: redefinido para tratar REINVESTIMENTO. Diferenças vs. a versão
-- anterior: o SELECT puxa source_bond_id e há um ramo novo que ativa o lote do destino
-- (como o APORTE) e liquida a origem via FIFO, SEM mexer em total_quotas (cota neutra).
-- Os demais ramos são idênticos.
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
               source_bond_id, target_bond_id, is_opening, event_date
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

        ELSIF v_ev.type = 'REINVESTIMENTO' THEN
            -- Rotação de carteira: ativa o lote do destino (qtd/preço gravados) e
            -- liquida a origem. Nenhuma cota é mintada/queimada (PL conservado).
            UPDATE transactions
            SET quota_price = v_qp
            WHERE id = v_ev.id;
            UPDATE fund_bond_lots
            SET is_active = TRUE
            WHERE transaction_id = v_ev.id AND COALESCE(original_quantity, 0) > 0;
            PERFORM pap_liquidate_fifo(v_ev.source_bond_id, v_ev.quantity);

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

-- ---------------------------------------------------------------------------
-- pap_update_transaction_core: bloqueia editar REINVESTIMENTO (a edição genérica
-- expressa um único título/quantidade/valor; um reinvestimento tem origem + destino).
-- Para corrigir, remova e recrie. delete continua funcionando (o core apaga o lote do
-- destino por transaction_id; o replay restaura a liquidação da origem).
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
        target_bond_id = p_bond_id
    WHERE id = p_transaction_id;

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
-- apply_event_changes ganha o caminho de criação de REINVESTIMENTO (kind), para o
-- livro-razão em batch também poder lançá-lo. Demais ramos inalterados.
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
                        (v_item->>'event_date')::DATE
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
                        (v_item->>'target_bond_id')::UUID,
                        (v_item->>'target_quantity')::NUMERIC,
                        (v_item->>'amount_brl')::NUMERIC,
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
