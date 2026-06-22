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
npm run db:seed       # recria os cotistas de avaliação (admin/ana/bruno) no DB local
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
│   ├── dashboards/            # Casos de Uso 5, 6, 7 + RecentEvents (prévia de lançamentos)
│   ├── aportes/               # Caso de Uso 2 (registro de aporte) — usa register_aporte
│   ├── aprovacoes/            # Casos de Uso 3, 4 (saídas/aprovação) — request_withdrawal etc.
│   ├── historico/            # /historico — livro completo: filtros + editar/remover lançamentos
│   └── admin/                # /admin (só ADMIN) — saldo de abertura + rebuild do histórico
├── services/supabase/
│   ├── client.ts              # createClient<Database> tipado; importe o `supabase` daqui
│   ├── index.ts               # reexports: supabase, Tables/Insert/Update, enums
│   └── database.types.ts      # GERADO por `npm run gen:types` — NÃO editar à mão
├── lib/
│   ├── format.ts              # formatBRL / formatQuotas / formatDate (pt-BR)
│   └── events.ts              # EventRow/EVENT_SELECT/TYPE_LABELS + canManageEvent (admin|dono)
└── types/                     # tipos compartilhados (vazio)
```

Roteamento em `src/App.tsx` (react-router): `/login` e `/signup` públicas;
`/`, `/aportes`, `/aprovacoes`, `/historico`, `/admin` dentro de `<ProtectedRoute>`
→ `<AppLayout>`. A nav fica em 3 destinos primários (Painel/Aportes/Resgates) +
Admin condicional; `/historico` é acessado pelo botão "Ver tudo" da prévia de
lançamentos no painel. As views protegidas usam `useAuth()` para
`profile.id`/`profile.role`.

Import: use o alias `@` → `src/` (ex.: `import { supabase } from '@/services/supabase'`).

## Schema do banco (resumo — autoritativo em `docs/03` e na migração)

Enums: `user_role(COTISTA|ADMIN)`, `obligation_status(PENDING|PAID)`,
`transaction_type(APORTE|RESGATE_PESSOAL|DESPESA_PAIS)`,
`transaction_status(PENDING_APPROVAL|APPROVED|REJECTED)`.

- `profiles` — 1:1 com `auth.users`; tem `role`.
- `monthly_obligations` — faturas mensais por cotista (default R$1000). O `status` é
  vestigial; usa-se `status_override` (override manual) + status derivado nas views.
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
Cria `transaction`, gera cotas pela última cotação e grava `fund_bond_lots`. (A
adimplência NÃO é mais baixada aqui — virou saldo acumulado + status derivado, ver
"Adimplência por saldo acumulado".)

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
- `delete_transaction(p_caller_id, p_transaction_id)` — remove QUALQUER lançamento
  (admin ou o próprio dono); roda o replay automático ao final. Bloqueia abertura.
- `update_transaction(p_caller_id, p_transaction_id, p_bond_id, p_quantity,
  p_amount_brl, p_event_date)` — edita campos completos (admin ou dono); reescreve o
  lote do APORTE e roda o replay. Bloqueia abertura.
- `recalculate_pl(p_date default current_date)` (CdU 1 — parte de banco; chamada
  pela Edge Function após o UPSERT de preços)
- `update_bond_prices(p_prices jsonb) → int` (CdU 1 — UPSERT de `current_price`;
  recebe `{chave: preço}`, casa por `api_reference_name`, retorna nº atualizado)
- Helpers internos: `pap_ir_rate`, `pap_latest_quota_price`, `pap_liquidate_fifo`,
  `pap_run_daily_pl` (dispara a Edge Function via `pg_net`, agendada no `pg_cron`),
  `pap_require_admin_or_owner` (gate admin-ou-dono), `pap_rebuild_history` (corpo do
  replay SEM gate, reusado por `rebuild_fund_history`/`delete_transaction`/
  `update_transaction`).

**Convenções da implementação (não quebrar):**
- `transactions.quotas_amount` é **delta assinado** no saldo do cotista: APORTE `+`,
  RESGATE_PESSOAL `−` (queima), DESPESA_PAIS `0`. `total_quotas` do fundo =
  `SUM(quotas_amount)` sobre `status='APPROVED'`. Patrimônio individual usa o mesmo SUM
  por `profile_id`.
- Coluna **aditiva** `transactions.target_bond_id` (não está em docs/03): guarda o
  título a liquidar, necessária p/ aprovar uma DESPESA_PAIS pendente.
- **Bootstrap da cota = R$1,00** quando `pl_history` está vazio.
- **Adimplência = saldo acumulado + status mensal derivado** (não há mais baixa por
  aporte). `monthly_obligations` só congela o `amount_expected` de cada mês; o status
  efetivo e o saldo vêm de views (`v_monthly_obligations`/`v_cotista_balance`). Ver
  "Adimplência por saldo acumulado".
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

## Identidade visual ("livro-razão claro" — sálvia/verde)

Tema **claro** coeso, paleta sálvia/verde (ref. Vistiq), ainda na metáfora de
cédula/certificado gravado. Mantenha a consistência ao criar telas novas (Etapa D).

> **ARMADILHA — leia antes de usar tokens:** os **nomes** dos tokens de cor foram
> herdados de um tema escuro anterior ("livro-razão esmeralda"), mas hoje **guardam
> valores claros**. Use-os pelo **papel semântico**, NUNCA pelo significado literal
> do nome. Em particular: **`brass` NÃO é mais dourado — é o VERDE de acento.**
> `void` = tinta carvão (NÃO é fundo escuro). `moss`/`raised` = branco (superfície
> de cartão). Não "conserte" um nome achando que está errado; troque só o valor em
> `tailwind.config.js` se a paleta mudar.

- **Paleta** (em `tailwind.config.js`, valores atuais):
  - **Superfícies:** `moss`/`raised` = **branco** (cartões); `pine` = menta pálida
    (`#DCEAE1`, painéis/realces sutis); fundo da página vem do `body` (gradiente
    sálvia, ~`#eef3ef`), não de um token.
  - **Texto:** `bone` = principal (carvão `#2C3435`); `bone-dim` = secundário
    (sálvia-grafite); `sage` = terciário/rótulos.
  - **Acentos:** **`brass`/`brass-bright`** = **VERDE** (`#4A7256`/`#5C8A68`) —
    ações primárias, filetes, foco; **`emerald`** = positivo/crescimento;
    **`clay`** = negativo/saída (vermelho-tijolo).
  - **Filete:** `line` = carvão translúcido (`rgba(44,52,53,0.12)`); `void` = tinta
    carvão profunda (texto sobre acentos, se preciso).
