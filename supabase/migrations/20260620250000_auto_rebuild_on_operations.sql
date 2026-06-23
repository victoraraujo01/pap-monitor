-- Auto-rebuild nas RPCs de operação (fim da reconstrução manual).
--
-- Contexto: as telas de operação (register_aporte / request_withdrawal /
-- register_reinvestment / approve_expense / reject_expense) gravavam as cotas pela
-- COTA CORRENTE (pap_latest_quota_price) e NÃO recompunham a série de PL — só o
-- apply_event_changes (livro-razão em batch) e delete/update rodavam o replay. Isso
-- deixava o fundo path-dependent: a mesma operação dava resultado diferente conforme
-- a tela, e a curva só ficava correta quando um humano clicava em "Reconstruir
-- histórico". Agora toda operação roda pap_rebuild_history() ao final.
--
-- Por que uma FLAG de supressão (pap.suppress_rebuild): apply_event_changes aplica N
-- operações e roda UM rebuild no fim — de propósito, porque o estado intermediário
-- pode ser transitoriamente inconsistente (ex.: criar um resgate cujo aporte de
-- financiamento é um item posterior do mesmo lote). Se cada operação interna
-- rebuildasse, um lote válido poderia falhar no meio. A flag (transação-local) faz as
-- RPCs internas PULAREM o rebuild quando chamadas de dentro do batch; standalone elas
-- rebuildam. É correção, não só performance.
--
-- Consequência semântica nova: o replay processa por event_date e exige consistência
-- CRONOLÓGICA — uma saída datada ANTES de existir lote do título (ex.: resgate antes
-- do aporte que o financia) agora falha no FIFO em vez de "funcionar" pela liquidação
-- imediata. Em produção há sempre saldo de abertura dando lastro à carteira, então
-- isso só ocorre se alguém resgatar um título antes de adquiri-lo (de fato inválido).
--
-- set_opening_balance (genesis, recalculate_pl) e o cron diário (recalculate_pl, só
-- emite o dia corrente) seguem como estão — a primeira operação após a abertura já
-- reconstrói a curva completa.

-- ---------------------------------------------------------------------------
-- Helper: roda o replay a menos que estejamos dentro de um batch (flag setada).
-- current_setting(..., true) devolve NULL quando a GUC não foi setada → rebuilda.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pap_autorebuild()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF current_setting('pap.suppress_rebuild', true) IS DISTINCT FROM 'on' THEN
        PERFORM pap_rebuild_history();
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- CdU 2 — register_aporte: + rebuild ao final.
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

    PERFORM pap_autorebuild();
    RETURN v_txn_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- CdU 3 — request_withdrawal: + rebuild nos caminhos que mexem no fundo
