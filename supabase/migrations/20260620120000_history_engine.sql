-- Motor de histórico: log de eventos datados, saldo de abertura e replay.
--
-- Transforma `transactions` num log de eventos (event_date, quantity, is_opening) e
-- habilita reconstruir PL e cotas a partir dele:
--   - set_opening_balance: ponto de partida (carteira em D0 = lotes reais que dão
--     lastro ao PL/resgate; cotas por irmão = participação).
--   - register_aporte datado, por quantidade + VALOR TOTAL aportado (preço unitário
--     do lote = valor/quantidade).
--   - bond_price_history (preços históricos, alimentada pela Edge Function em modo
--     backfill) + rebuild_fund_history: replay cronológico que recompõe a carteira a
--     cada data com preços históricos, recomputa as cotas pela cota REAL do dia e
--     gera a série diária de pl_history desde o 1º evento até hoje.
-- O fluxo de saída (request_withdrawal/approve/reject) está na migração seguinte.

-- ---------------------------------------------------------------------------
-- Schema aditivo
-- ---------------------------------------------------------------------------
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS event_date DATE NOT NULL DEFAULT CURRENT_DATE,
    -- Unidades de título envolvidas: compradas (APORTE) ou liquidadas (saídas).
    -- Torna a baixa da carteira exata e independente de preço no replay.
    ADD COLUMN IF NOT EXISTS quantity NUMERIC(15, 6),
    ADD COLUMN IF NOT EXISTS is_opening BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE fund_bond_lots
    ADD COLUMN IF NOT EXISTS is_opening BOOLEAN NOT NULL DEFAULT FALSE,
    -- Quantidade EMITIDA do lote, imutável. O FIFO mexe só em `quantity` (saldo
    -- remanescente); o rebuild reseta quantity = original_quantity e reaplica o FIFO.
    ADD COLUMN IF NOT EXISTS original_quantity NUMERIC(15, 6);

UPDATE fund_bond_lots SET original_quantity = quantity WHERE original_quantity IS NULL;

-- Preenche original_quantity em todo INSERT (cobre register_aporte,
-- set_opening_balance e inserts diretos em teste).
CREATE OR REPLACE FUNCTION pap_set_original_quantity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.original_quantity IS NULL THEN
        NEW.original_quantity := NEW.quantity;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lot_original_quantity ON fund_bond_lots;
CREATE TRIGGER trg_lot_original_quantity
    BEFORE INSERT ON fund_bond_lots
    FOR EACH ROW EXECUTE FUNCTION pap_set_original_quantity();

-- ---------------------------------------------------------------------------
-- Gate de ADMIN — operações de manipulação de histórico são restritas.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pap_require_admin(p_profile_id UUID)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM profiles WHERE id = p_profile_id AND role = 'ADMIN'
    ) THEN
        RAISE EXCEPTION 'Operação restrita a administradores.';
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Preços históricos por título e data (alimentado pela Edge Function em modo
-- backfill, a partir do mesmo CSV do Tesouro Transparente — que já traz todo o
-- histórico). Leitura liberada (sem RLS, como as demais tabelas operacionais).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bond_price_history (
    bond_id UUID REFERENCES treasury_bonds(id) NOT NULL,
    date    DATE NOT NULL,
    price   NUMERIC(15, 6) NOT NULL,
    PRIMARY KEY (bond_id, date)
);
GRANT SELECT ON bond_price_history TO anon, authenticated;

-- UPSERT de preços históricos (Edge Function, modo backfill). Recebe um array
-- [{ "name": api_reference_name, "date": "YYYY-MM-DD", "price": num }, ...] e casa
-- por api_reference_name (catálogo governado; nada é criado). Retorna nº de linhas.
CREATE OR REPLACE FUNCTION update_bond_price_history(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    WITH incoming AS (
        SELECT b.id AS bond_id,
               (e->>'date')::DATE AS date,
               (e->>'price')::NUMERIC AS price
        FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) e
        JOIN treasury_bonds b ON b.api_reference_name = e->>'name'
        WHERE (e->>'price') ~ '^[0-9]+(\.[0-9]+)?$'
    )
    INSERT INTO bond_price_history (bond_id, date, price)
    SELECT bond_id, date, price FROM incoming
    ON CONFLICT (bond_id, date) DO UPDATE SET price = EXCLUDED.price;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION update_bond_price_history(JSONB) TO authenticated, service_role;

