-- ===========================================================================
-- Abertura consolidada: 1 lançamento por CONTRIBUIÇÃO (irmão × título).
--
-- Contexto: desde a …350000 a abertura gravava DUAS naturezas de transação
-- is_opening — sementes de carteira (título, quotas_amount=0, profile_id NULL) e
-- participações (cotas por irmão, sem título). Eram o MESMO valor de gênese por
-- dois ângulos, e as sementes apareciam no livro como "Aporte ABERTURA" sem dono.
--
-- A gênese do fundo é 100% em títulos e cada título tem um contribuinte conhecido
-- (a cota de cada irmão = títulos que ele aportou). Então as duas viram UMA: cada
-- transação de abertura carrega título + dono + cotas, e as cotas DERIVAM do valor
-- (amount_brl ÷ cota de gênese). O livro mostra linhas concretas com dono.
--
-- RETROCOMPATÍVEL (sem janela de double-count): o rebuild minta cota numa linha de
-- abertura COM título somente quando ela tem profile_id. Linha com título e
-- profile_id NULL continua sendo lastro puro (0 cotas), como hoje — então a gênese
-- atual de prod (sementes sem dono + participações) segue idêntica até o admin
-- atribuir os profiles e remover as participações (passo de dados manual, fora do
-- repo). Aberturas novas pela tela já nascem consolidadas.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) pap_rebuild_history: ramo is_opening passa a mintar cota na linha de
--    contribuição (com título + dono). Demais ramos idênticos à …350000.
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
    v_target JSONB;
    v_t_qty NUMERIC;
    v_t_amount NUMERIC(15, 2);
BEGIN
    TRUNCATE pl_history;
    TRUNCATE fund_bond_lots;   -- lotes recriados do ledger abaixo

    FOR v_ev IN
        SELECT id, type, profile_id, amount_brl, quotas_amount, quantity,
               source_bond_id, target_bond_id, targets, is_opening, quota_price,
               event_date
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
            IF v_ev.target_bond_id IS NOT NULL THEN
                -- Contribuição de abertura → lote real (lastro de PL/IR).
                IF v_ev.profile_id IS NOT NULL THEN
                    -- Com dono: minta as cotas derivadas do valor de gênese
                    -- (valor ÷ cota de gênese gravada na própria linha).
                    v_q := CASE WHEN v_ev.quota_price > 0
                                THEN v_ev.amount_brl / v_ev.quota_price
                                ELSE COALESCE(v_ev.quotas_amount, 0) END;
                    UPDATE transactions SET quotas_amount = v_q WHERE id = v_ev.id;
                    v_total_quotas := v_total_quotas + v_q;
                END IF;
                INSERT INTO fund_bond_lots
                    (transaction_id, bond_id, purchase_date, purchase_price,
                     quantity, is_active, is_opening)
                VALUES
                    (v_ev.id, v_ev.target_bond_id, v_ev.event_date,
                     ROUND(v_ev.amount_brl / NULLIF(v_ev.quantity, 0), 6),
                     v_ev.quantity, TRUE, TRUE);
            ELSE
                -- Participação de abertura legada (sem título) → só soma cotas.
                v_total_quotas := v_total_quotas + v_ev.quotas_amount;
            END IF;

        ELSIF v_ev.type = 'APORTE' THEN
            v_q := v_ev.amount_brl / v_qp;
            UPDATE transactions
            SET quotas_amount = v_q, quota_price = v_qp
            WHERE id = v_ev.id;
            -- Lote do aporte recriado do ledger (bond/qtd/valor na transação).
            INSERT INTO fund_bond_lots
                (transaction_id, bond_id, purchase_date, purchase_price, quantity, is_active)
            VALUES
                (v_ev.id, v_ev.target_bond_id, v_ev.event_date,
                 ROUND(v_ev.amount_brl / NULLIF(v_ev.quantity, 0), 6),
                 v_ev.quantity, TRUE);
            v_total_quotas := v_total_quotas + v_q;

        ELSIF v_ev.type = 'REINVESTIMENTO' THEN
            -- Rotação de carteira: 1 lote por destino (targets jsonb) e liquida a
            -- origem via FIFO. Nenhuma cota é mintada/queimada (PL conservado).
            UPDATE transactions
            SET quota_price = v_qp
            WHERE id = v_ev.id;
            FOR v_target IN
                SELECT * FROM jsonb_array_elements(COALESCE(v_ev.targets, '[]'::jsonb))
            LOOP
                v_t_qty := (v_target->>'quantity')::NUMERIC;
                v_t_amount := ROUND((v_target->>'amount_brl')::NUMERIC, 2);
                INSERT INTO fund_bond_lots
                    (transaction_id, bond_id, purchase_date, purchase_price, quantity, is_active)
                VALUES
                    (v_ev.id, (v_target->>'bond_id')::UUID, v_ev.event_date,
                     ROUND(v_t_amount / NULLIF(v_t_qty, 0), 6), v_t_qty, TRUE);
            END LOOP;
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
-- 2) set_opening_balance: nova assinatura por CONTRIBUIÇÕES. Cada contribuição
--    (irmão × título) vira UMA transação de abertura com título + dono; as cotas
--    derivam do valor (amount ÷ cota de gênese). Não há mais lista de cotas
--    separada nem linhas de participação. DROP+recreate (assinatura mudou).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS set_opening_balance(UUID, DATE, JSONB, JSONB, NUMERIC);

