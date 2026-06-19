# CLAUDE.md — Fundo PAP

Guia para agentes trabalhando neste repositório. Leia inteiro antes de implementar.

## O que é

Sistema do **Fundo de Investimento Familiar PAP (Projeto Aposentadoria Pais)**.
Três irmãos (cotistas) aportam mensalmente em títulos do Tesouro Direto, comprando
"cotas" do fundo. Um motor interno cruza diariamente um **Catálogo Central de
Títulos** com preços de API e a tabela regressiva de IR para recalcular o
**Patrimônio Líquido (PL) Consolidado** e o **Valor da Cota**.

> **Fonte da verdade do produto:** a pasta `docs/` (4 arquivos). Sempre que houver
> dúvida de regra de negócio ou schema, leia `docs/` — não confie só neste resumo.
> Em caso de ambiguidade na documentação, **pergunte antes de assumir**.

## Stack (inegociável)

- **Frontend:** Vite + React 19 + TypeScript + Tailwind CSS v3. Hospedagem: Vercel.
- **Backend/DB:** Supabase (PostgreSQL + Auth + Edge Functions Deno/TS).
- **Cálculo/regras:** Supabase Edge Functions acionadas via `pg_cron`.
- **Keep-alive:** GitHub Actions com ping HTTP a cada 3 dias (NÃO processa dados).
- **Pacotes:** `npm`.

## Comandos

```bash
npm run dev           # Vite dev server
npm run build         # tsc -b && vite build (typecheck + build de produção)
npm run lint          # eslint
npm run format        # prettier --write .   (docs/ e database.types.ts são ignorados)
npm run format:check  # prettier --check .
npm run test          # vitest run (testes de integração do banco — exige DB local de pé)
npm run test:watch    # vitest (modo watch)

npm run db:start      # supabase start (precisa de Docker rodando)
npm run db:stop       # supabase stop
npm run db:reset      # supabase db reset (reaplica migrações do zero)
npm run gen:types     # regenera src/services/supabase/database.types.ts do DB local
```

Para subir o DB local: abra o Docker Desktop (`open -a Docker`), depois `npm run db:start`.
Studio: http://127.0.0.1:54323 · API local: http://127.0.0.1:54321

## Estrutura

```
docs/                          # Especificação (FONTE DA VERDADE) — não editar/formatar
supabase/
├── migrations/                # SQL versionado:
│   ├── ...initial_schema.sql      # transcreve docs/03
│   ├── ...auth_profiles_trigger.sql  # handle_new_user → profiles no signup
│   ├── ...pl_engine_and_rpcs.sql     # motor de PL + RPCs dos CdU 1-4 (ver abaixo)
│   └── ...daily_pl_schedule.sql      # update_bond_prices + pg_cron/pg_net + app_config
├── functions/
│   └── daily-pl/              # Edge Function do CdU 1 (Deno):
│       ├── index.ts               # fetch CSV Tesouro → update_bond_prices → recalculate_pl
│       └── prices.ts              # parser puro do CSV do Tesouro (testado no Vitest)
└── seed.sql                   # catálogo treasury_bonds (idempotente)
tests/
├── helpers/db.ts              # pg p/ fixtures+limpeza, supabase-js p/ as RPCs
├── setup-dom.ts               # jest-dom/vitest (matchers) p/ testes de componente
├── engine.test.ts             # 16 testes de integração dos CdU 1-4 (Vitest)
├── prices.test.ts             # parser do CSV do Tesouro (CdU 1) — node, sem rede
├── auth-ui.test.tsx           # testes de UI (jsdom): ProtectedRoute + LoginView
└── views.test.tsx            # testes de UI (jsdom): Aportes/Aprovações → RPCs
src/
├── context/                  # Autenticação (separado p/ react-refresh):
│   ├── auth-context.ts            # Context + tipo AuthState (sem JSX)
│   ├── AuthProvider.tsx           # provider: sessão + perfil + onAuthStateChange
│   └── useAuth.ts                 # hook useAuth() (lança fora do provider)
├── components/
│   ├── ProtectedRoute.tsx        # guarda de rota (loading/sem sessão → /login)
│   ├── AppLayout.tsx             # shell: header + NavLinks + Sair + <Outlet/>
│   └── ui.tsx                    # primitivos: Card/Field/NumberInput/Select/Button/Alert
├── views/
│   ├── auth/                  # LoginView, SignupView (e helpers AuthShell/Field)
│   ├── dashboards/            # Casos de Uso 5, 6, 7 (histórico fundo/individual, comparativo)
│   ├── aportes/               # Caso de Uso 2 (registro de aporte) — usa register_aporte
│   └── aprovacoes/            # Casos de Uso 3, 4 (saídas/aprovação) — request_withdrawal etc.
├── services/supabase/
│   ├── client.ts              # createClient<Database> tipado; importe o `supabase` daqui
│   ├── index.ts               # reexports: supabase, Tables/Insert/Update, enums
│   └── database.types.ts      # GERADO por `npm run gen:types` — NÃO editar à mão
├── lib/
│   └── format.ts              # formatBRL / formatQuotas / formatDate (pt-BR)
└── types/                     # tipos compartilhados (vazio)
```

