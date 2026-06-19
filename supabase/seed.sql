-- Seed do Catálogo Central de Títulos (treasury_bonds).
-- api_reference_name = nome exato usado pela API do Tesouro Direto (chave de busca
-- do job diário). current_price é semente inicial p/ dev — o job sobrescreve.
-- Idempotente: re-aplica sem duplicar (ON CONFLICT no UNIQUE api_reference_name).

INSERT INTO treasury_bonds (api_reference_name, display_name, current_price, is_available_for_purchase)
VALUES
    ('Tesouro Selic 2027',        'Tesouro Selic 2027',        15234.560000, TRUE),
    ('Tesouro Selic 2029',        'Tesouro Selic 2029',        14987.120000, TRUE),
    ('Tesouro Prefixado 2027',    'Tesouro Prefixado 2027',      812.430000, TRUE),
    ('Tesouro Prefixado 2031',    'Tesouro Prefixado 2031',      612.080000, TRUE),
    ('Tesouro IPCA+ 2029',        'Tesouro IPCA+ 2029',         3456.780000, TRUE),
    ('Tesouro IPCA+ 2035',        'Tesouro IPCA+ 2035',         2210.940000, TRUE),
    ('Tesouro IPCA+ 2045',        'Tesouro IPCA+ 2045',         1320.510000, TRUE),
    ('Tesouro Prefixado 2025',    'Tesouro Prefixado 2025 (encerrado)', 998.700000, FALSE)
ON CONFLICT (api_reference_name) DO NOTHING;
