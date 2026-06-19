-- Initial schema — Fundo PAP (Projeto Aposentadoria Pais)
-- Transcrito literalmente de docs/03_DATABASE_SCHEMA.md
-- Estrutura com Catálogo de Títulos (Registry) e Integridade Referencial.
-- Sem RLS: sistema de uso privado pelos 3 cotistas, todos veem todos os registros.

CREATE TYPE user_role AS ENUM ('COTISTA', 'ADMIN');
CREATE TYPE obligation_status AS ENUM ('PENDING', 'PAID');
CREATE TYPE transaction_type AS ENUM ('APORTE', 'RESGATE_PESSOAL', 'DESPESA_PAIS');
CREATE TYPE transaction_status AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

CREATE TABLE profiles (
    id UUID REFERENCES auth.users(id) PRIMARY KEY,
    name TEXT NOT NULL,
    role user_role DEFAULT 'COTISTA'
);

CREATE TABLE monthly_obligations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID REFERENCES profiles(id) NOT NULL,
    reference_month DATE NOT NULL,
    amount_expected NUMERIC(15, 2) DEFAULT 1000.00,
    status obligation_status DEFAULT 'PENDING'
);

-- NOVA TABELA: Catálogo Central de Títulos (Gerenciado pelo Admin / Job)
CREATE TABLE treasury_bonds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_reference_name TEXT UNIQUE NOT NULL, -- O nome exato que a B3/API usa (Ex: "Tesouro IPCA+ 2035")
    display_name TEXT, -- Nome amigável para o frontend (Opcional)
    current_price NUMERIC(15, 6), -- Atualizado diariamente pelo job
    is_available_for_purchase BOOLEAN DEFAULT TRUE, -- Controle de governança do Admin
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID REFERENCES profiles(id),
    type transaction_type NOT NULL,
    status transaction_status DEFAULT 'APPROVED',
    amount_brl NUMERIC(15, 2) NOT NULL,
    quota_price NUMERIC(15, 6) NOT NULL,
    quotas_amount NUMERIC(15, 6) NOT NULL,
    approved_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- A Carteira do Fundo agora usa Foreign Key para o Catálogo
CREATE TABLE fund_bond_lots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID REFERENCES transactions(id),
    bond_id UUID REFERENCES treasury_bonds(id) NOT NULL, -- RELACIONAMENTO FORTE
    purchase_date DATE NOT NULL,
    purchase_price NUMERIC(15, 6) NOT NULL,
    quantity NUMERIC(15, 6) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE pl_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL UNIQUE,
    total_pl_brl NUMERIC(15, 2) NOT NULL,
    total_quotas NUMERIC(15, 6) NOT NULL,
    quota_price NUMERIC(15, 6) NOT NULL
);
