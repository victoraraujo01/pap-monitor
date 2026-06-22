-- Seed do Catálogo Central de Títulos (treasury_bonds).
-- api_reference_name = chave de busca do job diário (Edge Function daily-pl) E do
-- backfill: o parser do Tesouro Transparente deriva o nome "<Tipo Titulo> <ano de
-- vencimento>" (ex.: "Tesouro Selic 2027"), e update_bond_price_history só grava
-- preço de títulos JÁ cadastrados aqui (casa por api_reference_name). Ou seja: o
-- ?mode=backfill só popula o histórico dos títulos presentes neste seed.
-- Escopo (decisão do dono): apenas Tesouro Selic e IPCA+.
-- Inclui títulos JÁ VENCIDOS (ex.: Selic 2021, IPCA+ 2024): não são compráveis
-- (is_available_for_purchase = FALSE → fora do dropdown de aporte), mas são
-- necessários para montar o saldo de abertura e reconstruir o histórico desde 2020.
-- current_price é semente inicial (PU Venda Manha de 19/06/2026; vencidos = último
-- PU conhecido) — o job diário sobrescreve os ativos.
-- Idempotente: re-aplica sem duplicar (ON CONFLICT no UNIQUE api_reference_name).

INSERT INTO treasury_bonds (api_reference_name, display_name, current_price, is_available_for_purchase)
VALUES
    -- Vencidos (histórico/abertura; não compráveis)
    ('Tesouro Selic 2021',  'Tesouro Selic 2021',  10791.310000, FALSE),
    ('Tesouro Selic 2023',  'Tesouro Selic 2023',  12881.580000, FALSE),
    ('Tesouro Selic 2024',  'Tesouro Selic 2024',  15282.190000, FALSE),
    ('Tesouro Selic 2025',  'Tesouro Selic 2025',  16138.390000, FALSE),
    ('Tesouro Selic 2026',  'Tesouro Selic 2026',  18478.600000, FALSE),
    ('Tesouro IPCA+ 2024',  'Tesouro IPCA+ 2024',   4313.950000, FALSE),
    -- Ativos (compráveis)
    ('Tesouro Selic 2027',  'Tesouro Selic 2027',  19250.240000, TRUE),
    ('Tesouro Selic 2028',  'Tesouro Selic 2028',  19242.840000, TRUE),
    ('Tesouro Selic 2029',  'Tesouro Selic 2029',  19225.040000, TRUE),
    ('Tesouro Selic 2031',  'Tesouro Selic 2031',  19177.520000, TRUE),
    ('Tesouro IPCA+ 2026',  'Tesouro IPCA+ 2026',   4653.880000, TRUE),
    ('Tesouro IPCA+ 2029',  'Tesouro IPCA+ 2029',   3723.880000, TRUE),
    ('Tesouro IPCA+ 2032',  'Tesouro IPCA+ 2032',   2862.990000, TRUE),
    ('Tesouro IPCA+ 2035',  'Tesouro IPCA+ 2035',   2373.120000, TRUE),
    ('Tesouro IPCA+ 2040',  'Tesouro IPCA+ 2040',   1683.420000, TRUE),
    ('Tesouro IPCA+ 2045',  'Tesouro IPCA+ 2045',   1231.360000, TRUE),
    ('Tesouro IPCA+ 2050',  'Tesouro IPCA+ 2050',    876.050000, TRUE)
ON CONFLICT (api_reference_name) DO NOTHING;
