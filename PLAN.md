# PLAN.md — Etapa A: Autenticação + Shell do App

> Plano autossuficiente para retomar do zero. Leia o `CLAUDE.md` inteiro antes
> (especialmente "Camada de banco JÁ IMPLEMENTADA"). Esta etapa **não** mexe no
> banco — só no frontend. Ela desbloqueia todas as telas (Etapas C e D), porque
> aporte/resgate/aprovação e o patrimônio individual precisam saber **quem está
> logado** (`profile.id`, `profile.role`).

## Objetivo

Um app React com sessão Supabase: login/cadastro, proteção de rotas, contexto de
sessão+perfil disponível em todo lugar, e um layout-shell com navegação para as
views (ainda placeholders). Ao final dá pra cadastrar, logar, navegar entre as
áreas protegidas e deslogar.

## Pré-requisitos (verificar antes de começar)

1. Docker + `npm run db:start` (Studio em :54323, API em :54321).
2. `.env` na raiz com `VITE_SUPABASE_URL=http://127.0.0.1:54321` e
   `VITE_SUPABASE_ANON_KEY=<anon key do `npx supabase status`>`. O `client.ts` já
   lança erro se faltarem.
3. **Confirmação de e-mail no local:** checar `supabase/config.toml` em
   `[auth.email]`. Se `enable_confirmations = true`, ou desligue para dev, ou pegue
   o link de confirmação no Mailpit (http://127.0.0.1:54324). Sem isso o `signUp`
   não devolve sessão na hora. Decisão simples p/ dev: `enable_confirmations = false`.

## Dependências a adicionar

```bash
npm i react-router-dom
npm i -D jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

(`jsdom`/testing-library são para os primeiros testes de componente — ver passo 8.)

## Passos

### 1. Roteador e providers no entrypoint
- `src/main.tsx`: envolver `<App/>` com `<BrowserRouter>` e `<AuthProvider>`.
- Manter `StrictMode`.

### 2. Contexto de autenticação  (ATENÇÃO ao lint react-refresh)
A regra `react-refresh/only-export-components` (ativa no `eslint.config.js`)
**quebra se um arquivo exportar componente + não-componente juntos.** Então separe:
- `src/context/auth-context.ts` — cria o `Context` (objeto) e o tipo
  `AuthState { session, profile, loading, signOut }`. Sem JSX.
- `src/context/AuthProvider.tsx` — o componente `<AuthProvider>` que:
  - no mount, `supabase.auth.getSession()` → seta sessão; `loading=false`.
  - `supabase.auth.onAuthStateChange((_e, session) => ...)`; **lembrar de
    `subscription.unsubscribe()` no cleanup**.
  - quando há sessão, busca o perfil:
    `supabase.from('profiles').select('*').eq('id', session.user.id).single()`.
  - expõe `signOut = () => supabase.auth.signOut()`.
- `src/context/useAuth.ts` — hook `useAuth()` que lê o contexto e lança se usado
  fora do provider. (Hook isolado p/ não violar a regra de refresh.)

Tipos: usar `Session` de `@supabase/supabase-js` e `Tables<'profiles'>` de
`@/services/supabase`.

### 3. Rota protegida
- `src/components/ProtectedRoute.tsx`: usa `useAuth()`. Se `loading` → spinner/tela
  de carregando. Se sem `session` → `<Navigate to="/login" replace/>`. Senão
  renderiza `<Outlet/>`.
- (Opcional) `AdminRoute` análogo checando `profile.role === 'ADMIN'` para a futura
  governança do catálogo.

### 4. Telas de auth
- `src/views/auth/LoginView.tsx`: form e-mail+senha → `supabase.auth.signInWithPassword`.
  Mostra erro, estado de loading, redireciona para `/` no sucesso (ou deixa o
  `onAuthStateChange` levar). Link para `/signup`.
- `src/views/auth/SignupView.tsx`: nome+e-mail+senha →
  `supabase.auth.signUp({ email, password, options: { data: { name } } })`.
  **O `data.name` é essencial:** o trigger `handle_new_user` usa
  `raw_user_meta_data->>'name'` para preencher `profiles.name`. Tratar o caso de
  confirmação de e-mail (ver pré-requisito 3).

### 5. Layout-shell
- `src/components/AppLayout.tsx`: cabeçalho com nome do cotista (`profile.name`),
  botão "Sair" (`signOut`), e navegação (react-router `<NavLink>`) para:
  `/` (dashboard), `/aportes`, `/aprovacoes`. Conteúdo via `<Outlet/>`.
  Tailwind, consistente com o estilo atual do `App.tsx`.

### 6. Rotas
Reescrever `src/App.tsx` com `<Routes>`:
- Públicas: `/login`, `/signup`.
- Protegidas (dentro de `<ProtectedRoute>` → `<AppLayout>`):
  - `/` → placeholder do Dashboard (CdU 5–7, Etapa D).
  - `/aportes` → placeholder (CdU 2, Etapa C).
  - `/aprovacoes` → placeholder (CdU 3–4, Etapa C).
- `*` → redireciona para `/`.
Os placeholders podem ser componentes mínimos em `src/views/.../index.tsx`.

### 7. Mover/normalizar placeholders
Criar os componentes de view em `src/views/dashboards/`, `src/views/aportes/`,
`src/views/aprovacoes/` (hoje só `.gitkeep`). Cada um exporta um componente simples
com título — serão preenchidos nas Etapas C/D.

### 8. Testes de componente (primeiros, com jsdom)
- Configurar Testing Library: arquivo `tests/setup-dom.ts` com
  `import '@testing-library/jest-dom'`; referenciar via `test.setupFiles` no
  `vitest.config.ts` **apenas para os testes de componente** (ou usar
  `// @vitest-environment jsdom` no topo do arquivo de teste).
- Teste mínimo: `ProtectedRoute` redireciona para `/login` sem sessão; `LoginView`
  renderiza e valida campos. Mockar o `supabase` (`vi.mock('@/services/supabase')`)
  — **não** bater no banco real nestes testes de UI.
- Manter os testes de banco existentes (`tests/engine.test.ts`) intactos e passando.

## Critérios de aceite

- [ ] `npm run dev`: cadastrar um usuário cria a linha em `auth.users` **e** em
      `public.profiles` (conferir no Studio) com o `name` correto.
- [ ] Login leva ao layout protegido; refresh mantém a sessão; "Sair" volta ao login.
- [ ] Acessar `/aportes` sem sessão redireciona para `/login`.
- [ ] `useAuth()` entrega `profile.id` e `profile.role` nas telas protegidas.
- [ ] `npm run build` + `npm run lint` + `npm run test` **verdes**.

## Gotchas / lembretes

- **react-refresh lint:** separe contexto, provider e hook em arquivos distintos
  (passo 2) — não exporte hook/objeto junto com componente.
- **Cleanup do `onAuthStateChange`:** sempre `unsubscribe` no `useEffect`.
- **Perfil pode chegar depois da sessão:** trate `profile === null` enquanto carrega.
- **Admin:** não há tela de promoção ainda; para testar `role='ADMIN'`, atualizar
  manualmente no Studio/SQL (`UPDATE profiles SET role='ADMIN' WHERE ...`).
- **Sem RLS:** qualquer logado lê tudo (por design). Não adicionar RLS.
- **Alias `@`:** já configurado no Vite e no `vitest.config.ts`.

## Fora de escopo desta etapa (não fazer agora)

- Lógica de aporte/resgate/aprovação nas telas (Etapa C) — as RPCs já existem.
- Dashboards/gráficos (Etapa D).
- Edge Function / `pg_cron` (Etapa B).
- Recuperação de senha, OAuth, convites — manter só e-mail+senha.
