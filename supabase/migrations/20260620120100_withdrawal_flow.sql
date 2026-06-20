-- Fluxo de saída: sinalização única, valores sempre no dia da saída.
--
-- Toda saída é sinalizada igual (bond + quantidade + valor bruto + data; a data
-- pode ser informada por qualquer cotista). Três caminhos de criação:
--   1. RESGATE_PESSOAL direto (qualquer cotista): nasce APPROVED — liquida via FIFO
--      e queima as cotas do próprio solicitante. Não precisa de aprovação.
--   2. DESPESA_PAIS proposta (qualquer cotista): nasce PENDING_APPROVAL — não é
--      considerada até outro cotista classificar. Aprova → despesa (liquida, ninguém
--      perde cota); Reprova → vira RESGATE_PESSOAL do solicitante (liquida + queima).
--   3. DESPESA_PAIS direta (só admin, p_direct=true): nasce APPROVED como despesa.
-- Os valores e a data são sempre os do DIA DA SAÍDA (event_date), nunca da aprovação.
-- O rebuild (migração anterior) processa por event_date e ramifica por tipo entre os
-- APPROVED; pendentes são ignorados (não considerados). DROP da versão original
-- (4 args, R$ + tipo) implantada no schema base.

DROP FUNCTION IF EXISTS request_withdrawal(UUID, UUID, NUMERIC, transaction_type);

