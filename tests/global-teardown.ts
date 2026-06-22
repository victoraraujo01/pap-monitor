// Teardown global da suíte (vitest globalSetup): ao FIM do run, remove os usuários
// de teste (@paptest.com) criados por createUser. O resetDb já os apaga no início de
// cada teste, mas sem isto a última leva (joao/maria) fica pendurada no auth depois do
// run e polui a lista de cotistas do ambiente de avaliação. Best-effort: se o banco
// local não estiver de pé (ex.: rodando só testes de UI sem DB), apenas ignora.

import { Pool } from 'pg'

const DB_URL =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

export async function teardown(): Promise<void> {
  const pool = new Pool({ connectionString: DB_URL })
  try {
    await pool.query(
      "DELETE FROM public.profiles WHERE id IN (SELECT id FROM auth.users WHERE email LIKE '%@paptest.com')",
    )
    await pool.query("DELETE FROM auth.users WHERE email LIKE '%@paptest.com'")
  } catch {
    // Banco indisponível: nada a limpar.
  } finally {
    await pool.end().catch(() => {})
  }
}
