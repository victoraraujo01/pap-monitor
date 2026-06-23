-- Reposição editável na edição de aporte (histórico).
--
-- Até aqui, pap_update_transaction_core só CLAMPAVA reposition_amount ao novo valor
-- (LEAST(reposition_amount, v_amount)) — não havia como ALTERAR a divisão resgate×
-- aporte de um lançamento já gravado. A criação em batch (apply_event_changes →
-- register_aporte) já aceitava reposição; faltava o caminho de edição.
--
-- Esta migração adiciona p_reposition_amount ao core (DROP+recreate por mudança de
-- assinatura) e o repassa no ramo `update` do apply_event_changes. Semântica:
--   NULL  = mantém a reposição atual, clampada ao novo valor (comportamento legado);
--   valor = substitui (validado 0 ≤ rep ≤ amount). Só faz sentido no APORTE.
--
-- reposition_amount é rótulo contábil: NÃO entra em PL/cotas/IR/FIFO e sobrevive ao
-- replay (pap_rebuild_history nunca toca nesta coluna). Logo, o motor não muda — é só
-- threading. O wrapper legado update_transaction (6 args) segue chamando o core sem o
-- campo → p_note e p_reposition_amount default NULL → nota e reposição preservadas.

-- ---------------------------------------------------------------------------
-- pap_update_transaction_core: + p_reposition_amount. Corpo idêntico à versão de
-- …310000, exceto pelo cálculo de reposition_amount.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS pap_update_transaction_core(
    UUID, UUID, UUID, NUMERIC, NUMERIC, DATE, TEXT);

CREATE OR REPLACE FUNCTION pap_update_transaction_core(
    p_caller_id UUID,
    p_transaction_id UUID,
    p_bond_id UUID,
    p_quantity NUMERIC,
    p_amount_brl NUMERIC,
    p_event_date DATE,
    p_note TEXT DEFAULT NULL,
    p_reposition_amount NUMERIC DEFAULT NULL
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
    v_reposition NUMERIC(15, 2);
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

    -- Reposição só se aplica ao APORTE. Quando informada, substitui (validada);
    -- quando NULL (ou fora do aporte), mantém a atual clampada ao novo valor.
    IF v_txn.type = 'APORTE' AND p_reposition_amount IS NOT NULL THEN
        v_reposition := ROUND(p_reposition_amount, 2);
        IF v_reposition < 0 OR v_reposition > v_amount THEN
            RAISE EXCEPTION 'Reposição (%) deve estar entre 0 e o valor (%).',
                v_reposition, v_amount;
        END IF;
    ELSE
        v_reposition := LEAST(COALESCE(v_txn.reposition_amount, 0), v_amount);
    END IF;

    UPDATE transactions
    SET amount_brl = v_amount,
        quantity = p_quantity,
        event_date = p_event_date,
        target_bond_id = p_bond_id,
        reposition_amount = v_reposition,
        note = CASE WHEN p_note IS NULL THEN note ELSE NULLIF(btrim(p_note), '') END
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
-- apply_event_changes: repassa `reposition_amount` no ramo `update` (NULL quando
-- ausente → mantém). Resto idêntico à versão de …310000.
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
                    (v_item->>'event_date')::DATE,
                    v_item->>'note',
                    (v_item->>'reposition_amount')::NUMERIC
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
                        COALESCE((v_item->>'reposition_amount')::NUMERIC, 0),
                        v_item->>'note'
                    );
                ELSIF v_kind = 'WITHDRAWAL' THEN
                    PERFORM request_withdrawal(
                        (v_item->>'profile_id')::UUID,
                        (v_item->>'bond_id')::UUID,
                        (v_item->>'quantity')::NUMERIC,
                        (v_item->>'amount_brl')::NUMERIC,
                        (v_item->>'type')::transaction_type,
                        (v_item->>'event_date')::DATE,
                        COALESCE((v_item->>'direct')::BOOLEAN, FALSE),
                        v_item->>'note'
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
                        (v_item->>'event_date')::DATE,
                        v_item->>'note'
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
