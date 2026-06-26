-- ===========================================================================
-- fund_bond_lots vira PROJEÇÃO PURA do livro-razão (transactions).
--
-- Motivação: o backup mínimo capaz de reconstruir o fundo precisava carregar
-- fund_bond_lots por dois pontos onde os lotes guardavam dado AUSENTE de
-- transactions:
--   (1) a composição da CARTEIRA DE ABERTURA (lotes is_opening, transaction_id
--       NULL): as transações de abertura só guardavam cotas por irmão, não os
--       títulos/qtd/preço de D0;
--   (2) os DESTINOS de um REINVESTIMENTO multi-destino: a transação guardava só
--       o total reaplicado, e o detalhamento por destino vivia só nos N lotes.
--
-- Esta migração fecha os dois buracos e passa o pap_rebuild_history a ser o
-- ÚNICO dono de fund_bond_lots (TRUNCATE + recria do ledger). Depois disto, o
-- "livro-razão exportável" = transactions + treasury_bonds + profiles + deltas
-- manuais de monthly_obligations.
--
-- PRESERVAÇÃO DOS DADOS ATUAIS: antes de o rebuild assumir, a migração faz
-- backfill para o ledger de tudo que faltava (targets dos reinvestimentos +
-- transações-semente da abertura), lendo os lotes ATUAIS. Só então roda o
-- rebuild, que recria os lotes idênticos a partir do ledger já completo.
--
-- Modelagem da abertura: vira DUAS naturezas de transação is_opening,
-- distinguidas por target_bond_id:
--   - semente de carteira: is_opening, target_bond_id = título, quantity,
--     amount_brl = qtd×preço, quotas_amount = 0, profile_id NULL → o rebuild
--     cria 1 lote de abertura a partir dela;
--   - participação: is_opening, target_bond_id NULL, quotas_amount = cotas do
--     irmão → o rebuild só soma cotas (comportamento de sempre).
-- Sem novo enum (reusa APORTE + is_opening); o ramo is_opening é avaliado antes
-- do ramo APORTE. As views de adimplência já filtram NOT is_opening, então as
-- sementes (amount_brl > 0) NÃO inflam contribuição mensal.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) Coluna aditiva: detalhamento por destino do reinvestimento.
-- ---------------------------------------------------------------------------
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS targets JSONB;

-- ---------------------------------------------------------------------------
-- 2) Backfill: reconstrói `targets` dos REINVESTIMENTOS existentes a partir dos
--    lotes atuais (1 elemento por lote do destino). amount_brl = qtd × preço.
-- ---------------------------------------------------------------------------
UPDATE transactions t
SET targets = sub.arr
FROM (
    SELECT transaction_id,
           jsonb_agg(jsonb_build_object(
               'bond_id', bond_id,
               'quantity', COALESCE(original_quantity, quantity),
               'amount_brl', ROUND(COALESCE(original_quantity, quantity) * purchase_price, 2)
           ) ORDER BY purchase_date, id) AS arr
    FROM fund_bond_lots
    WHERE transaction_id IS NOT NULL
    GROUP BY transaction_id
) sub
WHERE t.id = sub.transaction_id
  AND t.type = 'REINVESTIMENTO';

-- ---------------------------------------------------------------------------
-- 3) Backfill: cria as transações-semente da abertura a partir dos lotes
--    is_opening atuais (preserva bond/qtd/preço/data de D0 no ledger). O preço
--    é roteado por amount_brl = qtd×preço (2 casas) — mesmo modelo já usado pelo
--    APORTE; a deriva de centavo no custo-base de IR é imaterial (PL é em R$).
-- ---------------------------------------------------------------------------
INSERT INTO transactions
    (profile_id, type, status, amount_brl, quota_price, quotas_amount,
     target_bond_id, event_date, quantity, is_opening)
SELECT NULL, 'APORTE', 'APPROVED',
       ROUND(COALESCE(l.original_quantity, l.quantity) * l.purchase_price, 2),
       COALESCE((SELECT quota_price FROM transactions
                 WHERE is_opening AND target_bond_id IS NULL LIMIT 1), 1),
       0, l.bond_id, l.purchase_date,
       COALESCE(l.original_quantity, l.quantity), TRUE
FROM fund_bond_lots l
WHERE l.is_opening = TRUE;

-- ---------------------------------------------------------------------------
-- 4) pap_rebuild_history: agora é o ÚNICO dono de fund_bond_lots. TRUNCATE no
--    início e CRIA os lotes ao longo do replay (abertura, aporte,
--    reinvestimento). Como o replay processa em ordem cronológica
--    (event_date, is_opening DESC, created_at, id), os ids dos lotes saem em
--    ordem cronológica → FIFO (purchase_date ASC, id ASC) naturalmente correto.
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
               source_bond_id, target_bond_id, targets, is_opening, event_date
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
                -- Semente de carteira → lote real de abertura (lastro de PL/IR).
                INSERT INTO fund_bond_lots
                    (transaction_id, bond_id, purchase_date, purchase_price,
                     quantity, is_active, is_opening)
                VALUES
                    (v_ev.id, v_ev.target_bond_id, v_ev.event_date,
                     ROUND(v_ev.amount_brl / NULLIF(v_ev.quantity, 0), 6),
                     v_ev.quantity, TRUE, TRUE);
            ELSE
                -- Participação de abertura → só soma cotas do irmão.
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
-- 5) set_opening_balance: grava transações-semente (carteira) + transações de
--    participação (cotas por irmão) e roda o rebuild — que materializa os lotes
--    de abertura a partir do ledger. Não insere mais lotes diretamente.
--    Assinatura inalterada (UUID, DATE, JSONB, JSONB, NUMERIC).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS set_opening_balance(UUID, DATE, JSONB, JSONB, NUMERIC);