Roteamento em `src/App.tsx` (react-router): `/login` e `/signup` públicas;
`/`, `/aportes`, `/aprovacoes` dentro de `<ProtectedRoute>` → `<AppLayout>`. As
views protegidas usam `useAuth()` para `profile.id`/`profile.role`.

Import: use o alias `@` → `src/` (ex.: `import { supabase } from '@/services/supabase'`).

## Schema do banco (resumo — autoritativo em `docs/03` e na migração)

Enums: `user_role(COTISTA|ADMIN)`, `obligation_status(PENDING|PAID)`,
`transaction_type(APORTE|RESGATE_PESSOAL|DESPESA_PAIS)`,
`transaction_status(PENDING_APPROVAL|APPROVED|REJECTED)`.

- `profiles` — 1:1 com `auth.users`; tem `role`.
- `monthly_obligations` — faturas mensais por cotista (default R$1000), `status`.
- `treasury_bonds` — **Catálogo Central** (gerido pelo Admin). `api_reference_name`
  (UNIQUE, chave de busca na API), `current_price` (atualizado pelo job),
  `is_available_for_purchase` (governança).
- `transactions` — APORTE / RESGATE_PESSOAL / DESPESA_PAIS, com `quotas_amount`,
  `quota_price`, `approved_by`.
- `fund_bond_lots` — carteira do fundo; FK forte para `treasury_bonds.bond_id`;
  `quantity`, `purchase_price`, `purchase_date`, `is_active`.
- `pl_history` — snapshot diário: `total_pl_brl`, `total_quotas`, `quota_price`.

## Regras de negócio que NÃO podem se perder

**Tabela regressiva de IR** (sobre o rendimento de cada lote):
- ≤180 dias: 22,5% · 181–360: 20,0% · 361–720: 17,5% · >720 dias: 15,0%
- `Rendimento = (qty × current_price) − (qty × purchase_price)`

**Cálculo diário do PL (CdU 1 — Edge Function + procedure):**
1. UPSERT `current_price` em `treasury_bonds` a partir da API do Tesouro.
2. Para cada lote ativo: valor bruto = `quantity × current_price`; aplica IR sobre o
   lucro → valor líquido do lote.
3. `novo_pl_global_brl` = soma dos líquidos. Salva em `pl_history` o
   `quota_price = PL / total de cotas aprovadas`.

**Aporte (CdU 2):** dropdown só com `treasury_bonds` onde `is_available_for_purchase=true`.
Cria `transaction`, gera cotas pela última cotação, grava `fund_bond_lots`, e dá baixa
(`PAID`) nas `monthly_obligations` pendentes mais antigas.

**Saída (CdU 3) — duas naturezas:**
- `RESGATE_PESSOAL`: nasce `APPROVED`; aplica **FIFO** reduzindo `quantity` dos lotes
  mais antigos daquele título; **queima as cotas do solicitante** equivalentes ao bruto.
- `DESPESA_PAIS`: nasce `PENDING_APPROVAL`; **nada** é liquidado/queimado até aprovação.

**Aprovação de despesa (CdU 4):** seta `APPROVED` + `approved_by`; aplica FIFO liquidando
o necessário. **Regra de Ouro: nenhuma cota de nenhum irmão é queimada** — o PL total cai
e o valor da cota cai proporcionalmente para todos no próximo cálculo diário.