-- (resgate direto e despesa direta). A despesa PROPOSTA (pendente) não altera
-- lotes/cotas e é ignorada pelo replay, então não dispara rebuild.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION request_withdrawal(
    p_profile_id UUID,
    p_bond_id UUID,
    p_quantity NUMERIC,
    p_amount_brl NUMERIC,
    p_type transaction_type,
    p_event_date DATE DEFAULT CURRENT_DATE,
    p_direct BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_bond treasury_bonds;
    v_quota_price NUMERIC(15, 6);
    v_quotas NUMERIC(15, 6);
    v_balance NUMERIC;
    v_amount NUMERIC(15, 2);
    v_txn_id UUID;
BEGIN
    IF p_type NOT IN ('RESGATE_PESSOAL', 'DESPESA_PAIS') THEN
        RAISE EXCEPTION 'Tipo de saída inválido: %', p_type;
    END IF;
    IF COALESCE(p_quantity, 0) <= 0 OR COALESCE(p_amount_brl, 0) <= 0 THEN
        RAISE EXCEPTION 'Saída exige a quantidade de títulos e o valor bruto (R$).';
    END IF;

    SELECT * INTO v_bond FROM treasury_bonds WHERE id = p_bond_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Título % não encontrado no catálogo.', p_bond_id;
    END IF;

    v_amount := ROUND(p_amount_brl, 2);
    v_quota_price := pap_latest_quota_price();   -- provisório; o rebuild recomputa

    -- 2. DESPESA proposta (pendente): nada liquidado/queimado até a classificação.
    IF p_type = 'DESPESA_PAIS' AND NOT p_direct THEN
        INSERT INTO transactions
            (profile_id, type, status, amount_brl, quota_price, quotas_amount,
             target_bond_id, event_date, quantity)
        VALUES
            (p_profile_id, 'DESPESA_PAIS', 'PENDING_APPROVAL', v_amount,
             v_quota_price, 0, p_bond_id, p_event_date, p_quantity)
        RETURNING id INTO v_txn_id;
        RETURN v_txn_id;   -- pendente não altera o fundo; sem rebuild
    END IF;

    -- 3. DESPESA direta: só admin; nasce aprovada, liquida, ninguém perde cota.
    IF p_type = 'DESPESA_PAIS' AND p_direct THEN
        PERFORM pap_require_admin(p_profile_id);
        PERFORM pap_liquidate_fifo(p_bond_id, p_quantity);
        INSERT INTO transactions
            (profile_id, type, status, amount_brl, quota_price, quotas_amount,
             target_bond_id, approved_by, event_date, quantity)
        VALUES
            (p_profile_id, 'DESPESA_PAIS', 'APPROVED', v_amount, v_quota_price, 0,
             p_bond_id, p_profile_id, p_event_date, p_quantity)
        RETURNING id INTO v_txn_id;
        PERFORM pap_autorebuild();
        RETURN v_txn_id;
    END IF;

    -- 1. RESGATE_PESSOAL direto: nasce aprovado, liquida e queima as cotas do solicitante.
    v_quotas := v_amount / v_quota_price;

    SELECT COALESCE(SUM(quotas_amount), 0)
    INTO v_balance
    FROM transactions
    WHERE profile_id = p_profile_id AND status = 'APPROVED';
    IF v_quotas > v_balance + 1e-9 THEN
        RAISE EXCEPTION 'Cotas insuficientes para o resgate (saldo %, requerido %).',
            v_balance, v_quotas;
    END IF;

    PERFORM pap_liquidate_fifo(p_bond_id, p_quantity);

    INSERT INTO transactions
        (profile_id, type, status, amount_brl, quota_price, quotas_amount,
         target_bond_id, approved_by, event_date, quantity)
    VALUES
        (p_profile_id, 'RESGATE_PESSOAL', 'APPROVED', v_amount, v_quota_price,
         -v_quotas, p_bond_id, p_profile_id, p_event_date, p_quantity)
    RETURNING id INTO v_txn_id;

    PERFORM pap_autorebuild();
    RETURN v_txn_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- CdU 4 — approve_expense: + rebuild ao final.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION approve_expense(
    p_transaction_id UUID,
    p_approver_id UUID
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
    IF v_txn.status <> 'PENDING_APPROVAL' THEN
        RAISE EXCEPTION 'Transação % não está pendente (status atual: %).',
            p_transaction_id, v_txn.status;
    END IF;
    IF v_txn.profile_id = p_approver_id THEN
        RAISE EXCEPTION 'A saída deve ser classificada por outro cotista.';
    END IF;
    IF v_txn.quantity IS NULL OR v_txn.quantity <= 0 THEN
        RAISE EXCEPTION 'Saída sem quantidade de títulos registrada.';
    END IF;

    PERFORM pap_liquidate_fifo(v_txn.target_bond_id, v_txn.quantity);

    UPDATE transactions
    SET type = 'DESPESA_PAIS', status = 'APPROVED', approved_by = p_approver_id
    WHERE id = p_transaction_id;

    PERFORM pap_autorebuild();
END;
$$;

-- ---------------------------------------------------------------------------
-- CdU 4 — reject_expense (reclassifica como RESGATE_PESSOAL): + rebuild ao final.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reject_expense(
    p_transaction_id UUID,
    p_approver_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_txn transactions;
    v_quota_price NUMERIC(15, 6);
    v_quotas NUMERIC(15, 6);
    v_balance NUMERIC;
BEGIN
    SELECT * INTO v_txn FROM transactions WHERE id = p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transação % não encontrada.', p_transaction_id;
    END IF;
    IF v_txn.status <> 'PENDING_APPROVAL' THEN
        RAISE EXCEPTION 'Só é possível classificar uma saída pendente.';
    END IF;
    IF v_txn.profile_id = p_approver_id THEN
        RAISE EXCEPTION 'A saída deve ser classificada por outro cotista.';
    END IF;
    IF v_txn.quantity IS NULL OR v_txn.quantity <= 0 THEN
        RAISE EXCEPTION 'Saída sem quantidade de títulos registrada.';
    END IF;

    v_quota_price := pap_latest_quota_price();
    v_quotas := v_txn.amount_brl / v_quota_price;

    SELECT COALESCE(SUM(quotas_amount), 0)
    INTO v_balance
    FROM transactions
    WHERE profile_id = v_txn.profile_id AND status = 'APPROVED';
    IF v_quotas > v_balance + 1e-9 THEN
        RAISE EXCEPTION 'Cotas insuficientes para o resgate (saldo %, requerido %).',
            v_balance, v_quotas;
    END IF;

    PERFORM pap_liquidate_fifo(v_txn.target_bond_id, v_txn.quantity);

    UPDATE transactions
    SET type = 'RESGATE_PESSOAL', status = 'APPROVED', approved_by = p_approver_id,
        quota_price = v_quota_price, quotas_amount = -v_quotas
    WHERE id = p_transaction_id;

    PERFORM pap_autorebuild();
END;
$$;

-- ---------------------------------------------------------------------------
-- Reinvestimento (multi-destino) — register_reinvestment: + rebuild ao final.
-- ---------------------------------------------------------------------------
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

        UPDATE treasury_bonds
        SET current_price = v_unit_price
        WHERE id = v_bond_id AND current_price IS NULL;
    END LOOP;

    PERFORM pap_autorebuild();
    RETURN v_txn_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- apply_event_changes: seta a flag de supressão no início para que as RPCs de
-- criação (register_aporte/request_withdrawal/register_reinvestment) NÃO rebuildem
-- por item — o batch roda UM rebuild ao final (como antes). set_config(...true) é
-- transação-local: vale para as chamadas aninhadas e some no fim da transação (e em
-- rollback). Resto do corpo idêntico à versão multi-destino.
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
    -- Suprime o rebuild por item; um único replay roda no fim.
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

GRANT EXECUTE ON FUNCTION pap_autorebuild() TO authenticated;
