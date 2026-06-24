-- recalculate_pl — guarda defensiva de data.
--
-- Contexto: recalculate_pl soma os lotes ATIVOS pelo current_price para fechar o PL
-- de p_date. Hoje é chamada sempre com a data CORRENTE (cron diário, Edge Function,
-- set_opening_balance em D0), então todo lote já tem purchase_date <= p_date e o
-- problema nunca se manifesta. Mas, se um dia for chamada com uma data retroativa,
-- ela contaria lotes adquiridos DEPOIS de p_date (com `dias` negativo no cálculo de
-- IR). Adiciona-se o filtro `purchase_date <= p_date` + GREATEST(dias, 0), espelhando
-- pap_portfolio_net_value (usado pelo replay). Sem mudança de comportamento no
-- fechamento diário; apenas blinda chamadas retroativas futuras.
--
-- Corpo idêntico ao de …330000 (helper pap_lot_net_value), só a query da soma muda.

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
    -- Valor líquido (bruto menos IR sobre o lucro) somado sobre os lotes ativos
    -- existentes em p_date.
    SELECT COALESCE(SUM(
        pap_lot_net_value(
            l.quantity, b.current_price, l.purchase_price,
            GREATEST((p_date - l.purchase_date)::INT, 0)
        )
    ), 0)
    INTO v_pl
    FROM fund_bond_lots l
    JOIN treasury_bonds b ON b.id = l.bond_id
    WHERE l.is_active = TRUE
      AND b.current_price IS NOT NULL
      AND l.purchase_date <= p_date;

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