CREATE OR REPLACE FUNCTION request_withdrawal(
    p_profile_id UUID,
    p_bond_id UUID,
    p_quantity NUMERIC,
    p_amount_brl NUMERIC,
    p_type transaction_type,
    p_event_date DATE DEFAULT CURRENT_DATE,
    p_direct BOOLEAN DEFAULT FALSE
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
    v_balance NUMERIC;
    v_amount NUMERIC(15, 2);
    v_txn_id UUID;
BEGIN
    IF p_type NOT IN ('RESGATE_PESSOAL', 'DESPESA_PAIS') THEN
        RAISE EXCEPTION 'Tipo de saída inválido: %', p_type;
    END IF;
    IF COALESCE(p_quantity, 0) <= 0 OR COALESCE(p_amount_brl, 0) <= 0 THEN
        RAISE EXCEPTION 'Saída exige a quantidade de títulos e o valor bruto (R$).';
    END IF;

    SELECT * INTO v_bond FROM treasury_bonds WHERE id = p_bond_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Título % não encontrado no catálogo.', p_bond_id;
    END IF;

    v_amount := ROUND(p_amount_brl, 2);
    v_quota_price := pap_latest_quota_price();   -- provisório; o rebuild recomputa

    -- 2. DESPESA proposta (pendente): nada liquidado/queimado até a classificação.
    IF p_type = 'DESPESA_PAIS' AND NOT p_direct THEN
        INSERT INTO transactions
            (profile_id, type, status, amount_brl, quota_price, quotas_amount,
             target_bond_id, event_date, quantity)
        VALUES
            (p_profile_id, 'DESPESA_PAIS', 'PENDING_APPROVAL', v_amount,
             v_quota_price, 0, p_bond_id, p_event_date, p_quantity)
        RETURNING id INTO v_txn_id;
        RETURN v_txn_id;
    END IF;

    -- 3. DESPESA direta: só admin; nasce aprovada, liquida, ninguém perde cota.
    IF p_type = 'DESPESA_PAIS' AND p_direct THEN
        PERFORM pap_require_admin(p_profile_id);
        PERFORM pap_liquidate_fifo(p_bond_id, p_quantity);
        INSERT INTO transactions
            (profile_id, type, status, amount_brl, quota_price, quotas_amount,
             target_bond_id, approved_by, event_date, quantity)
        VALUES
            (p_profile_id, 'DESPESA_PAIS', 'APPROVED', v_amount, v_quota_price, 0,
             p_bond_id, p_profile_id, p_event_date, p_quantity)
        RETURNING id INTO v_txn_id;
        RETURN v_txn_id;
    END IF;

    -- 1. RESGATE_PESSOAL direto: nasce aprovado, liquida e queima as cotas do solicitante.
    v_quotas := v_amount / v_quota_price;

    SELECT COALESCE(SUM(quotas_amount), 0)
    INTO v_balance
    FROM transactions
    WHERE profile_id = p_profile_id AND status = 'APPROVED';
    IF v_quotas > v_balance + 1e-9 THEN
        RAISE EXCEPTION 'Cotas insuficientes para o resgate (saldo %, requerido %).',
            v_balance, v_quotas;
    END IF;

    PERFORM pap_liquidate_fifo(p_bond_id, p_quantity);

    INSERT INTO transactions
        (profile_id, type, status, amount_brl, quota_price, quotas_amount,
         target_bond_id, approved_by, event_date, quantity)
    VALUES
        (p_profile_id, 'RESGATE_PESSOAL', 'APPROVED', v_amount, v_quota_price,
         -v_quotas, p_bond_id, p_profile_id, p_event_date, p_quantity)
    RETURNING id INTO v_txn_id;

    RETURN v_txn_id;
END;
$$;

GRANT EXECUTE ON FUNCTION
    request_withdrawal(UUID, UUID, NUMERIC, NUMERIC, transaction_type, DATE, BOOLEAN)
    TO authenticated;

-- ---------------------------------------------------------------------------
-- Aprovar uma despesa pendente = confirmar como DESPESA_PAIS. Liquida via FIFO
-- pela quantidade registrada; nenhuma cota é queimada (Regra de Ouro).
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
BEGIN
    SELECT * INTO v_txn FROM transactions WHERE id = p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transação % não encontrada.', p_transaction_id;
    END IF;
    IF v_txn.status <> 'PENDING_APPROVAL' THEN
        RAISE EXCEPTION 'Transação % não está pendente (status atual: %).',
            p_transaction_id, v_txn.status;
    END IF;
    IF v_txn.profile_id = p_approver_id THEN
        RAISE EXCEPTION 'A saída deve ser classificada por outro cotista.';
    END IF;
    IF v_txn.quantity IS NULL OR v_txn.quantity <= 0 THEN
        RAISE EXCEPTION 'Saída sem quantidade de títulos registrada.';
    END IF;

    PERFORM pap_liquidate_fifo(v_txn.target_bond_id, v_txn.quantity);

    UPDATE transactions
    SET type = 'DESPESA_PAIS', status = 'APPROVED', approved_by = p_approver_id
    WHERE id = p_transaction_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Reprovar uma despesa pendente = classificar como RESGATE_PESSOAL do solicitante.
-- Liquida via FIFO pela quantidade e queima as cotas do solicitante (valor bruto).
-- ---------------------------------------------------------------------------
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
    v_quota_price NUMERIC(15, 6);
    v_quotas NUMERIC(15, 6);
    v_balance NUMERIC;
BEGIN
    SELECT * INTO v_txn FROM transactions WHERE id = p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transação % não encontrada.', p_transaction_id;
    END IF;
    IF v_txn.status <> 'PENDING_APPROVAL' THEN
        RAISE EXCEPTION 'Só é possível classificar uma saída pendente.';
    END IF;
    IF v_txn.profile_id = p_approver_id THEN
        RAISE EXCEPTION 'A saída deve ser classificada por outro cotista.';
    END IF;
    IF v_txn.quantity IS NULL OR v_txn.quantity <= 0 THEN
        RAISE EXCEPTION 'Saída sem quantidade de títulos registrada.';
    END IF;

    v_quota_price := pap_latest_quota_price();
    v_quotas := v_txn.amount_brl / v_quota_price;

    SELECT COALESCE(SUM(quotas_amount), 0)
    INTO v_balance
    FROM transactions
    WHERE profile_id = v_txn.profile_id AND status = 'APPROVED';
    IF v_quotas > v_balance + 1e-9 THEN
        RAISE EXCEPTION 'Cotas insuficientes para o resgate (saldo %, requerido %).',
            v_balance, v_quotas;
    END IF;

    PERFORM pap_liquidate_fifo(v_txn.target_bond_id, v_txn.quantity);

    UPDATE transactions
    SET type = 'RESGATE_PESSOAL', status = 'APPROVED', approved_by = p_approver_id,
        quota_price = v_quota_price, quotas_amount = -v_quotas
    WHERE id = p_transaction_id;
END;
$$;