- **Tipografia**: `font-display` = **Fraunces** (títulos, serifa), `font-sans` =
  **Hanken Grotesk** (corpo, é o default), `font-mono` = **Spline Sans Mono**.
  **Todo valor monetário/numérico usa a classe `.nums`** (mono + tabular-nums).
- **Classes utilitárias** (em `index.css`): `.nums`, `.eyebrow` (rótulos em
  versalete espaçado — **não** chamar de `.overline`, colide com a utility nativa
  do Tailwind `text-decoration-line: overline`), `.rule-brass` (filete **verde**,
  apesar do nome). Fundo atmosférico (gradientes sálvia + textura de guilhochê) está
  no `body`/`body::before`; `color-scheme: light`.
- **Componentes base** em `src/components/ui.tsx` (`Card`, `Field`, `NumberInput`,
  `Select`, `Button`, `Alert`) — reutilize-os; sempre via tokens, nunca cores cruas
  (`slate-*`, hex soltos).
- **Movimento**: revelação na carga via `animate-rise` (+ `animationDelay` inline
  para escalonar). Fontes carregadas por `<link>` no `index.html`.
- **Layout responsivo do header** (`AppLayout.tsx`): nav SEM hambúrguer (só 3
  destinos primários, sempre visíveis). No desktop (`sm+`) marca · abas · cotista
  numa linha; no mobile (`<sm`) as abas descem para uma 2ª linha full-width
  (`flex-1`), via duas `<nav>` alternadas por `sm:hidden`/`hidden sm:flex`. Mantém
  o filete brass da aba ativa nos dois tamanhos.

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
**Deploy concluído:** Vercel (front) + Supabase (DB/Edge Function).
**Etapa D (Dashboards CdU 5–7) concluída:** tudo dentro da rota Painel
(`src/views/dashboards/`), sem inflar a nav (3 destinos). `FundEvolution.tsx`
(CdU 5: métricas PL/cota com sparkline a partir de `pl_history` + composição da
carteira via `fund_bond_lots × treasury_bonds`); `MyPatrimony.tsx` (CdU 6:
patrimônio = cotas líquidas APPROVED × última cota, extrato e adimplência por
`monthly_obligations`); `Participation.tsx` (CdU 7: fatia por cotista =
cotas/total + aportado líquido). Gráficos próprios em `charts.tsx`
(`Sparkline` SVG + `BarList` CSS) — SEM lib externa, paleta sálvia/verde. 3 testes
de UI em `tests/dashboards.test.tsx`. `build`/`lint`/`test` (30 testes) verdes.

