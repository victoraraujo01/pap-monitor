-- Gestão do Catálogo Central de Títulos pelo Admin (UI).
--
-- Problema: o catálogo (treasury_bonds) só era populado pelo seed; nada na
-- aplicação permitia cadastrar um título novo. Como update_bond_prices e
-- update_bond_price_history fazem UPSERT casando por api_reference_name e SÓ
-- atualizam linhas já existentes, um título que aparece no CSV do Tesouro (ex.:
-- um novo vencimento "Tesouro Selic 2032") nunca recebia preço — era parseado e
-- silenciosamente ignorado por não estar no catálogo.
--
-- Solução: RPC gateada por admin para inserir/atualizar um título do catálogo.
-- A descoberta de "quais títulos do Tesouro ainda não estão cadastrados" fica na
-- Edge Function daily-pl (modo ?mode=catalog), que já baixa e parseia o CSV; a UI
-- usa esses candidatos como dropdown, evitando erro de digitação no
-- api_reference_name (que precisa casar EXATAMENTE com o nome derivado pelo parser).

CREATE OR REPLACE FUNCTION upsert_treasury_bond(
    p_admin_id UUID,
    p_api_reference_name TEXT,
    p_display_name TEXT DEFAULT NULL,
    p_is_available BOOLEAN DEFAULT TRUE,
    p_current_price NUMERIC DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id UUID;
    v_name TEXT := btrim(p_api_reference_name);
    v_display TEXT := NULLIF(btrim(p_display_name), '');
BEGIN
    PERFORM pap_require_admin(p_admin_id);

    IF v_name IS NULL OR v_name = '' THEN
        RAISE EXCEPTION 'Nome de referência do título (api_reference_name) é obrigatório.';
    END IF;

    INSERT INTO treasury_bonds (
        api_reference_name, display_name, is_available_for_purchase, current_price
    )
    VALUES (
        v_name,
        COALESCE(v_display, v_name),
        COALESCE(p_is_available, TRUE),
        p_current_price
    )
    ON CONFLICT (api_reference_name) DO UPDATE SET
        -- Mantém o display anterior se nenhum novo for informado.
        display_name = COALESCE(v_display, treasury_bonds.display_name),
        is_available_for_purchase = COALESCE(p_is_available, treasury_bonds.is_available_for_purchase),
        -- NUNCA sobrescreve um preço já conhecido (é território do job diário);
        -- só semeia quando ainda não havia preço.
        current_price = COALESCE(treasury_bonds.current_price, p_current_price),
        updated_at = TIMEZONE('utc', NOW())
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION
    upsert_treasury_bond(UUID, TEXT, TEXT, BOOLEAN, NUMERIC) TO authenticated;
