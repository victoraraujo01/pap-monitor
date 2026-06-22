import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Testes de integração da lógica de banco (Casos de Uso 1-4) rodam contra o
// Supabase LOCAL (precisa de `npm run db:start`), em ambiente `node`. Os testes
// de componentes/views React usam jsdom via `// @vitest-environment jsdom` no
// topo do arquivo; o plugin-react habilita o JSX nesses testes.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['./tests/setup-dom.ts'],
    // Remove os usuários de teste (@paptest.com) ao fim do run (ver o arquivo).
    globalSetup: ['./tests/global-teardown.ts'],
    // Tudo bate no mesmo banco; sem paralelismo entre arquivos para evitar
    // corrida na limpeza/estado global (total_quotas, pl_history por data).
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