CREATE OR REPLACE FUNCTION set_opening_balance(
    p_admin_id UUID,
    p_date DATE,
    p_contributions JSONB,
    p_quota_price NUMERIC DEFAULT 1
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_c JSONB;
    v_profile_id UUID;
    v_bond_id UUID;
    v_qty NUMERIC;
    v_amount NUMERIC;
    v_price NUMERIC;
    v_qp NUMERIC := COALESCE(p_quota_price, 1);
BEGIN
    PERFORM pap_require_admin(p_admin_id);

    IF v_qp <= 0 THEN
        RAISE EXCEPTION 'Valor inicial da cota inválido: %', p_quota_price;
    END IF;

    -- Substitui o genesis anterior (qualquer formato: split antigo ou consolidado).
    DELETE FROM fund_bond_lots WHERE is_opening = TRUE;
    DELETE FROM transactions WHERE is_opening = TRUE;

    FOR v_c IN SELECT * FROM jsonb_array_elements(COALESCE(p_contributions, '[]'::jsonb))
    LOOP
        v_profile_id := (v_c->>'profile_id')::UUID;
        v_bond_id := (v_c->>'bond_id')::UUID;
        v_qty := (v_c->>'quantity')::NUMERIC;
        v_amount := (v_c->>'amount')::NUMERIC;

        IF v_profile_id IS NULL
           OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_profile_id) THEN
            RAISE EXCEPTION 'Contribuinte inválido na abertura: %', v_c;
        END IF;
        IF v_qty IS NULL OR v_qty <= 0 OR v_amount IS NULL OR v_amount <= 0 THEN
            RAISE EXCEPTION 'Contribuição de abertura inválida (quantidade/valor): %', v_c;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM treasury_bonds WHERE id = v_bond_id) THEN
            RAISE EXCEPTION 'Título % não encontrado no catálogo.', v_bond_id;
        END IF;

        v_price := ROUND(v_amount / v_qty, 6);

        -- Uma transação por contribuição: título + dono; cotas = valor ÷ cota de
        -- gênese (o rebuild re-deriva o mesmo). amount_brl = valor total da contribuição.
        INSERT INTO transactions
            (profile_id, type, status, amount_brl, quota_price, quotas_amount,
             target_bond_id, event_date, quantity, is_opening)
        VALUES
            (v_profile_id, 'APORTE', 'APPROVED', ROUND(v_amount, 2), v_qp,
             ROUND(v_amount / v_qp, 6), v_bond_id, p_date, v_qty, TRUE);

        -- Semeia o preço corrente quando o catálogo ainda não foi precificado.
        UPDATE treasury_bonds
        SET current_price = v_price
        WHERE id = v_bond_id AND current_price IS NULL;
    END LOOP;

    -- Replay: materializa os lotes de abertura, minta as cotas por dono e emite a curva.
    PERFORM pap_rebuild_history();
END;
$$;

GRANT EXECUTE ON FUNCTION set_opening_balance(UUID, DATE, JSONB, NUMERIC) TO authenticated;
