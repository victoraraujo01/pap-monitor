-- ---------------------------------------------------------------------------
-- Item 4 do REFACTOR_PLAN — helper único de IR / valor líquido.
--
-- A fórmula "valor líquido = bruto − IR sobre o lucro positivo (faixa por dias)"
-- estava copiada em 3 funções (recalculate_pl, pap_portfolio_net_value,
-- reinvestment_source_proceeds). Uma mudança na regra fiscal precisava ser feita em
-- 3 lugares e podia divergir. Centraliza-se a EXPRESSÃO num helper puro por lote;
-- cada caller MANTÉM sua própria fonte de preço e seus filtros (a divergência de
-- filtro/clamp entre as funções é intencional e NÃO é unificada aqui).
-- ---------------------------------------------------------------------------

-- Valor líquido de uma fatia de lote: bruto (qty × preço) menos IR sobre o ganho
-- positivo (qty × (preço − custo)), na faixa de `p_days`. Espelha exatamente o
-- miolo que estava nas 3 cópias — não clampa qty nem days (o caller decide).
CREATE OR REPLACE FUNCTION pap_lot_net_value(
    p_qty NUMERIC,
    p_price NUMERIC,
    p_cost_price NUMERIC,
    p_days INT
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_qty * p_price
           - CASE WHEN p_qty * (p_price - p_cost_price) > 0
                  THEN p_qty * (p_price - p_cost_price) * pap_ir_rate(p_days)
                  ELSE 0 END;
$$;

-- ---------------------------------------------------------------------------
-- recalculate_pl — usa current_price; dias = (p_date − purchase_date) SEM clamp;
-- NÃO filtra purchase_date <= p_date. Só o miolo da soma passa a chamar o helper.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recalculate_pl(p_date DATE DEFAULT CURRENT_DATE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pl NUMERIC(15, 2);
    v_total_quotas NUMERIC(15, 6);
    v_quota_price NUMERIC(15, 6);
BEGIN
    -- Valor líquido (bruto menos IR sobre o lucro) somado sobre os lotes ativos.
    SELECT COALESCE(SUM(
        pap_lot_net_value(
            l.quantity, b.current_price, l.purchase_price,
            (p_date - l.purchase_date)::INT
        )
    ), 0)
    INTO v_pl
    FROM fund_bond_lots l
    JOIN treasury_bonds b ON b.id = l.bond_id
    WHERE l.is_active = TRUE
      AND b.current_price IS NOT NULL;

    SELECT COALESCE(SUM(quotas_amount), 0)
    INTO v_total_quotas
    FROM transactions
    WHERE status = 'APPROVED';

    v_quota_price := CASE
        WHEN v_total_quotas > 0 THEN v_pl / v_total_quotas
        ELSE pap_latest_quota_price()
    END;

    INSERT INTO pl_history (date, total_pl_brl, total_quotas, quota_price)
    VALUES (p_date, v_pl, v_total_quotas, v_quota_price)
    ON CONFLICT (date) DO UPDATE
        SET total_pl_brl = EXCLUDED.total_pl_brl,
            total_quotas = EXCLUDED.total_quotas,
            quota_price  = EXCLUDED.quota_price;
END;
$$;
GRANT EXECUTE ON FUNCTION recalculate_pl(DATE) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- pap_portfolio_net_value — usa pap_price_on (fallback purchase_price); filtra
-- purchase_date <= p_date; dias com GREATEST(...,0). Só o miolo chama o helper.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pap_portfolio_net_value(p_date DATE)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(SUM(
        pap_lot_net_value(
            l.quantity,
            COALESCE(pap_price_on(l.bond_id, p_date), l.purchase_price),
            l.purchase_price,
            GREATEST((p_date - l.purchase_date)::INT, 0)
        )
    ), 0)
    FROM fund_bond_lots l
    WHERE l.is_active = TRUE
      AND l.purchase_date <= p_date;
$$;

-- ---------------------------------------------------------------------------
-- reinvestment_source_proceeds — FIFO por lote da origem. Precisa de bruto E IR
-- separados no JSON, então deriva o IR do helper: ir_lote = bruto_lote − net_lote.
-- Corpo idêntico ao da …220000, só o cálculo de IR por lote passa pelo helper.
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
    v_lot_gross NUMERIC;
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
        v_lot_gross := v_units * v_unit_price;
        v_gross := v_gross + v_lot_gross;
        -- IR do lote = bruto − líquido (helper centraliza a faixa de IR sobre o ganho).
        v_ir := v_ir + (
            v_lot_gross
            - pap_lot_net_value(v_units, v_unit_price, v_lot.purchase_price, v_days)
        );
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
