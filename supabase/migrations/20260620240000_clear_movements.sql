-- Limpar todas as movimentações (reset do livro-razão, preservando o catálogo).
--
-- Ação destrutiva do painel admin ("Gestão de histórico"): zera TODO o livro de
-- movimentações do fundo — aportes, resgates/despesas, reinvestimentos, o saldo de
-- abertura (genesis) e as obrigações mensais — e apaga a série diária de pl_history.
--
-- Preserva apenas:
--   - treasury_bonds          (catálogo central, governado pelo admin)
--   - bond_price_history      (preços históricos diários por título — caros de
--                              recarregar, vêm do backfill da Edge Function)
--
-- Depois de limpar, o fundo volta ao estado "sem histórico": refazer o saldo de
-- abertura (set_opening_balance) recompõe tudo. Gate de admin obrigatório.
CREATE OR REPLACE FUNCTION clear_all_movements(p_admin_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM pap_require_admin(p_admin_id);

    -- Lotes antes das transações (FK transaction_id). safeupdate local barra DELETE
    -- sem WHERE — usa-se WHERE TRUE / TRUNCATE.
    DELETE FROM fund_bond_lots WHERE TRUE;
    DELETE FROM monthly_obligations WHERE TRUE;
    DELETE FROM transactions WHERE TRUE;
    TRUNCATE pl_history;
END;
$$;

GRANT EXECUTE ON FUNCTION clear_all_movements(UUID) TO authenticated;