**Etapa D-hist Fase 1 (Histórico — saldo de abertura + eventos datados) concluída:**
migração `20260620120000_opening_balance_and_dated_events.sql`. Torna `transactions`
um log de eventos: colunas aditivas `event_date`, `quantity` (unidades — compradas
no aporte, liquidadas nas saídas; deixa a baixa da carteira exata/independente de
preço no replay futuro) e `is_opening`; `fund_bond_lots.is_opening`. RPCs novas/
alteradas: `set_opening_balance(admin, date, lots[], quotas[])` (genesis idempotente
por substituição — carteira em D0 vira lotes reais que dão lastro a PL/resgate, cotas
por irmão definem a participação; semeia `current_price` quando nulo e chama
`recalculate_pl`); `register_aporte`/`request_withdrawal` ganharam `p_event_date`
(DROP+recreate por mudança de assinatura); `approve_expense` grava a `quantity`
liquidada; `pap_require_admin` (gate); `delete_transaction` (à época: admin + só
APORTE — depois ampliado, ver "Gestão de eventos no histórico"). UI: `src/views/admin/` (`/admin`, gateada
por role ADMIN, link de nav condicional) com saldo de abertura + gestão/remoção de
eventos; `AportesView` ganhou campo de data retroativa só para admin; primitivos
`DateInput` e `required` configurável em `NumberInput`/`DateInput`. Testes:
`tests/opening-balance.test.ts` (8) + `tests/admin.test.tsx` (2). 40 testes verdes.
- **Importante (path-dependence):** aportes/saídas datados no PASSADO ainda geram/
  queimam cotas pela cota CORRENTE — a cota histórica justa só vem com o replay.

**Etapa D-hist Fase 2 (Curva histórica / rebuild) concluída:** migração
`20260620130000_history_rebuild.sql`. Tabela `bond_price_history(bond_id, date,
price)` (alimentada pelo modo backfill da Edge Function) + `fund_bond_lots.
original_quantity` (qtd EMITIDA, imutável via trigger `pap_set_original_quantity`;
o FIFO mexe só em `quantity`). Helpers: `update_bond_price_history(jsonb)` (UPSERT
por `api_reference_name`), `pap_price_on(bond,date)` (carry-forward), `pap_portfolio_
net_value(date)` (valor líquido por data, IR por dias até a data; filtra por
`is_active`, não por purchase_date), `pap_emit_pl(date,total_quotas)`.
**`rebuild_fund_history(admin)`** = replay cronológico: `TRUNCATE pl_history`; reseta
lotes (`quantity=original_quantity`, abertura ativa, **lotes de aporte INATIVOS**);
percorre eventos APPROVED em ordem, recomputa `quotas_amount` pela cota do dia
(abertura mantém as cotas dadas), liquida FIFO nas saídas, e emite série diária de
PL/cota até hoje. **Truque-chave de corretude:** o lote do aporte é ativado SÓ depois
de fixada a cota de entrada → a cota reflete a carteira anterior ao aporte (vale até
p/ múltiplos aportes no mesmo dia). Edge Function `daily-pl` ganhou `?mode=backfill`
(usa `parseTesouroHistory` → carrega TODO o histórico do CSV em lotes de 5000). UI:
botão "Reconstruir histórico" na AdminView. Testes: `rebuild.test.ts` (4) +
parser history em `prices.test.ts`. **46 testes verdes**; build/lint ok.
- **safeupdate no Supabase local:** `DELETE`/`UPDATE` sem `WHERE` são barrados —
  usar `TRUNCATE` / `WHERE TRUE` em funções (vide rebuild).
