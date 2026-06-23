-- Distinção compra/venda no histórico de preços do Tesouro.
--
-- O CSV do Tesouro Transparente traz, por título/data, tanto o PU de COMPRA (o que
-- o investidor paga ao adquirir o título) quanto o PU de VENDA/RESGATE (o que ele
-- recebe ao resgatar) — há um spread entre os dois. Até aqui só guardávamos o PU
-- Venda (correto para valorizar o PL e o resgate, que é o que o fundo realiza), mas
-- a sugestão de preço do APORTE (que é uma COMPRA) também vinha do lado venda → o
-- número sugerido ficava sistematicamente abaixo do que a B3 cobrou. Agora guardamos
-- as DUAS pontas e a UI escolhe o lado conforme a operação: compra para aporte e
-- destinos de reinvestimento; venda para resgate/despesa/valorização do PL.
--
-- `price` permanece = PU Venda (não migra; PL, pap_price_on e o motor de replay
-- ficam intactos). `buy_price` é aditiva e NULLABLE (linhas antigas, ou título sem
-- PU Compra publicado, ficam NULL → a UI cai no PU Venda como fallback). Nenhuma
-- função de cálculo do banco usa buy_price: a compra grava o valor digitado pelo
-- cotista (qtd + valor total), então o preço de compra é só uma sugestão de tela.

ALTER TABLE bond_price_history ADD COLUMN IF NOT EXISTS buy_price NUMERIC(15, 6);

-- update_bond_price_history agora também grava buy_price (opcional por linha). O
-- filtro de validade segue só sobre `price` (a venda é a verdade do PL); buy_price
-- ausente entra como NULL.
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
               (e->>'price')::NUMERIC AS price,
               NULLIF(e->>'buy_price', '')::NUMERIC AS buy_price
        FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) e
        JOIN treasury_bonds b ON b.api_reference_name = e->>'name'
        WHERE (e->>'price') ~ '^[0-9]+(\.[0-9]+)?$'
    )
    INSERT INTO bond_price_history (bond_id, date, price, buy_price)
    SELECT bond_id, date, price, buy_price FROM incoming
    ON CONFLICT (bond_id, date)
        DO UPDATE SET price = EXCLUDED.price, buy_price = EXCLUDED.buy_price;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION update_bond_price_history(JSONB) TO authenticated, service_role;
