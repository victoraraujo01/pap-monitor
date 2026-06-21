// Semeia os cotistas de avaliação no Supabase LOCAL após um `db:reset`.
//
// Cria as contas via Admin API (service_role) com `name` e `role` no
// user_metadata — o trigger handle_new_user popula public.profiles com o papel
// correto (admin já como ADMIN). Idempotente: contas já existentes são ignoradas.
//
// Uso: npm run db:seed   (exige o Supabase local de pé — npm run db:start)
//
// Cenário (senha paplocal123 p/ todos):
//   admin@pap.local  → ADMIN
//   ana@pap.local    → COTISTA
//   bruno@pap.local  → COTISTA

import { execSync } from 'node:child_process'

const PASSWORD = 'paplocal123'
const USERS = [
  { email: 'admin@pap.local', name: 'Admin', role: 'ADMIN' },
  { email: 'ana@pap.local', name: 'Ana', role: 'COTISTA' },
  { email: 'bruno@pap.local', name: 'Bruno', role: 'COTISTA' },
]

// Lê URL da API e a service_role key do `supabase status` (sem hardcode).
function localConfig() {
  const raw = execSync('supabase status -o json', { encoding: 'utf8' })
  const cfg = JSON.parse(raw)
  const url = cfg.API_URL ?? cfg.api_url
  const key = cfg.SERVICE_ROLE_KEY ?? cfg.service_role_key
  if (!url || !key) {
    throw new Error('Não achei API_URL/SERVICE_ROLE_KEY no `supabase status`.')
  }
  return { url, key }
}

async function main() {
  const { url, key } = localConfig()

  for (const u of USERS) {
    const res = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        email: u.email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { name: u.name, role: u.role },
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (res.ok) {
      console.log(`✓ ${u.email} (${u.role})`)
    } else if (
      res.status === 422 ||
      String(body.msg ?? body.error_description ?? '')
        .toLowerCase()
        .includes('already')
    ) {
      console.log(`• ${u.email} já existe — ignorado`)
    } else {
      console.error(`✗ ${u.email}: ${res.status} ${JSON.stringify(body)}`)
      process.exitCode = 1
    }
  }
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