**Dashboards (CdU 5–7):** evolução de PL/cota (`pl_history`); extrato + patrimônio
individual (`cotas × última cota`) + adimplência; comparativo de participação
(`cotas individuais / total de cotas`) e composição da carteira.

## Camada de banco JÁ IMPLEMENTADA (use estas RPCs no front — não duplicar a lógica)

Toda a lógica de cotas+lotes vive no banco para garantir atomicidade. O front
**chama RPCs** (`supabase.rpc(...)`) e **lê tabelas direto** (sem RLS); nunca
escreve nas tabelas operacionais por fora das RPCs.

- `register_aporte(p_profile_id, p_bond_id, p_quantity, p_purchase_price) → uuid` (CdU 2)
- `request_withdrawal(p_profile_id, p_bond_id, p_amount_brl, p_type) → uuid` (CdU 3;
  `p_type` = `RESGATE_PESSOAL` | `DESPESA_PAIS`)
- `approve_expense(p_transaction_id, p_approver_id)` / `reject_expense(...)` (CdU 4)
- `recalculate_pl(p_date default current_date)` (CdU 1 — parte de banco; chamada
  pela Edge Function após o UPSERT de preços)
- `update_bond_prices(p_prices jsonb) → int` (CdU 1 — UPSERT de `current_price`;
  recebe `{chave: preço}`, casa por `api_reference_name`, retorna nº atualizado)
- Helpers internos: `pap_ir_rate`, `pap_latest_quota_price`, `pap_liquidate_fifo`,
  `pap_run_daily_pl` (dispara a Edge Function via `pg_net`, agendada no `pg_cron`).

**Convenções da implementação (não quebrar):**
- `transactions.quotas_amount` é **delta assinado** no saldo do cotista: APORTE `+`,
  RESGATE_PESSOAL `−` (queima), DESPESA_PAIS `0`. `total_quotas` do fundo =
  `SUM(quotas_amount)` sobre `status='APPROVED'`. Patrimônio individual usa o mesmo SUM
  por `profile_id`.
- Coluna **aditiva** `transactions.target_bond_id` (não está em docs/03): guarda o
  título a liquidar, necessária p/ aprovar uma DESPESA_PAIS pendente.
- **Bootstrap da cota = R$1,00** quando `pl_history` está vazio.
- **Baixa de obrigações no aporte = greedy por valor** (quita as pendentes mais antigas
  enquanto o valor do aporte cobrir).
- As RPCs de escrita são `SECURITY DEFINER`; há `GRANT SELECT ON ALL TABLES ... TO
  anon, authenticated` para os dashboards lerem. Nova tabela ⇒ relembrar o GRANT SELECT.
  **Exceção:** `app_config` (segredos do cron) NÃO recebe GRANT — fica trancada.
- **service_role não tem GRANT direto nas tabelas** (nem local nem por padrão). Por
  isso a Edge Function (que usa a service key) escreve via RPC `update_bond_prices`,
  não por `from('treasury_bonds').update(...)` — isso dá `permission denied`.

## CdU 1 — Edge Function `daily-pl` (Etapa B)

Fechamento diário 100% no Supabase. `supabase/functions/daily-pl/index.ts`:
1. **Fetch** do CSV de Preços e Taxas do **Tesouro Transparente** (oficial,
   gratuito, **sem token**; ~13MB com todo o histórico). Parser puro em
   `prices.ts` (testado sem rede): filtra **só Tesouro Selic e IPCA+**, fica com a
   **Data Base mais recente** de cada título e usa **PU Venda Manha** (resgate,
   fallback PU Base → PU Compra).
2. **UPSERT** via `update_bond_prices` — chave = nome derivado `"<Tipo Titulo>
   <ano de vencimento>"` (ex.: `Tesouro Selic 2027`, que casa com o
   `api_reference_name` do seed).
3. **`recalculate_pl()`**.

Acionamento: `pg_cron` (dias úteis 21:00 UTC) → `pap_run_daily_pl()` → `pg_net`
`http_post` na URL da função. Config por ambiente na tabela `app_config`
(`daily_pl_function_url`, `daily_pl_cron_secret`) — **vazia localmente** (o cron
vira no-op). A função tem `verify_jwt = false` e se protege por `PAP_CRON_SECRET`
(header `x-pap-cron-secret`) quando setado.

