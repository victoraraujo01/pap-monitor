-- Motor de PL interno + RPCs transacionais (Casos de Uso 1 a 4).
-- A lógica de cotas + lotes vive no banco para garantir atomicidade.
-- Convenção de cotas: transactions.quotas_amount é um DELTA assinado no saldo do
-- cotista — APORTE positivo (cotas adquiridas), RESGATE_PESSOAL negativo (cotas
-- queimadas), DESPESA_PAIS zero (Regra de Ouro: nenhuma cota é queimada).
-- total_quotas do fundo = SUM(quotas_amount) sobre transações APPROVED.

-- ---------------------------------------------------------------------------
-- Lacuna de schema: docs/03 não carrega o título em transactions, mas o CdU 4
-- precisa saber qual título liquidar ao aprovar uma DESPESA_PAIS pendente (e o
-- CdU 3 já seleciona um bond_id). Adicionamos a coluna de forma aditiva/nullable.
-- ---------------------------------------------------------------------------
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS target_bond_id UUID REFERENCES treasury_bonds(id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Tabela regressiva de IR (docs/02): alíquota sobre o lucro conforme dias corridos.
CREATE OR REPLACE FUNCTION pap_ir_rate(days INTEGER)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN days <= 180 THEN 0.225
        WHEN days <= 360 THEN 0.200
        WHEN days <= 720 THEN 0.175
        ELSE 0.150
    END;
$$;

-- Última cotação conhecida da cota; bootstrap em R$1,00 quando não há histórico.
CREATE OR REPLACE FUNCTION pap_latest_quota_price()
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        (SELECT quota_price FROM pl_history ORDER BY date DESC LIMIT 1),
        1.0
    );
$$;

-- Liquidação FIFO: reduz `quantity` dos lotes ativos mais antigos do título,
-- desativando os zerados. Levanta exceção se a carteira não comporta a quantidade.
CREATE OR REPLACE FUNCTION pap_liquidate_fifo(p_bond_id UUID, p_quantity NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_remaining NUMERIC := p_quantity;
    v_lot RECORD;
BEGIN
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RETURN;
    END IF;

    FOR v_lot IN
        SELECT id, quantity
        FROM fund_bond_lots
        WHERE bond_id = p_bond_id AND is_active = TRUE
        ORDER BY purchase_date ASC, id ASC
        FOR UPDATE
    LOOP
        EXIT WHEN v_remaining <= 0;
        IF v_lot.quantity <= v_remaining THEN
            UPDATE fund_bond_lots
            SET quantity = 0, is_active = FALSE
            WHERE id = v_lot.id;
            v_remaining := v_remaining - v_lot.quantity;
        ELSE
            UPDATE fund_bond_lots
            SET quantity = quantity - v_remaining
            WHERE id = v_lot.id;
            v_remaining := 0;
        END IF;
    END LOOP;

    IF v_remaining > 1e-9 THEN
        RAISE EXCEPTION 'Quantidade insuficiente do título % na carteira (faltam % unidades).',
            p_bond_id, v_remaining;
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- CdU 1 — Cálculo diário do PL (parte de banco; a Edge Function só faz o UPSERT
-- de current_price antes de chamar esta procedure).
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
        sub.gross
        - CASE WHEN sub.gross - sub.cost > 0
               THEN (sub.gross - sub.cost) * pap_ir_rate(sub.days)
               ELSE 0 END
    ), 0)
    INTO v_pl
    FROM (
        SELECT l.quantity * b.current_price        AS gross,
               l.quantity * l.purchase_price       AS cost,
               (p_date - l.purchase_date)::INT      AS days
        FROM fund_bond_lots l
        JOIN treasury_bonds b ON b.id = l.bond_id
        WHERE l.is_active = TRUE
          AND b.current_price IS NOT NULL
    ) sub;

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