CREATE OR REPLACE FUNCTION set_opening_balance(
    p_admin_id UUID,
    p_date DATE,
    p_lots JSONB,
    p_quotas JSONB,
    p_quota_price NUMERIC DEFAULT 1
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_lot JSONB;
    v_q JSONB;
    v_qty NUMERIC;
    v_price NUMERIC;
    v_bond_id UUID;
    v_quotas NUMERIC;
    v_qp NUMERIC := COALESCE(p_quota_price, 1);
BEGIN
    PERFORM pap_require_admin(p_admin_id);

    IF v_qp <= 0 THEN
        RAISE EXCEPTION 'Valor inicial da cota inválido: %', p_quota_price;
    END IF;

    -- Substitui o genesis anterior. Os lotes de abertura antigos (transaction_id
    -- NULL) são removidos aqui; os novos são recriados pelo rebuild a partir das
    -- transações-semente.
    DELETE FROM fund_bond_lots WHERE is_opening = TRUE;
    DELETE FROM transactions WHERE is_opening = TRUE;

    -- Carteira em D0 → transações-semente (is_opening + target_bond_id). O preço
    -- de D0 vira a base de custo do IR (via amount_brl = qtd × preço no replay).
    FOR v_lot IN SELECT * FROM jsonb_array_elements(COALESCE(p_lots, '[]'::jsonb))
    LOOP
        v_bond_id := (v_lot->>'bond_id')::UUID;
        v_qty := (v_lot->>'quantity')::NUMERIC;
        v_price := (v_lot->>'price')::NUMERIC;

        IF v_qty IS NULL OR v_qty <= 0 OR v_price IS NULL OR v_price <= 0 THEN
            RAISE EXCEPTION 'Lote de abertura inválido (quantidade/preço): %', v_lot;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM treasury_bonds WHERE id = v_bond_id) THEN
            RAISE EXCEPTION 'Título % não encontrado no catálogo.', v_bond_id;
        END IF;

        INSERT INTO transactions
            (profile_id, type, status, amount_brl, quota_price, quotas_amount,
             target_bond_id, event_date, quantity, is_opening)
        VALUES
            (NULL, 'APORTE', 'APPROVED', ROUND(v_qty * v_price, 2), v_qp, 0,
             v_bond_id, p_date, v_qty, TRUE);

        -- Semeia o preço corrente quando o catálogo ainda não foi precificado, para
        -- o painel já mostrar algo antes do primeiro fechamento diário (o job sobrescreve).
        UPDATE treasury_bonds
        SET current_price = v_price
        WHERE id = v_bond_id AND current_price IS NULL;
    END LOOP;

    -- Cotas de abertura por irmão → transações de participação (APORTE/APPROVED).
    -- quota_price = cota de gênese (igual p/ todos); amount_brl = quotas × cota.
    FOR v_q IN SELECT * FROM jsonb_array_elements(COALESCE(p_quotas, '[]'::jsonb))
    LOOP
        v_quotas := (v_q->>'quotas')::NUMERIC;

        IF v_quotas IS NULL OR v_quotas <= 0 THEN
            RAISE EXCEPTION 'Cotas de abertura inválidas: %', v_q;
        END IF;

        INSERT INTO transactions
            (profile_id, type, status, amount_brl, quota_price, quotas_amount,
             event_date, is_opening)
        VALUES
            ((v_q->>'profile_id')::UUID, 'APORTE', 'APPROVED',
             ROUND(v_quotas * v_qp, 2), v_qp,
             v_quotas, p_date, TRUE);
    END LOOP;

    -- Replay completo: materializa os lotes de abertura e emite a curva de PL.
    PERFORM pap_rebuild_history();
END;
$$;

GRANT EXECUTE ON FUNCTION set_opening_balance(UUID, DATE, JSONB, JSONB, NUMERIC) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) register_reinvestment: passa a PERSISTIR `targets` na transação (o rebuild
--    recria os N lotes do destino a partir dele). Assinatura inalterada; o loop
--    de inserção de lotes é mantido só p/ o estado imediato — o autorebuild ao
--    final recria tudo a partir do ledger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION register_reinvestment(
    p_profile_id UUID,
    p_source_bond_id UUID,
    p_source_quantity NUMERIC,
    p_targets JSONB,
    p_event_date DATE DEFAULT CURRENT_DATE,
    p_note TEXT DEFAULT NULL
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
         source_bond_id, target_bond_id, targets, event_date, quantity, note)
    VALUES
        (p_profile_id, 'REINVESTIMENTO', 'APPROVED', v_total, v_quota_price, 0,
         p_source_bond_id,
         CASE WHEN v_count = 1 THEN v_first_target ELSE NULL END,
         p_targets,
         p_event_date, p_source_quantity, NULLIF(btrim(p_note), ''))
    RETURNING id INTO v_txn_id;

    -- Um lote por destino (estado imediato; o autorebuild recria do ledger).
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

GRANT EXECUTE ON FUNCTION
    register_reinvestment(UUID, UUID, NUMERIC, JSONB, DATE, TEXT)
    TO authenticated;

-- ---------------------------------------------------------------------------
-- 7) Rebuild final: recria fund_bond_lots a partir do ledger já completo (com os
--    backfills de targets + sementes de abertura). Os lotes antigos (incl. os de
--    abertura com transaction_id NULL) são truncados e recriados.
-- ---------------------------------------------------------------------------
SELECT pap_rebuild_history();