- **Avaliação local:** `.env.local` (gitignored) aponta o front p/ Supabase local;
  cotistas recriados por `npm run db:seed` (`scripts/seed-local.mjs`, idempotente, lê
  a service key do `supabase status`): admin@pap.local (ADMIN) / ana@ / bruno@, senha
  paplocal123. Rodar após cada `db:reset` (que zera auth + dados).

**Saída por quantidade + data (migração `20260620140000_withdrawal_quantity.sql`):**
`request_withdrawal` reordenada/ampliada — `(profile, bond, type, amount DEFAULT,
quantity DEFAULT, event_date DEFAULT)`. Aceita **valor OU quantidade** (a quantidade
é a verdade do que sai da carteira); converte R$↔unidades pelo **preço da DATA do
evento** (`pap_price_on`, fallback `current_price`). `approve_expense` liquida pela
`quantity` registrada (ou deriva pelo preço da data da despesa, não a de hoje).
UI `AprovacoesView`: seletor "valor/quantidade" + campo de data (admin). Chamadas do
front são por args NOMEADOS (reordenação é segura). Testes em `opening-balance.test.ts`
(resgate por qtd + retroativo pelo preço da data). `resetDb` agora também trunca
`bond_price_history` (estado compartilhado lido por `pap_price_on`). **48 testes verdes.**
- **Gotcha:** após `db:reset`, o PostgREST local pode servir schema em cache por
  alguns segundos (chamadas de RPC com assinatura nova falham com P0001/404
  transitório); rodar a suíte de novo resolve.

**Captura quantidade + valor total (migração `20260620150000_capture_qty_and_gross.sql`):**
simetria fiel entre aporte e resgate. `register_aporte(profile, bond, quantity,
AMOUNT_BRL total, event_date)` — agora recebe o **valor total aportado** (não o preço
unitário); o preço unitário do lote = `valor/quantidade` (derivado). `request_withdrawal`:
RESGATE_PESSOAL exige **quantidade + valor bruto** (ambos guardados como verdade — nada
derivado de preço de referência); DESPESA segue dirigida pelo valor (unidades liquidadas
na aprovação). `rebuild_fund_history` passa a **confiar nos valores gravados**: queima de
cotas do resgate usa o `amount_brl` guardado e o FIFO usa a `quantity` guardada (não
reconverte por preço). UI: AportesView (campo "Valor total aportado", preview vira preço
médio/unidade); AprovacoesView (resgate = quantidade + valor bruto; despesa = só valor;
removido o toggle valor/quantidade). Por quê: PL depende só das unidades restantes, mas a
queima de cotas (justiça) depende do valor bruto real — guardar os dois evita aproximação
pelo nosso preço e espelha o aporte (qtd + preço). **48 testes verdes.**

**Fluxo de saída unificado (migração `20260620160000_unified_withdrawal_flow.sql`):**
toda saída é sinalizada igual — `request_withdrawal(profile, bond, quantity, amount_brl,
type, event_date DEFAULT hoje, p_direct DEFAULT false)` — com quantidade + valor bruto +
data; a **data pode ser informada por qualquer cotista** (não é mais campo de admin).
Três caminhos: (1) **RESGATE_PESSOAL direto** (qualquer cotista) nasce APPROVED, liquida
FIFO + queima as cotas do próprio; (2) **DESPESA_PAIS proposta** (qualquer cotista) nasce
PENDING e **não é considerada** até classificação — `approve_expense` → despesa (liquida,
ninguém perde cota), `reject_expense` → vira **RESGATE_PESSOAL do solicitante** (liquida +
queima); (3) **DESPESA_PAIS direta** (só admin, `p_direct=true`) nasce APPROVED. Valores/
data são sempre os do **dia da saída**; aprovação é só controle interno que define a
classificação. `reject_expense` deixou de marcar REJECTED — agora reclassifica para resgate.
O `rebuild` não mudou (processa por event_date, ramifica por tipo entre os APPROVED;
pendentes ignorados). UI AprovacoesView: seletor de 3 caminhos (despesa direta só p/ admin),
campos qtd+valor+data p/ todos, botões "Despesa dos pais"/"Resgate pessoal" na classificação.
AportesView: data liberada p/ qualquer cotista. **49 testes verdes.**