-- ---------------------------------------------------------------------------
-- CdU 2 — Registro de aporte (compra de título + geração de cotas + baixa de
-- obrigações pendentes mais antigas, greedy enquanto o valor do aporte cobrir).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION register_aporte(
    p_profile_id UUID,
    p_bond_id UUID,
    p_quantity NUMERIC,
    p_purchase_price NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_bond treasury_bonds;
    v_amount NUMERIC(15, 2);
    v_quota_price NUMERIC(15, 6);
    v_quotas NUMERIC(15, 6);
    v_txn_id UUID;
    v_remaining NUMERIC;
    v_ob RECORD;
BEGIN
    IF p_quantity <= 0 OR p_purchase_price <= 0 THEN
        RAISE EXCEPTION 'Quantidade e preço de compra devem ser positivos.';
    END IF;

    SELECT * INTO v_bond FROM treasury_bonds WHERE id = p_bond_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Título % não encontrado no catálogo.', p_bond_id;
    END IF;
    IF NOT v_bond.is_available_for_purchase THEN
        RAISE EXCEPTION 'Título % não está disponível para compra.', v_bond.api_reference_name;
    END IF;

    v_amount := ROUND(p_quantity * p_purchase_price, 2);
    v_quota_price := pap_latest_quota_price();
    v_quotas := v_amount / v_quota_price;

    INSERT INTO transactions
        (profile_id, type, status, amount_brl, quota_price, quotas_amount, target_bond_id)
    VALUES
        (p_profile_id, 'APORTE', 'APPROVED', v_amount, v_quota_price, v_quotas, p_bond_id)
    RETURNING id INTO v_txn_id;

    INSERT INTO fund_bond_lots
        (transaction_id, bond_id, purchase_date, purchase_price, quantity, is_active)
    VALUES
        (v_txn_id, p_bond_id, CURRENT_DATE, p_purchase_price, p_quantity, TRUE);

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
-- CdU 3 — Solicitação de saída. RESGATE_PESSOAL nasce APPROVED (FIFO + queima de
-- cotas do solicitante). DESPESA_PAIS nasce PENDING_APPROVAL (nada liquidado).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION request_withdrawal(
    p_profile_id UUID,
    p_bond_id UUID,
    p_amount_brl NUMERIC,
    p_type transaction_type
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_bond treasury_bonds;
    v_quota_price NUMERIC(15, 6);
    v_quotas NUMERIC(15, 6);
    v_qty NUMERIC;
    v_balance NUMERIC;
    v_txn_id UUID;
BEGIN
    IF p_type NOT IN ('RESGATE_PESSOAL', 'DESPESA_PAIS') THEN
        RAISE EXCEPTION 'Tipo de saída inválido: %', p_type;
    END IF;
    IF p_amount_brl <= 0 THEN
        RAISE EXCEPTION 'Valor a sacar deve ser positivo.';
    END IF;

    SELECT * INTO v_bond FROM treasury_bonds WHERE id = p_bond_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Título % não encontrado no catálogo.', p_bond_id;
    END IF;

    v_quota_price := pap_latest_quota_price();

    IF p_type = 'DESPESA_PAIS' THEN
        -- Nasce pendente; nenhum lote é liquidado e nenhuma cota é queimada (CdU 3).
        INSERT INTO transactions
            (profile_id, type, status, amount_brl, quota_price, quotas_amount, target_bond_id)
        VALUES
            (p_profile_id, 'DESPESA_PAIS', 'PENDING_APPROVAL', p_amount_brl, v_quota_price, 0, p_bond_id)
        RETURNING id INTO v_txn_id;
        RETURN v_txn_id;
    END IF;

    -- RESGATE_PESSOAL: precisa do preço atual para converter R$ em unidades (FIFO).
    IF v_bond.current_price IS NULL THEN
        RAISE EXCEPTION 'Preço atual do título % indisponível; execute o cálculo diário antes.',
            v_bond.api_reference_name;
    END IF;

    v_qty := p_amount_brl / v_bond.current_price;   -- unidades a liquidar via FIFO
    v_quotas := p_amount_brl / v_quota_price;        -- cotas a queimar (valor bruto)

    SELECT COALESCE(SUM(quotas_amount), 0)
    INTO v_balance
    FROM transactions
    WHERE profile_id = p_profile_id AND status = 'APPROVED';
    IF v_quotas > v_balance + 1e-9 THEN
        RAISE EXCEPTION 'Cotas insuficientes para o resgate (saldo %, requerido %).',
            v_balance, v_quotas;
    END IF;

    PERFORM pap_liquidate_fifo(p_bond_id, v_qty);

    INSERT INTO transactions
        (profile_id, type, status, amount_brl, quota_price, quotas_amount, target_bond_id, approved_by)
    VALUES
        (p_profile_id, 'RESGATE_PESSOAL', 'APPROVED', p_amount_brl, v_quota_price, -v_quotas, p_bond_id, p_profile_id)
    RETURNING id INTO v_txn_id;

    RETURN v_txn_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- CdU 4 — Aprovação de despesa. FIFO liquida o necessário; NENHUMA cota é
-- queimada (Regra de Ouro). O PL cai no próximo cálculo diário, derrubando a
-- cota proporcionalmente para todos.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION approve_expense(
    p_transaction_id UUID,
    p_approver_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_txn transactions;
    v_bond treasury_bonds;
    v_qty NUMERIC;
BEGIN
    SELECT * INTO v_txn FROM transactions WHERE id = p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transação % não encontrada.', p_transaction_id;
    END IF;
    IF v_txn.type <> 'DESPESA_PAIS' THEN
        RAISE EXCEPTION 'Apenas DESPESA_PAIS requer aprovação.';
    END IF;
    IF v_txn.status <> 'PENDING_APPROVAL' THEN
        RAISE EXCEPTION 'Transação % não está pendente (status atual: %).',
            p_transaction_id, v_txn.status;
    END IF;
    IF v_txn.profile_id = p_approver_id THEN
        RAISE EXCEPTION 'A despesa deve ser aprovada por outro cotista.';
    END IF;

    SELECT * INTO v_bond FROM treasury_bonds WHERE id = v_txn.target_bond_id;
    IF NOT FOUND OR v_bond.current_price IS NULL THEN
        RAISE EXCEPTION 'Título alvo da despesa sem preço atual; execute o cálculo diário antes.';
    END IF;

    v_qty := v_txn.amount_brl / v_bond.current_price;
    PERFORM pap_liquidate_fifo(v_txn.target_bond_id, v_qty);

    UPDATE transactions
    SET status = 'APPROVED', approved_by = p_approver_id
    WHERE id = p_transaction_id;
END;
$$;

-- Rejeição de despesa pendente (status REJECTED existe no enum; nada é liquidado).
CREATE OR REPLACE FUNCTION reject_expense(
    p_transaction_id UUID,
    p_approver_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_txn transactions;
BEGIN
    SELECT * INTO v_txn FROM transactions WHERE id = p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transação % não encontrada.', p_transaction_id;
    END IF;
    IF v_txn.type <> 'DESPESA_PAIS' OR v_txn.status <> 'PENDING_APPROVAL' THEN
        RAISE EXCEPTION 'Só é possível rejeitar uma DESPESA_PAIS pendente.';
    END IF;
    IF v_txn.profile_id = p_approver_id THEN
        RAISE EXCEPTION 'A despesa deve ser avaliada por outro cotista.';
    END IF;

    UPDATE transactions
    SET status = 'REJECTED', approved_by = p_approver_id
    WHERE id = p_transaction_id;
END;
$$;

-- Leitura direta das tabelas pelos dashboards (CdU 5-7) — sem RLS, uso privado,
-- todos veem tudo. Escrita acontece só pelas RPCs (SECURITY DEFINER acima).
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;

-- Exposição via PostgREST para usuários autenticados (sem RLS, uso privado).
GRANT EXECUTE ON FUNCTION register_aporte(UUID, UUID, NUMERIC, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION request_withdrawal(UUID, UUID, NUMERIC, transaction_type) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_expense(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_expense(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION recalculate_pl(DATE) TO authenticated, service_role;
