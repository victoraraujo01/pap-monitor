-- Alterações em batch no livro-razão: edita, remove E cria vários lançamentos numa
-- única transação, com UM rebuild no fim (em vez de N rebuilds, um por operação).
--
-- Por que é seguro: o replay (pap_rebuild_history) recompõe quotas_amount/quota_price
-- de todos os eventos APPROVED e reseta/reaplica os lotes. Logo as mutações só precisam
-- deixar transactions/fund_bond_lots no estado ESTRUTURAL certo (título, qtd, valor,
-- data, tipo, status); o rebuild final conserta tudo o que é derivado. Aplicar N ops e
-- rebuildar uma vez dá EXATAMENTE o mesmo resultado de N ops com rebuild intercalado,
-- porque o rebuild só depende do conjunto final de linhas.
--
-- Atomicidade: apply_event_changes roda numa única transação. Qualquer item inválido
-- aborta o lote inteiro (tudo-ou-nada) e a exceção carrega o `ref` do item que falhou,
-- para o front destacar a linha culpada.

-- ---------------------------------------------------------------------------
-- 1) Cores SEM rebuild — corpo idêntico às RPCs single-op atuais, menos o
--    PERFORM pap_rebuild_history() final. Reusados pelo batch e pelos wrappers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pap_delete_transaction_core(
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

    -- Lote vinculado existe só no APORTE. As saídas não têm lote próprio: o replay
    -- restaura a liquidação ao resetar os lotes e reaplicar o FIFO.
    DELETE FROM fund_bond_lots WHERE transaction_id = p_transaction_id;
    DELETE FROM transactions WHERE id = p_transaction_id;
END;
$$;

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
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) Wrappers single-op = core + rebuild. Preservam a API atual (tests/front
--    legados) sem duplicar corpo. CREATE OR REPLACE mantém os GRANTs existentes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_transaction(
    p_caller_id UUID,
    p_transaction_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM pap_delete_transaction_core(p_caller_id, p_transaction_id);
    PERFORM pap_rebuild_history();
END;
$$;

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
BEGIN
    PERFORM pap_update_transaction_core(
        p_caller_id, p_transaction_id, p_bond_id, p_quantity, p_amount_brl, p_event_date
    );
    PERFORM pap_rebuild_history();
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) apply_event_changes — orquestra um array de operações (create/update/delete)
--    numa transação só, com UM rebuild ao final. Atômica: item inválido aborta o
--    lote inteiro e a exceção carrega o `ref` do item para mapeamento no front.
--
--    p_changes (array ordenado; itens independentes — update/delete por id já
--    existente, create sempre novo):
--      { "ref": str, "op": "create", "kind": "APORTE",
--        "profile_id", "bond_id", "quantity", "amount_brl", "event_date" }
--      { "ref": str, "op": "create", "kind": "WITHDRAWAL",
--        "type": "RESGATE_PESSOAL"|"DESPESA_PAIS", "direct": bool,
--        "profile_id", "bond_id", "quantity", "amount_brl", "event_date" }
--      { "ref": str, "op": "update", "transaction_id",
--        "bond_id", "quantity", "amount_brl", "event_date" }
--      { "ref": str, "op": "delete", "transaction_id" }
--
--    A criação reaproveita register_aporte/request_withdrawal (que NÃO rodam rebuild);
--    a cota provisória que elas gravam é sobrescrita pelo rebuild final, e o FIFO
--    imediato dos resgates diretos é inócuo (o rebuild reseta e reaplica os lotes).
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
                -- Quem cria precisa ser o dono do lançamento ou um admin.
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
                ELSE
                    RAISE EXCEPTION 'Tipo de criação inválido: %', v_kind;
                END IF;

            ELSE
                RAISE EXCEPTION 'Operação inválida: %', v_op;
            END IF;

            v_count := v_count + 1;

        EXCEPTION WHEN OTHERS THEN
            -- Re-raise com o ref do item: o sub-bloco desfaz o savepoint e a
            -- propagação aborta a transação inteira (rollback total = atômico).
            RAISE EXCEPTION 'ref=%|item %: %', v_ref, v_idx, SQLERRM;
        END;
    END LOOP;

    PERFORM pap_rebuild_history();

    RETURN jsonb_build_object('applied', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION apply_event_changes(UUID, JSONB) TO authenticated;
