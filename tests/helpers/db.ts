import { Pool } from 'pg'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/services/supabase/database.types'

// Defaults do Supabase local (chaves demo determinísticas). Sobrescreva via env
// se necessário (ex.: CI com outra instância).
const DB_URL =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const API_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

// Pool direto para fixtures e leituras de asserção (SQL cru).
export const pool = new Pool({ connectionString: DB_URL })

// Cliente tipado, mesma interface que o front usa, para exercer as RPCs.
export const supabase = createClient<Database>(API_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

/** Reseta o estado operacional preservando o catálogo (treasury_bonds). */
export async function resetDb(): Promise<void> {
  // profiles CASCADE arrasta transactions, fund_bond_lots e monthly_obligations.
  // bond_price_history é estado compartilhado (consultado por pap_price_on) e
  // precisa ser limpo, senão preços de um teste vazam para outro.
  await pool.query('TRUNCATE pl_history, bond_price_history, profiles CASCADE')
  await pool.query("DELETE FROM auth.users WHERE email LIKE '%@paptest.com'")
}

/** Cria um usuário em auth.users (o trigger gera o profile) e devolve o id. */
export async function createUser(
  name: string,
  role: 'COTISTA' | 'ADMIN' = 'COTISTA',
): Promise<string> {
  const email = `${name.toLowerCase()}@paptest.com`
  const meta = JSON.stringify({ name, ...(role === 'ADMIN' ? { role } : {}) })
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
     VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1, $2::jsonb, now(), now())
     RETURNING id`,
    [email, meta],
  )
  return rows[0].id
}

/** id do título do catálogo pelo api_reference_name. */
export async function bondId(apiReferenceName: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM treasury_bonds WHERE api_reference_name = $1',
    [apiReferenceName],
  )
  return rows[0].id
}

/** Cria N obrigações mensais PENDING para um cotista (meses consecutivos). */
export async function seedObligations(
  profileId: string,
  months: string[],
  amount = 1000,
): Promise<void> {
  for (const month of months) {
    await pool.query(
      `INSERT INTO monthly_obligations (profile_id, reference_month, amount_expected)
       VALUES ($1, $2, $3)`,
      [profileId, month, amount],
    )
  }
}

/** Helper de leitura: primeira linha de uma query parametrizada. */
export async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await pool.query<T>(sql, params)
  return rows[0]
}

export async function num(
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  const { rows } = await pool.query<{ v: string | number | null }>(sql, params)
  return Number(rows[0]?.v ?? 0)
}