-- Preço de um título "em" uma data: a cotação mais recente com data <= alvo
-- (carry-forward); se não houver anterior, a primeira posterior; senão NULL.
CREATE OR REPLACE FUNCTION pap_price_on(p_bond_id UUID, p_date DATE)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT price FROM (
        (SELECT price, 0 AS pref FROM bond_price_history
          WHERE bond_id = p_bond_id AND date <= p_date ORDER BY date DESC LIMIT 1)
        UNION ALL
        (SELECT price, 1 AS pref FROM bond_price_history
          WHERE bond_id = p_bond_id AND date > p_date ORDER BY date ASC LIMIT 1)
    ) q ORDER BY pref LIMIT 1;
$$;

-- Valor líquido da carteira "em" uma data: soma dos lotes ATIVOS, valorizados pelo
-- preço histórico da data (fallback no preço de compra), com IR regressivo sobre o
-- lucro pelos dias corridos até a data. Usa is_active (estado do replay).
CREATE OR REPLACE FUNCTION pap_portfolio_net_value(p_date DATE)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(SUM(
        sub.gross
        - CASE WHEN sub.gross - sub.cost > 0
               THEN (sub.gross - sub.cost) * pap_ir_rate(sub.days)
               ELSE 0 END
    ), 0)
    FROM (
        SELECT l.quantity * COALESCE(pap_price_on(l.bond_id, p_date), l.purchase_price) AS gross,
               l.quantity * l.purchase_price AS cost,
               GREATEST((p_date - l.purchase_date)::INT, 0) AS days
        FROM fund_bond_lots l
        WHERE l.is_active = TRUE
          AND l.purchase_date <= p_date
    ) sub;
$$;

