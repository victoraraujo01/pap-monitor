// Popula bond_price_history no Supabase LOCAL com o histórico de preços do Tesouro.
//
// Por que existe: `npm run db:reset` e a suíte de testes ZERAM bond_price_history.
// Sem ela, o hint "Preço unit. D0" (saldo de abertura) e o rebuild histórico ficam
// cegos. Este script sobe a Edge Function daily-pl localmente, dispara o modo
// `?mode=backfill` (baixa o CSV oficial do Tesouro e faz UPSERT em lotes) e derruba a
// função ao final. Idempotente (ON CONFLICT no UPSERT).
//
// Uso: npm run db:backfill   (exige o Supabase local de pé — npm run db:start)

import { spawn } from 'node:child_process'

const FN_URL = 'http://127.0.0.1:54321/functions/v1/daily-pl?mode=backfill'
const READY = 'Serving functions on'
const SERVE_TIMEOUT_MS = 60_000
const BACKFILL_TIMEOUT_MS = 300_000

function waitForReady(proc) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timeout esperando a função subir.')),
      SERVE_TIMEOUT_MS,
    )
    const onData = (buf) => {
      if (buf.toString().includes(READY)) {
        clearTimeout(timer)
        proc.stdout?.off('data', onData)
        proc.stderr?.off('data', onData)
        // Pequena folga para o runtime/Kong assentarem.
        setTimeout(resolve, 1500)
      }
    }
    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)
    proc.on('exit', (code) =>
      reject(new Error(`A função encerrou antes de subir (código ${code}).`)),
    )
  })
}

async function main() {
  console.log('• Subindo a Edge Function daily-pl…')
  const serve = spawn(
    'npx',
    ['supabase', 'functions', 'serve', 'daily-pl', '--no-verify-jwt'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )

  try {
    await waitForReady(serve)
    console.log('• Rodando o backfill (baixa o CSV do Tesouro, ~13MB)…')

    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), BACKFILL_TIMEOUT_MS)
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t))

    const body = await res.json().catch(() => ({}))
    if (!res.ok || body.error) {
      throw new Error(`Backfill falhou: ${res.status} ${JSON.stringify(body)}`)
    }
    console.log(
      `✓ ${body.rows_upserted} preços gravados (de ${body.rows_parsed} lidos).`,
    )
  } finally {
    serve.kill('SIGTERM')
  }
}

main().catch((err) => {
  console.error(`✗ ${err.message ?? err}`)
  process.exit(1)
})