**Gestão de eventos no histórico (migração `20260620170000_event_management.sql`):**
o livro de lançamentos saiu do Admin e virou área de todos os cotistas. Backend:
`pap_rebuild_history()` (corpo do replay extraído SEM gate; `rebuild_fund_history`
virou wrapper gateado por admin sobre ela) + `pap_require_admin_or_owner(caller,
owner)`. `delete_transaction` **reescrito** — passou de `(p_admin_id)` admin-only +
só APORTE para `(p_caller_id, p_transaction_id)` **admin OU dono**, **qualquer tipo**,
com **rebuild automático** ao final (reverter saída cai do replay: reseta lotes →
reaplica FIFO). Novo `update_transaction(p_caller_id, txn, bond, quantity, amount,
event_date)` edita campos completos (admin/dono); no APORTE reescreve o lote vinculado
(preço unitário = valor/qtd; `original_quantity` reescrita — o trigger só dispara em
INSERT) e roda o rebuild. Abertura (`is_opening`) é bloqueada em ambos (gerida por
`set_opening_balance`). UI: `src/views/historico/` (`/historico`) com filtros
(cotista/tipo/período) + tabela com Editar/Remover; botões **desabilitados** quando o
cotista não é dono (admin sempre habilitado) — regra em `lib/events.ts`
`canManageEvent`. Prévia dos 5 últimos no painel (`dashboards/RecentEvents.tsx`) com
"Ver tudo →". Seção "Eventos lançados" removida do AdminView. **52 testes verdes**
(delete por dono/admin, replay restaurando lote de saída removida, edição de aporte,
permissão negada). Nota: o rebuild automático depende de `bond_price_history`
(backfill) para a curva sair correta — sem ele usa carry-forward, igual ao botão
"Reconstruir histórico".

**Alterações em batch no histórico (migração `20260620180000_batch_event_changes.sql`):**
o `/historico` virou um **rascunho local**: o cotista empilha criações, edições e
remoções, vê tudo refletido inline na tabela, e só ao "Salvar alterações" envia o lote
numa **única transação** com **um** rebuild (em vez de N rebuilds, um por operação).
Backend: cores extraídos SEM rebuild (`pap_delete_transaction_core`,
`pap_update_transaction_core`); `delete_transaction`/`update_transaction` viraram
**wrappers** = core + `pap_rebuild_history()` (API single-op preservada). Nova RPC
**`apply_event_changes(p_caller_id, p_changes jsonb) → jsonb`**: percorre um array
ordenado de ops `{op: create|update|delete, ...}` (create reusa `register_aporte`/
`request_withdrawal`, cuja cota provisória o rebuild sobrescreve), com gate por item
(`pap_require_admin_or_owner`; despesa direta segue admin-only), e **um** rebuild ao
final. **Atômica:** sub-bloco `EXCEPTION` por item re-RAISE com `ref=<ref>|item N: …` →
rollback total + identificação da linha culpada (tudo-ou-nada). Bônus: lançamentos
criados em batch já saem com a **cota histórica correta** (o rebuild recompõe), sem a
path-dependence "cota corrente" da criação instantânea. UI `src/views/historico/`:
buffer de pendências (linhas riscadas p/ remoção, valores destacados p/ edição, linhas
"novo" p/ criação) + "Desfazer" por linha + barra fixa Salvar/Descartar + modal "Novo
lançamento" (aporte/resgate/despesa; despesa direta só admin). Tipos/helpers de change
em `lib/events.ts` (`EventChange`, `parseFailedRef`). `AportesView`/`AprovacoesView`
NÃO mudam (criação instantânea segue fora do histórico). Testes:
`tests/event-batch.test.ts` (batch misto, rollback atômico, permissão) +
`tests/historico-batch.test.tsx` (staging → 1 rpc, desfazer, erro mantém rascunho).
**58 testes verdes**; build/lint ok.