-- Grava (upsert) um ponto diário de pl_history para a data. Helper do rebuild.
CREATE OR REPLACE FUNCTION pap_emit_pl(p_date DATE, p_total_quotas NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pl NUMERIC(15, 2);
    v_qp NUMERIC(15, 6);
BEGIN
    v_pl := pap_portfolio_net_value(p_date);
    v_qp := CASE WHEN p_total_quotas > 0 THEN v_pl / p_total_quotas ELSE 1.0 END;
    INSERT INTO pl_history (date, total_pl_brl, total_quotas, quota_price)
    VALUES (p_date, v_pl, p_total_quotas, v_qp)
    ON CONFLICT (date) DO UPDATE
        SET total_pl_brl = EXCLUDED.total_pl_brl,
            total_quotas = EXCLUDED.total_quotas,
            quota_price  = EXCLUDED.quota_price;
END;
$$;

-- ---------------------------------------------------------------------------
-- Saldo de abertura (genesis). Idempotente por substituição: limpa o genesis
-- anterior e relança. A composição (lotes) dá lastro real ao PL e aos resgates;
-- as cotas por irmão definem apenas a divisão da participação.
--
--   p_lots:   [{ "bond_id": uuid, "quantity": num, "price": num }, ...]
--   p_quotas: [{ "profile_id": uuid, "quotas": num, "amount": num }, ...]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_opening_balance(
    p_admin_id UUID,
    p_date DATE,
    p_lots JSONB,
    p_quotas JSONB
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
    v_amount NUMERIC;
BEGIN
    PERFORM pap_require_admin(p_admin_id);

    -- Substitui o genesis anterior (lotes de abertura não têm transação amarrada;
    -- transações de abertura não têm lote apontando para elas).
    DELETE FROM fund_bond_lots WHERE is_opening = TRUE;
    DELETE FROM transactions WHERE is_opening = TRUE;

    -- Carteira em D0 → lotes reais. O preço de D0 vira a base de custo do IR.
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

        INSERT INTO fund_bond_lots
            (transaction_id, bond_id, purchase_date, purchase_price, quantity, is_active, is_opening)
        VALUES
            (NULL, v_bond_id, p_date, v_price, v_qty, TRUE, TRUE);

        -- Semeia o preço corrente quando o catálogo ainda não foi precificado, para
        -- o painel já mostrar algo antes do primeiro fechamento diário (o job sobrescreve).
        UPDATE treasury_bonds
        SET current_price = v_price
        WHERE id = v_bond_id AND current_price IS NULL;
    END LOOP;

    -- Cotas de abertura por irmão → transações de abertura (APORTE/APPROVED).
    FOR v_q IN SELECT * FROM jsonb_array_elements(COALESCE(p_quotas, '[]'::jsonb))
    LOOP
        v_quotas := (v_q->>'quotas')::NUMERIC;
        v_amount := COALESCE((v_q->>'amount')::NUMERIC, 0);

        IF v_quotas IS NULL OR v_quotas <= 0 THEN
            RAISE EXCEPTION 'Cotas de abertura inválidas: %', v_q;
        END IF;

        INSERT INTO transactions
            (profile_id, type, status, amount_brl, quota_price, quotas_amount,
             event_date, is_opening)
        VALUES
            ((v_q->>'profile_id')::UUID, 'APORTE', 'APPROVED',
             v_amount,
             CASE WHEN v_quotas > 0 THEN ROUND(v_amount / v_quotas, 6) ELSE 1 END,
             v_quotas, p_date, TRUE);
    END LOOP;

    -- Snapshot imediato com o estado novo (usa current_price; se ainda nulo, o lote
    -- fica de fora até o fechamento diário).
    PERFORM recalculate_pl(CURRENT_DATE);
END;
$$;

-- ---------------------------------------------------------------------------
-- register_aporte: quantidade + VALOR TOTAL aportado (R$) + data. O preço unitário
-- do lote (base de custo do IR) é derivado = valor / quantidade. DROP da versão
-- original (4 args, preço unitário) implantada no schema base.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS register_aporte(UUID, UUID, NUMERIC, NUMERIC);

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
    v_remaining NUMERIC;
    v_ob RECORD;
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

    -- Baixa greedy das obrigações pendentes mais antigas que couberem no aporte.
    v_remaining := v_amount;
    FOR v_ob IN
        SELECT id, amount_expected
        FROM monthly_obligations
        WHERE profile_id = p_profile_id AND status = 'PENDING'
        ORDER BY reference_month ASC, id ASC
    LOOP
        EXIT WHEN v_remaining < v_ob.amount_expected;
        UPDATE monthly_obligations SET status = 'PAID' WHERE id = v_ob.id;
        v_remaining := v_remaining - v_ob.amount_expected;
    END LOOP;

    RETURN v_txn_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- rebuild_fund_history — o replay. Reseta a carteira ao estado emitido (abertura
-- ativa; lotes de aporte INATIVOS, entram quando seu evento é processado para a
-- cota de entrada refletir a carteira anterior ao aporte), percorre os eventos
-- APROVADOS por event_date recomputando cotas pela cota do dia, e emite a série
-- diária de pl_history até hoje. Abertura mantém as cotas dadas; confia nos valores
-- gravados (resgate: queima pelo amount_brl; despesa: liquida pela quantity).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rebuild_fund_history(p_admin_id UUID)
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
    PERFORM pap_require_admin(p_admin_id);

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
            -- Confia no bruto gravado p/ a queima e na quantidade p/ o FIFO.
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
            WHERE id = v_ev.id;   -- quotas_amount permanece 0 (Regra de Ouro)
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
-- delete_transaction (admin) — remove um lançamento equivocado. Seguro para
-- APORTE (apaga o lote vinculado). Reverter saídas (restaurar lotes liquidados)
-- depende do replay (rebuild_fund_history).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_transaction(
    p_admin_id UUID,
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
    PERFORM pap_require_admin(p_admin_id);

    SELECT * INTO v_txn FROM transactions WHERE id = p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transação % não encontrada.', p_transaction_id;
    END IF;

    IF v_txn.type <> 'APORTE' THEN
        RAISE EXCEPTION 'Por ora só APORTE pode ser removido; reverter saídas exige o rebuild.';
    END IF;

    DELETE FROM fund_bond_lots WHERE transaction_id = p_transaction_id;
    DELETE FROM transactions WHERE id = p_transaction_id;
END;
$$;

GRANT EXECUTE ON FUNCTION set_opening_balance(UUID, DATE, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION register_aporte(UUID, UUID, NUMERIC, NUMERIC, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION rebuild_fund_history(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_transaction(UUID, UUID) TO authenticated;