**Env da função (prod):** `supabase secrets set PAP_CRON_SECRET=...` e popular
`app_config` (ver comentário na migração). `SUPABASE_URL`/
`SUPABASE_SERVICE_ROLE_KEY` são injetadas pelo runtime. A fonte de preços é
pública (sem token).

**Decisão de fonte:** a API de Tesouro da brapi exige plano pago (Pro) → trocada
pelo CSV gratuito do Tesouro Transparente. O endpoint B3 público antigo
(`treasurybondsinfo.json`) está **410**.

**Testar local:** `supabase functions serve daily-pl --env-file <env>` apontando
`TESOURO_API_URL` para um mock servindo um CSV no mesmo formato (8 colunas `;`,
ex.: o próprio arquivo `PrecoTaxaTesouroDireto.csv`); POST em
`/functions/v1/daily-pl`.

## Decisões e convenções deste projeto

- **Sem RLS** por decisão do dono: uso privado por 3 cotistas, todos veem tudo.
- **`docs/` é imutável e está no `.prettierignore`.** Prettier já achatou a indentação
  do SQL em `docs/03` uma vez — nunca rode formatador sobre `docs/`. Trate como spec.
- `database.types.ts` é gerado (`gen:types`) e ignorado por prettier/eslint; não editar.
- `.env` (local, gitignored) tem `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
  Modelo em `.env.example`. Vite só expõe vars com prefixo `VITE_`.
- Estilo: Prettier (`semi:false`, `singleQuote`, `trailingComma:all`, printWidth 80).
- **Testes:** Vitest. Testes de banco em `tests/` exigem o Supabase local de pé
  (`npm run db:start`). Padrão: `pg` para fixtures/limpeza, `supabase-js` para exercer
  as RPCs. Testes de componentes React usam o mesmo runner com
  `// @vitest-environment jsdom` por arquivo + `@testing-library/react`; mockar
  `@/services/supabase` com `vi.mock` (não bater no banco). Matchers via
  `tests/setup-dom.ts` (`@testing-library/jest-dom/vitest`) em `test.setupFiles`.
- Antes de considerar uma tarefa pronta: `npm run build` (typecheck) + `npm run lint`
  (+ `npm run test` quando mexer no banco) — tudo verde.

## Estado atual / roadmap

**Feito:** scaffold front (Tailwind, ESLint+Prettier, cliente Supabase tipado);
migrações aplicadas no DB local + tipos gerados; **trigger de `profiles` no signup**;
**motor de PL + RPCs dos CdU 1–4** (ver seção "Camada de banco JÁ IMPLEMENTADA");
**seed do catálogo**; **suíte Vitest (16 testes) dos CdU 1–4**.
**Etapa A (Auth + Shell) concluída:** react-router; `AuthProvider`/`useAuth`;
`ProtectedRoute` + `AppLayout`; telas de login/cadastro; placeholders das views;
2 testes de UI (jsdom).
**Etapa B (Edge Function CdU 1) concluída:** `daily-pl` (fetch CSV Tesouro
Transparente → RPC `update_bond_prices` → `recalculate_pl`); `pg_cron`/`pg_net` +
`app_config`; parser testado. Ver seção "CdU 1 — Edge Function `daily-pl`".
**Etapa C (Views de operação) concluída:** `AportesView` (CdU 2 → `register_aporte`)
e `AprovacoesView` (CdU 3 → `request_withdrawal`; CdU 4 → `approve_expense`/
`reject_expense`, com a regra "não aprovar a própria"); primitivos de UI em
`components/ui.tsx`; `lib/format.ts`; 3 testes de UI. `build`/`lint`/`test`
(27 testes) verdes.

**Próxima etapa:** Deploy (Vercel + Supabase) e depois Etapa D (dashboards).

**Etapas seguintes (ordem sugerida, ainda NÃO feitas):**
- **D —** Dashboards (CdU 5–7) lendo `pl_history`/`transactions`/`fund_bond_lots`.
- **E —** GitHub Action de keep-alive (ping HTTP a cada 3 dias).