**Obrigações mensais (migração `20260620190000_monthly_obligations.sql`):**
nada criava `monthly_obligations` (a tabela só tinha defaults; `register_aporte` só
dava baixa nas pendentes), então a adimplência ficava sempre vazia. Agora um gerador
**idempotente** ancorado na **data de início do fundo** (derivada de
`min(event_date) WHERE is_opening`): índice único `(profile_id, reference_month)`;
`pap_generate_obligations(amount)` (interno, sem gate) cria 1 fatura PENDING por
**todo cotista** × mês, da abertura até o mês corrente, `ON CONFLICT DO NOTHING` (não
duplica nem sobrescreve corrigidas); `generate_monthly_obligations(admin, amount
DEFAULT 1000)` (wrapper gateado, valor configurável); `set_obligation_status(admin,
id, status)` (correção manual PAID↔PENDING — não havia como corrigir status pela UI
antes, só a baixa do aporte); `pg_cron` mensal (dia 1) reusa o gerador interno com o
último valor usado (fallback 1000). **Decisão de produto:** meses retroativos nascem
PENDING; o admin reconcilia na UI os que já foram contribuídos. UI: seção "Obrigações
mensais" na `AdminView` (valor editável + Gerar + tabela cotista/mês/valor/status com
toggle, filtro por cotista, contador pendentes/pagas). `seed-sim.mjs` passou a usar o
gerador + reconciliar os meses aportados. Testes: `tests/obligations.test.ts` (geração
idempotente, gate admin, set_status, exige abertura). **63 testes verdes**; build/lint ok.

**Adimplência por saldo acumulado (migração `20260620200000_obligation_balance.sql`):**
o modelo binário PAID/PENDING casado por VALOR exato (baixa greedy no `register_aporte`:
`EXIT WHEN v_remaining < amount_expected`) brigava com preço de título não fechar
redondo — aporte de R$980 deixava o mês PENDING (faltou R$20), troco sumia, dois
aportes parciais nunca quitavam — e o `status` só era setado na criação (o rebuild
ignorava → frágil). Trocado por **duas lentes derivadas de `transactions`** (sempre
consistentes com o rebuild): (1) **saldo total** do cotista, dinheiro exato =
`Σ amount_expected − Σ aportado` (sobra rola como crédito, falta acumula); (2) **status
mensal** por **cobertura FIFO acumulada** — o total aportado preenche os meses do mais
antigo pro mais novo; mês *m* quitado ⟺ `total_aportado ≥ 0,90 × Σ(amount_expected até m)`
(quitar 5 atrasados num aporte só pinta os 5 de verde retroativamente). A tabela
`monthly_obligations` permanece só para **congelar o `amount_expected`** de cada mês (é o
que permite mudar o valor mensal no futuro SEM reescrever o passado). Backend: coluna
`status_override` (NULL=automático; admin força PAID/PENDING p/ casos fora do sistema);
views `v_monthly_obligations` (status efetivo = `COALESCE(override, regra FIFO-90%)`,
expõe `cum_expected`/`total_paid`) e `v_cotista_balance` (`total_expected`/`total_paid`/
`balance`), ambas com GRANT SELECT; `set_obligation_status` agora grava o override
(`p_status` com **DEFAULT NULL** — omitir limpa o override / volta ao automático);
`register_aporte` perdeu o loop de baixa. O `paid` das views exclui `is_opening` (saldo
de abertura é genesis, não contribuição mensal). UI: `MyPatrimony` mostra saldo
devedor/crédito + meses em aberto; `AdminView` tabela com tag "manual" + botão "Auto"
p/ limpar override (descrição atualizada p/ a regra dos 90%). `seed-sim.mjs` largou a
reconciliação manual (status agora deriva dos aportes reais). Testes:
`tests/obligations.test.ts` (FIFO-90% R$980/R$800, quitação de atrasados, abertura não
conta, override+limpar) + `engine.test.ts` ajustado p/ a view. **67 testes verdes**;
build/lint ok.

**Próxima:**
- **E —** GitHub Action de keep-alive (ping HTTP a cada 3 dias).
- Deploy das migrações Fase 1/2 + Edge Function no Supabase de produção (rodar o
  backfill `?mode=backfill` 1x e depois o rebuild) — ainda NÃO feito.
