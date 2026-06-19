import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

// Testes de integração da lógica de banco (Casos de Uso 1-4) rodam contra o
// Supabase LOCAL (precisa de `npm run db:start`). Mais à frente os testes de
// componentes/views React reusam este mesmo runner (com environment jsdom por
// arquivo, via comentário `// @vitest-environment jsdom`).
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Tudo bate no mesmo banco; sem paralelismo entre arquivos para evitar
    // corrida na limpeza/estado global (total_quotas, pl_history por data).
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
