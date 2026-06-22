-- ---------------------------------------------------------------------------
-- Saldo de abertura: a cota de gênese vem do "valor inicial da cota".
--
-- Antes, cada transação de abertura gravava `quota_price = amount/quotas` a partir
-- de um campo "Aportado (R$)" por irmão — dado redigitado à mão que só casava com a
-- cota de gênese por coincidência, e que nem chegava ao backend (o campo "valor
-- inicial da cota" da tela era usado só p/ validar a distribuição no cliente).
--
-- Agora `set_opening_balance` recebe `p_quota_price` (a cota de gênese, igual p/
-- todos) e o usa como `quota_price` de cada transação de abertura; o `amount_brl`
-- (valor de gênese da participação do irmão) é DERIVADO = quotas × cota. Some o
-- input "Aportado (R$)" da UI. DROP+recreate por mudança de assinatura.
--
-- O rebuild não toca no `quota_price` das transações de abertura (ramo is_opening
-- só soma cotas), então o valor gravado aqui sobrevive ao replay.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS set_opening_balance(UUID, DATE, JSONB, JSONB);

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

    -- Snapshot imediato com o estado novo (usa current_price; se ainda nulo, o lote
    -- fica de fora até o fechamento diário).
    PERFORM recalculate_pl(CURRENT_DATE);
END;
$$;

GRANT EXECUTE ON FUNCTION set_opening_balance(UUID, DATE, JSONB, JSONB, NUMERIC) TO authenticated;
