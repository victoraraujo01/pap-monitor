-- Seed do Catálogo Central de Títulos (treasury_bonds).
-- api_reference_name = chave de busca do job diário (Edge Function daily-pl). O
-- parser do Tesouro Transparente deriva o nome "<Tipo Titulo> <ano de vencimento>"
-- (ex.: "Tesouro Selic 2027"), então estes nomes casam direto com o CSV.
-- Escopo (decisão do dono): apenas Tesouro Selic e IPCA+.
-- current_price é semente inicial (PU Venda Manha de 18/06/2026) — o job sobrescreve.
-- Idempotente: re-aplica sem duplicar (ON CONFLICT no UNIQUE api_reference_name).

INSERT INTO treasury_bonds (api_reference_name, display_name, current_price, is_available_for_purchase)
VALUES
    ('Tesouro Selic 2027',  'Tesouro Selic 2027',  19240.110000, TRUE),
    ('Tesouro Selic 2029',  'Tesouro Selic 2029',  19214.900000, TRUE),
    ('Tesouro IPCA+ 2029',  'Tesouro IPCA+ 2029',   3719.270000, TRUE),
    ('Tesouro IPCA+ 2035',  'Tesouro IPCA+ 2035',   2354.710000, TRUE),
    ('Tesouro IPCA+ 2045',  'Tesouro IPCA+ 2045',   1203.210000, TRUE)
ON CONFLICT (api_reference_name) DO NOTHING;
