-- REINVESTIMENTO — múltiplos destinos + cálculo do líquido por IR.
--
-- Antes: um reinvestimento liquidava UMA origem e abria UM destino. Agora a rotação
-- pode reaplicar o caixa de uma origem em VÁRIOS títulos de destino, numa única
-- transação REINVESTIMENTO com N lotes (o replay já ativa todos os lotes por
-- transaction_id e liquida a origem uma vez — nada muda no motor).
--
-- Modelagem: a transação guarda source_bond_id (origem liquidada via FIFO),
-- quantity (unidades da origem que saíram) e amount_brl (Σ valor reaplicado nos
-- destinos = caixa líquido reaplicado). target_bond_id passa a guardar o destino só
-- quando há UM (compat. com a exibição antiga); com vários fica NULL (a tela lista os
-- lotes). quotas_amount=0 → cota contínua; PL conservado quando Σdestinos == líquido
-- da origem (é o que a tela trava).

-- ---------------------------------------------------------------------------
-- reinvestment_source_proceeds: dado um título de origem e a quantidade resgatada,
-- devolve o BRUTO (qtd × preço da data), o IR (FIFO sobre os lotes ativos, faixa
-- regressiva por dias de cada lote) e o LÍQUIDO (bruto − IR). É o helper que a tela do
-- reinvestimento usa para mostrar bruto → IR → líquido e ancorar a soma dos destinos.
-- Espelha o FIFO de pap_liquidate_fifo (purchase_date ASC, id ASC) e a fórmula de IR
-- de pap_portfolio_net_value (IR só sobre ganho positivo, por lote).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reinvestment_source_proceeds(
    p_bond_id UUID,
    p_quantity NUMERIC,
    p_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_remaining NUMERIC := p_quantity;
    v_lot RECORD;
    v_price NUMERIC := COALESCE(
        pap_price_on(p_bond_id, p_date),
        (SELECT current_price FROM treasury_bonds WHERE id = p_bond_id)
    );
    v_units NUMERIC;
    v_unit_price NUMERIC;
    v_gain NUMERIC;
    v_days INT;
    v_gross NUMERIC := 0;
    v_ir NUMERIC := 0;
    v_available NUMERIC := 0;
BEGIN
    SELECT COALESCE(SUM(quantity), 0) INTO v_available
    FROM fund_bond_lots
    WHERE bond_id = p_bond_id AND is_active = TRUE;

    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RETURN jsonb_build_object(
            'gross', 0, 'ir', 0, 'net', 0,
            'available', v_available, 'priced', v_price IS NOT NULL
        );
    END IF;

    FOR v_lot IN
        SELECT quantity, purchase_price, purchase_date
        FROM fund_bond_lots
        WHERE bond_id = p_bond_id AND is_active = TRUE
        ORDER BY purchase_date ASC, id ASC
    LOOP
        EXIT WHEN v_remaining <= 0;
        v_units := LEAST(v_lot.quantity, v_remaining);
        -- Sem preço da data: cai no preço de compra do lote (ganho 0 → IR 0).
        v_unit_price := COALESCE(v_price, v_lot.purchase_price);
        v_days := GREATEST((p_date - v_lot.purchase_date)::INT, 0);
        v_gross := v_gross + v_units * v_unit_price;
        v_gain := v_units * (v_unit_price - v_lot.purchase_price);
        IF v_gain > 0 THEN
            v_ir := v_ir + v_gain * pap_ir_rate(v_days);
        END IF;
        v_remaining := v_remaining - v_units;
    END LOOP;

    RETURN jsonb_build_object(
        'gross', ROUND(v_gross, 2),
        'ir', ROUND(v_ir, 2),
        'net', ROUND(v_gross - v_ir, 2),
        'available', v_available,
        'priced', v_price IS NOT NULL
    );
END;
$$;

GRANT EXECUTE ON FUNCTION reinvestment_source_proceeds(UUID, NUMERIC, DATE)
    TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- register_reinvestment: nova assinatura — destinos num array JSONB
-- [{bond_id, quantity, amount_brl}, ...]. Liquida a origem (FIFO) e abre um lote por
-- destino. amount_brl da transação = Σ valores dos destinos. target_bond_id = o único
-- destino quando há 1; NULL quando há vários. Mudança de assinatura ⇒ DROP da antiga.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS register_reinvestment(UUID, UUID, NUMERIC, UUID, NUMERIC, NUMERIC, DATE);

CREATE OR REPLACE FUNCTION register_reinvestment(
    p_profile_id UUID,
    p_source_bond_id UUID,
    p_source_quantity NUMERIC,
    p_targets JSONB,
    p_event_date DATE DEFAULT CURRENT_DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target JSONB;
    v_bond treasury_bonds;
    v_bond_id UUID;
    v_qty NUMERIC;
    v_amount NUMERIC;
    v_unit_price NUMERIC(15, 6);
    v_total NUMERIC(15, 2) := 0;
    v_count INT := 0;
    v_first_target UUID := NULL;
    v_quota_price NUMERIC(15, 6);
    v_txn_id UUID;
BEGIN
    IF COALESCE(p_source_quantity, 0) <= 0 THEN
        RAISE EXCEPTION 'Reinvestimento exige quantidade de origem positiva.';
    END IF;
    IF p_targets IS NULL OR jsonb_typeof(p_targets) <> 'array'
       OR jsonb_array_length(p_targets) = 0 THEN
        RAISE EXCEPTION 'Reinvestimento exige ao menos um título de destino.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM treasury_bonds WHERE id = p_source_bond_id) THEN
        RAISE EXCEPTION 'Título de origem % não encontrado no catálogo.', p_source_bond_id;
    END IF;

    -- Valida cada destino e soma os valores reaplicados.
    FOR v_target IN SELECT * FROM jsonb_array_elements(p_targets)
    LOOP
        v_bond_id := (v_target->>'bond_id')::UUID;
        v_qty := (v_target->>'quantity')::NUMERIC;
        v_amount := (v_target->>'amount_brl')::NUMERIC;

        IF COALESCE(v_qty, 0) <= 0 OR COALESCE(v_amount, 0) <= 0 THEN
            RAISE EXCEPTION 'Cada destino exige quantidade e valor positivos.';
        END IF;
        IF v_bond_id = p_source_bond_id THEN
            RAISE EXCEPTION 'Origem e destino do reinvestimento devem ser títulos diferentes.';
        END IF;
        SELECT * INTO v_bond FROM treasury_bonds WHERE id = v_bond_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Título de destino % não encontrado no catálogo.', v_bond_id;
        END IF;
        IF NOT v_bond.is_available_for_purchase THEN
            RAISE EXCEPTION 'Título de destino % não está disponível para compra.', v_bond.api_reference_name;
        END IF;

        v_total := v_total + ROUND(v_amount, 2);
        v_count := v_count + 1;
        IF v_first_target IS NULL THEN
            v_first_target := v_bond_id;
        END IF;
    END LOOP;

    v_quota_price := pap_latest_quota_price();   -- provisório; rebuild recompõe

    -- Baixa a origem agora (o rebuild reseta e reaplica; aqui é só p/ o estado imediato).
    PERFORM pap_liquidate_fifo(p_source_bond_id, p_source_quantity);

    INSERT INTO transactions
        (profile_id, type, status, amount_brl, quota_price, quotas_amount,
         source_bond_id, target_bond_id, event_date, quantity)
    VALUES
        (p_profile_id, 'REINVESTIMENTO', 'APPROVED', v_total, v_quota_price, 0,
         p_source_bond_id,
         CASE WHEN v_count = 1 THEN v_first_target ELSE NULL END,
         p_event_date, p_source_quantity)
    RETURNING id INTO v_txn_id;

    -- Um lote por destino (mesmo padrão do APORTE: aponta para a transação).
    FOR v_target IN SELECT * FROM jsonb_array_elements(p_targets)
    LOOP
        v_bond_id := (v_target->>'bond_id')::UUID;
        v_qty := (v_target->>'quantity')::NUMERIC;
        v_amount := ROUND((v_target->>'amount_brl')::NUMERIC, 2);
        v_unit_price := ROUND(v_amount / v_qty, 6);

        INSERT INTO fund_bond_lots
            (transaction_id, bond_id, purchase_date, purchase_price, quantity, is_active)
        VALUES
            (v_txn_id, v_bond_id, p_event_date, v_unit_price, v_qty, TRUE);

        -- Semeia current_price do destino se ainda nulo (painel mostra algo antes do
        -- primeiro fechamento; o job diário sobrescreve).
        UPDATE treasury_bonds
        SET current_price = v_unit_price
        WHERE id = v_bond_id AND current_price IS NULL;
    END LOOP;

    RETURN v_txn_id;
END;
$$;

GRANT EXECUTE ON FUNCTION
    register_reinvestment(UUID, UUID, NUMERIC, JSONB, DATE)
    TO authenticated;

-- ---------------------------------------------------------------------------
-- apply_event_changes: o ramo de criação de REINVESTIMENTO passa a montar o array de
-- destinos. Aceita tanto `targets` (array já no formato novo) quanto os campos
-- single-destino antigos (compat.). Demais ramos inalterados.
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
    v_targets JSONB;
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
                    -- targets explícito, ou monta um array de 1 com os campos antigos.
                    v_targets := COALESCE(
                        v_item->'targets',
                        jsonb_build_array(jsonb_build_object(
                            'bond_id', v_item->>'target_bond_id',
                            'quantity', v_item->>'target_quantity',
                            'amount_brl', v_item->>'amount_brl'
                        ))
                    );
                    PERFORM register_reinvestment(
                        (v_item->>'profile_id')::UUID,
                        (v_item->>'source_bond_id')::UUID,
                        (v_item->>'source_quantity')::NUMERIC,
                        v_targets,
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
