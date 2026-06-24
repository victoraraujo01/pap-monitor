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
npm run db:backfill   # carrega bond_price_history com os preços reais do Tesouro (sobe a
                      #   Edge Function daily-pl ?mode=backfill e derruba ao final)
npm run db:sim        # monta o cenário de avaliação (Victor admin + Ana, saldo de
                      #   abertura) e reconstrói a curva de PL; self-contained/idempotente
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
`transaction_type(APORTE|RESGATE_PESSOAL|DESPESA_PAIS|REINVESTIMENTO)`,
`transaction_status(PENDING_APPROVAL|APPROVED|REJECTED)`.

- `profiles` — 1:1 com `auth.users`; tem `role`.
- `monthly_obligations` — faturas mensais por cotista (default R$1000). A coluna
  legada `status` foi **dropada** (migração `…210200`); usa-se `status_override`
  (override manual) + status derivado nas views (`v_monthly_obligations`).
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
- `register_reinvestment(p_profile_id, p_source_bond_id, p_source_quantity,
  p_targets jsonb, p_event_date) → uuid` — rotação de carteira (vencimento/
  rebalanceamento): liquida a origem (FIFO) e abre **um lote por destino** (`p_targets`
  = `[{bond_id, quantity, amount_brl}, …]`). Uma transação com N lotes; `amount_brl` =
  Σ valores dos destinos; `target_bond_id` = o único destino quando há 1, NULL com
  vários. `quotas_amount=0` (não minta/queima cota), NÃO conta como aporte mensal. Não
  editável (corrige por remover+recriar); `delete` reverte normal.
- `reinvestment_source_proceeds(p_bond_id, p_quantity, p_date) → jsonb` — helper p/ a
  tela do reinvestimento: `{gross, ir, net, available, priced}` da origem resgatada
  (BRUTO = qtd × preço da data; IR via FIFO sobre os lotes, faixa por dias de cada lote;
  LÍQUIDO = bruto − IR). A tela trava `Σdestinos == net` (continuidade de PL).
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
alteradas: `set_opening_balance(admin, date, lots[], quotas[], quota_price)` (genesis
idempotente por substituição — carteira em D0 vira lotes reais que dão lastro a PL/
resgate, cotas por irmão definem a participação; semeia `current_price` quando nulo e
chama `recalculate_pl`; `quota_price` = cota de gênese, ver "Cota de gênese no saldo de
abertura"); `register_aporte`/`request_withdrawal` ganharam `p_event_date`
(DROP+recreate por mudança de assinatura); `approve_expense` grava a `quantity`
liquidada; `pap_require_admin` (gate); `delete_transaction` (à época: admin + só
APORTE — depois ampliado, ver "Gestão de eventos no histórico"). UI: `src/views/admin/` (`/admin`, gateada
por role ADMIN, link de nav condicional) com saldo de abertura + gestão/remoção de
eventos; `AportesView` ganhou campo de data retroativa só para admin; primitivos
`DateInput` e `required` configurável em `NumberInput`/`DateInput`. Testes:
`tests/opening-balance.test.ts` (8) + `tests/admin.test.tsx` (2). 40 testes verdes.
- **Importante (path-dependence):** ~~aportes/saídas datados no PASSADO geram/queimam
  cotas pela cota CORRENTE até o replay~~ — RESOLVIDO: toda RPC de operação roda o
  replay automaticamente (ver "Auto-rebuild nas RPCs de operação"). A cota provisória
  da criação é imediatamente recomposta pela cota histórica do dia.

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
- **Avaliação local:** `.env.local` (gitignored) aponta o front p/ Supabase local. O
  cenário é montado por `npm run db:sim` (`scripts/seed-sim.mjs`, self-contained e
  idempotente): garante os dois cotistas **victor@pap.local (ADMIN) / ana@pap.local**
  (senha paplocal123) — criando-os via Admin API e **upsertando o profile** (conserta o
  caso de o auth.user existir mas o profile ter sido truncado pela suíte de testes) — e
  grava o saldo de abertura + rebuild. Preços reais vêm de `npm run db:backfill` (popula
  `bond_price_history` via Edge Function; rode 1x após `db:reset`/testes, que zeram a
  tabela). O antigo `scripts/seed-local.mjs`/`db:seed` (admin/ana/bruno) foi **aposentado**.

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

**Reinvestimento — novo tipo de operação (migrações `20260620210000_reinvestment_enum.sql`
+ `20260620210100_reinvestment.sql`):** títulos que vencem (ou rebalanceamento) devolvem
caixa que JÁ era do fundo e é reaplicado noutro título. Tratar como APORTE estava errado
em TODOS os eixos: mintava cota nova p/ um cotista (o caixa é coletivo), inflava o PL
(double-count) e — o gatilho do pedido — **sanava obrigação mensal falsamente**. Virou um
4º `transaction_type` **`REINVESTIMENTO`**: rotação de carteira a nível de fundo, toca DOIS
títulos. Coluna aditiva `transactions.source_bond_id` (origem liquidada via FIFO); o
`target_bond_id` é o destino e o lote novo aponta p/ a transação via `transaction_id`
(padrão do APORTE). `quantity` = unidades da origem; `amount_brl` = valor reaplicado no
destino; **`quotas_amount=0`** → `total_quotas` intacto → **cota contínua**; PL conservado
(− valor origem + valor destino). Como as views de adimplência só somam `type='APORTE'`, o
reinvestimento **não conta como contribuição** (de graça). `register_reinvestment` nasce
APPROVED (qualquer cotista). `pap_rebuild_history` ganhou o ramo (ativa lote do destino +
liquida origem, sem mexer em cotas); `apply_event_changes` aceita `kind='REINVESTIMENTO'`;
edição bloqueada (`pap_update_transaction_core`), `delete` reverte pelo replay. UI: card
"Reinvestimento" na AportesView (origem=catálogo completo, destino=comprável); `/historico`
lista + filtra, com Editar desabilitado nessas linhas. **Limpeza junto:** dropada a coluna
vestigial `monthly_obligations.status` (migração `…210200`; status efetivo já vinha da
view). Testes: `tests/reinvestment.test.ts` (PL/cota contínuos, adimplência intacta, delete
restaura, guardas). **73 testes verdes**; build/lint ok.

**Reinvestimento — múltiplos destinos + líquido por IR (migração
`20260620220000_reinvestment_multi_target.sql`):** uma origem podia reaplicar em UM só
destino. Agora reaplica em VÁRIOS, numa única transação REINVESTIMENTO com **N lotes**
(o replay já ativa todos os lotes por `transaction_id` e liquida a origem uma vez — motor
intacto). `register_reinvestment` mudou de assinatura (DROP+recreate): `p_targets jsonb`
= `[{bond_id, quantity, amount_brl}, …]`; `amount_brl` da transação = Σ destinos;
`target_bond_id` = único destino quando há 1, NULL com vários. Novo helper
`reinvestment_source_proceeds(bond, qty, date) → {gross, ir, net, available, priced}`
calcula o LÍQUIDO da origem (bruto − IR FIFO por lote) — espelha `pap_liquidate_fifo` +
a fórmula de IR de `pap_portfolio_net_value`. `apply_event_changes` aceita `targets`
(fallback p/ os campos single antigos). UI `AportesView`: origem (título+qtd) → painel
**bruto → IR → líquido**; lista dinâmica de destinos (add/remover) com soma travada
contra o líquido (±R$0,01) — bloqueia se não bater; removido o "preço médio". `/historico`
mostra **"N títulos"** no destino de reinvestimentos com vários lotes (conta `fund_bond_lots`
por `transaction_id`). **Modelagem (1a):** lotes são do FUNDO (sem `profile_id`) — não há
posse por título por cotista; participação individual é só via cotas. Testes:
`reinvestment.test.ts` (multi-destino PL/cota contínuos, guardas, `proceeds` com IR 15%).
**76 testes verdes**; build/lint ok.

**Cota de gênese no saldo de abertura (migração `20260620230000_opening_quota_price.sql`):**
o `quota_price` de cada transação de abertura era derivado de `amount/quotas` a partir de
um campo "Aportado (R$)" por irmão — dado redigitado à mão que só casava com a cota de
gênese por coincidência, enquanto o campo "valor inicial da cota" da tela nunca chegava ao
backend (era usado só p/ validar a distribuição no cliente). `set_opening_balance` ganhou
`p_quota_price NUMERIC DEFAULT 1` (DROP+recreate) e passou a gravar **a cota de gênese
(igual p/ todos)** como `quota_price` das transações de abertura; o `amount_brl` virou
DERIVADO = `quotas × quota_price` (valor de gênese da participação). O input "Aportado
(R$)" saiu da AdminView (e o campo `amount` do payload `p_quotas`). O ramo `is_opening` do
rebuild só soma cotas e não toca em `quota_price`, então o valor gravado sobrevive ao
replay. UI: AdminView envia `p_quota_price`; manual (`src/views/manual/`) atualizado.
**76 testes verdes**; build/lint ok.

**Auto-rebuild nas RPCs de operação (migração `20260620250000_auto_rebuild_on_operations.sql`):**
fim da reconstrução manual. Antes, só `apply_event_changes` (livro em batch) e
`delete`/`update` rodavam o replay; as telas de operação (`register_aporte`,
`request_withdrawal`, `register_reinvestment`, `approve_expense`, `reject_expense`)
gravavam cotas pela cota CORRENTE e deixavam a curva de PL parada até alguém clicar em
"Reconstruir histórico" — mesmo evento dava resultado diferente conforme a tela
(path-dependent). Agora cada RPC de operação chama `pap_rebuild_history()` ao final via
helper `pap_autorebuild()`. **Flag de supressão `pap.suppress_rebuild`** (GUC
transação-local, setada por `apply_event_changes` com `set_config(...,true)`): as RPCs
internas PULAM o rebuild dentro do batch — o batch segue com UM replay no fim. A flag é
**correção, não só performance**: o estado intermediário do batch pode ser
transitoriamente inconsistente. **Consequência semântica:** o replay processa por
`event_date` e exige consistência CRONOLÓGICA — uma saída datada antes de existir lote do
título (ex.: resgate antes do aporte que o financia) agora falha no FIFO em vez de
"funcionar" pela liquidação imediata; em produção o saldo de abertura dá lastro, então só
ocorre ao resgatar um título antes de adquiri-lo (de fato inválido). `set_opening_balance`
(genesis) e o cron diário seguem em `recalculate_pl` (a 1ª operação após a abertura já
refaz a curva inteira). Despesa PROPOSTA (pendente) não dispara rebuild (não altera o
fundo). UI: textos do AdminView ("Reconstruir histórico" agora é só pós-atualização de
preços) e AportesView ajustados. Testes: 2 fixtures de `opening-balance.test.ts` passaram
a datar o aporte de financiamento antes da saída (cenário cronologicamente válido).
**78 testes verdes**; build/lint ok.

**Aporte dividido entre obrigação mensal × reposição de resgate (migração
`20260620260000_aporte_reposition_split.sql`):** um RESGATE_PESSOAL tira caixa do fundo
e queima as cotas do solicitante, mas sumia das duas lentes de adimplência (as views só
somam APORTE) — o cotista não via quanto retirou nem quanto faltava repor. Decisão de
produto: o resgate NÃO contamina a obrigação mensal (vira indicador separado "resgate a
repor") e a reposição é EXPLÍCITA — um único aporte se divide entre os dois baldes.
Coluna aditiva `transactions.reposition_amount` (parte do APORTE destinada a abater o
resgate); é só **rótulo contábil** — o aporte inteiro (`amount_brl`) segue mintando
cotas/comprando o título e o motor de PL/cotas/`pap_rebuild_history` NÃO muda (o replay
só reescreve `quotas_amount`/`quota_price`/`quantity`, nunca esta coluna). As views
passam a: contribuição mensal = `amount_brl − reposition_amount` (em
`v_monthly_obligations.paid` e `v_cotista_balance.total_paid`); `v_cotista_balance` ganha
`withdrawn_total` (Σ RESGATE_PESSOAL), `reposed_total` (Σ reposição) e
`repayment_outstanding = withdrawn − reposed`. `register_aporte` ganhou
`p_reposition_amount NUMERIC DEFAULT 0` (DROP+recreate; valida `0 ≤ rep ≤ amount`);
`apply_event_changes` repassa o campo no create APORTE; `pap_update_transaction_core`
clampa `reposition_amount` ao novo valor na edição (e mantém o bloqueio de editar
REINVESTIMENTO). UI: `AportesView` mostra o bloco de divisão quando há saldo a repor —
default cobre 1 mensalidade na obrigação e sugere o excedente como reposição (ajustável),
envia `p_reposition_amount`; `NumberInput` segue sem `max` (a lógica clampa em
`repoMax = min(amount, outstanding)`). `MyPatrimony` ganhou o indicador separado "Resgate
a repor" (clay quando >0, "Reposto ✓" quando zerado). Testes: `tests/repayment.test.ts`
(resgate alimenta o saldo, reposição abate sem mexer no mês, 100% reposição, guarda).
**82 testes verdes**; build/lint ok.

> **Decisão em aberto — dívida de resgate é NOMINAL (reais), não de participação
> (cotas).** Hoje `repayment_outstanding` é em R$: tirou R$1000, deve R$1000; repor
> R$1000 quita, **independentemente de o fundo ter crescido**. Consequência: quem
> repõe depois de o fundo valorizar minta menos cota do que queimou (a cota subiu) →
> sua participação fica permanentemente menor mesmo "quitando". A alternativa
> considerada e **descartada por ora** é indexar a dívida à **fatia** (cotas
> queimadas no resgate, `−quotas_amount`): repor exigiria restaurar as cotas, custando
> a cota corrente (tirou 1000 cotas a R$1,00; se a cota vale R$1,50, repor custa
> R$1500). É mais coerente com a lógica de fundo (a dívida é com a participação, não
> com um nominal) porém contraintuitivo ("tirei R$1000, devo R$1500?"). **Não
> simplifica o modelo** — o split de um aporte único entre os dois baldes continua
> exigindo um número gravado (só trocaria `reposition_amount` em R$ por uma fração em
> cotas); a escolha é de *justiça/semântica*, não de simplicidade. **Para migrar p/
> dívida de participação, no futuro:** (1) `v_cotista_balance.withdrawn_total` passa a
> somar cotas queimadas (`−Σ quotas_amount WHERE type=RESGATE_PESSOAL`) em vez de
> `amount_brl`; (2) `reposed_total` passa a contar cotas recompostas — exige marcar a
> reposição em cotas (campo `recomposition_quotas` no lugar de `reposition_amount`, ou
> derivar do `amount_brl` da reposição ÷ cota do dia); (3) `repayment_outstanding`
> vira cotas; a UI ("Resgate a repor") converte p/ R$ pela **cota corrente** ao
> exibir, então o valor devido oscila com o PL; (4) `AportesView` sugere a reposição
> em R$ equivalente às cotas em aberto × cota do dia. O motor de PL/cotas/rebuild NÃO
> muda nos dois modelos (a coluna de reposição é sempre só rótulo contábil).

**Datas por `event_date` nas telas (REFACTOR_PLAN Item 2 — sem migração):** as views
de operação/dashboard exibiam e ordenavam pelo `created_at` (timestamp de digitação),
então lançamentos retroativos apareciam com a data errada no extrato e nas listas. Agora
`MyPatrimony`, `AportesView` e `AprovacoesView` selecionam/ordenam/exibem por
`event_date` (data econômica do evento), mantendo `created_at` só como **desempate** no
`.order(...)` — espelhando `/historico` e `RecentEvents`, que já estavam corretos. Sem
schema novo (`event_date` já existe e está nos tipos); exibição via `formatDate` (trata
date-only sem bug de fuso). **82 testes verdes**; build/lint ok.

**Input padronizado de operação + chip de cotação (REFACTOR_PLAN Item 3 — sem migração):**
o resgate recebia `quantity` (verdade do FIFO) e `amount_brl` (verdade da queima de
cotas) como campos independentes, sem nada conferindo que `valor ≈ qtd × preço` — erro
de digitação fazia a carteira e a participação divergirem em silêncio. Em vez de só um
aviso, padronizou-se a entrada de toda operação de título num componente compartilhado
`src/components/TreasuryAmountInput.tsx`: **quantidade + dois campos interligados (preço
unitário ↔ valor total)**, "o último editado manda". O canônico armazenado/enviado às
RPCs continua **qtd + valor total** (o unitário é derivado/editável, nunca persistido —
respeita a decisão da migração `…150000`); tornar o unitário visível e ancorado deixa o
erro óbvio. O preço unitário traz um **chip de sugestão** com a cotação do título na
**data do evento** via helper novo `src/lib/prices.ts` `fetchPriceOn(bond, date)` (lê
`bond_price_history` direto — mesma semântica carry-forward de `pap_price_on`, e o
padrão que a tela de abertura já usava; `bond_price_history` tem GRANT SELECT, evita a
RPC `SECURITY DEFINER`). Auto-preenche o unitário enquanto o usuário não toca em nada
(montar com valores, ex. edição, conta como "tocado" → não sobrescreve). Aplicado em
`AportesView` (aporte + destinos do reinvestimento), `AprovacoesView`, modais do
`/historico` (criar/editar) e lotes da `AdminView` (`defaultMode='unit'`, PU derivado →
`price = valor/qtd`); a **data foi movida para antes dos valores** nesses formulários
para o chip precificar pela data certa. **Sem guarda de backend** (opção B descartada).
Avança o Item 7 (form/labels compartilhados). Testes de UI ajustados (ordem dos campos
qtd[0]·unitário[1]·total[2]; builder mock ganhou `lte`/`gt`/`maybeSingle`). **82 testes
verdes**; build/lint ok.

**`v_cotista_balance` ancorada em profiles (REFACTOR_PLAN Item 8 — migração
`20260620270000_cotista_balance_all_profiles.sql`):** a view de saldo do cotista era
`FROM monthly_obligations`, então só retornava linha para quem JÁ tinha obrigações
mensais geradas (gerador manual / cron). **Bug observado em uso:** um RESGATE_PESSOAL
não aparecia em `MyPatrimony` — sem `generate_monthly_obligations` rodado (o `seed-sim`
não gera mais), a view devolvia `[]` para o cotista, então `withdrawn_total`/
`repayment_outstanding` viravam 0 e o card "Resgate a repor" nunca renderizava (e o saldo
sumia). Correção: ancorar em `profiles` (LEFT JOIN obrigações + contribuições + resgates)
→ todo cotista tem linha; sem obrigações fica `total_expected=0` ⇒ `balance=−total_paid`
(crédito), coerente. Colunas/semântica idênticas (contribuição mensal = `amount_brl −
reposition_amount`; `withdrawn_total = Σ RESGATE_PESSOAL`; `repayment_outstanding =
withdrawn − reposed`); só mudou a base do FROM. `v_monthly_obligations` (uma linha por
mês) segue `FROM monthly_obligations` de propósito — vazia sem obrigações é correto.
Teste novo em `tests/repayment.test.ts` (cotista com resgate e sem obrigações aparece com
`repayment_outstanding`). **83 testes verdes**; build/lint ok.

**Gestão do catálogo de títulos pelo admin (migração
`20260620280000_treasury_bond_catalog_mgmt.sql`):** o catálogo (`treasury_bonds`) só
era populado pelo `seed.sql` — nada na aplicação cadastrava um título novo. Como
`update_bond_prices`/`update_bond_price_history` fazem UPSERT casando por
`api_reference_name` e **só atualizam linhas já existentes**, um vencimento novo que
aparece no CSV do Tesouro (ex.: "Tesouro Selic 2032") era parseado e silenciosamente
ignorado — nunca recebia preço. Backend: RPC `upsert_treasury_bond(admin,
api_reference_name, display_name DEFAULT NULL, is_available DEFAULT true, current_price
DEFAULT NULL)` (SECURITY DEFINER, gate `pap_require_admin`) — INSERT … ON CONFLICT que
**nunca sobrescreve um `current_price` já conhecido** (`COALESCE(existente, novo)`; é
território do job diário), só semeia quando nulo; serve tanto p/ cadastrar quanto p/
togglar `is_available_for_purchase`. Descoberta dos candidatos na Edge Function
`daily-pl` com novo **`?mode=catalog`** (read-only: parseia o CSV, lê o catálogo via
service role e devolve os Selic/IPCA+ ainda NÃO cadastrados como `{api_reference_name,
current_price}`). **Escopo do `PAP_CRON_SECRET` corrigido:** só o modo `daily`
(fechamento agendado, que recalcula PL) exige o segredo; `backfill` e `catalog` são
maintenance acionados pelo NAVEGADOR do admin (que não pode portar o segredo) e ficam
atrás da UI gateada por ADMIN — antes o `backfill` exigia o segredo e quebrava em prod
(401). **CORS:** a função passou a tratar o preflight `OPTIONS` e devolver
`Access-Control-Allow-*` em toda resposta (`json()`); sem isso a invocação por
`supabase.functions.invoke` falhava com "Failed to send a request to the Edge Function"
no preflight. **Requer redeploy da Edge Function em prod.** UI: card
"Catálogo de títulos" na `AdminView` — botão "Buscar títulos no Tesouro" → dropdown dos
candidatos (label = nome · preço, garante o `api_reference_name` exato sem digitação) +
disponível Sim/Não + "Adicionar"; lista o catálogo atual com preço/status e
"Tornar indisponível/comprável". Cada card da `AdminView` agora renderiza o próprio
erro/sucesso (estado `Msg = {kind,text}` por card) — antes todo erro caía no Alert
compartilhado do form de saldo de abertura (aparecia no card errado). Testes:
`tests/catalog.test.ts` (cadastro com preço, toggle sem clobber de preço, gate admin).
**86 testes verdes**; build/lint ok.

**Preço de compra × venda na sugestão de operação (migração
`20260620290000_bond_buy_price.sql`):** o chip de sugestão de preço unitário
(`TreasuryAmountInput`) usava sempre o **PU Venda** (resgate) para todas as operações,
inclusive o APORTE — que é uma COMPRA. Como o CSV do Tesouro tem spread entre PU Compra
e PU Venda (na prática ~R$11–27 por título: o de compra é maior), a sugestão do aporte
ficava sistematicamente abaixo do que a B3 cobrou e não batia. Decisão: **guardar as
DUAS pontas no histórico e escolher o lado conforme a operação.** Coluna aditiva
`bond_price_history.buy_price` (PU Compra, NULLABLE; `price` permanece = PU Venda — PL,
`pap_price_on` e o motor de replay INTACTOS); `update_bond_price_history` grava as duas.
**Nenhuma função de cálculo do banco usa `buy_price`** — a compra grava o valor digitado
(qtd + valor total), então o preço de compra é só sugestão de tela. Parser
`parseTesouroHistory` extrai `buyPrice` (PU Compra Manhã, fallback Base → Venda); a Edge
Function (modo backfill) remapeia `buyPrice→buy_price` no payload. Front:
`fetchPriceOn(bond, date, side: 'sell'|'buy')` (default `'sell'`; lê `buy_price` com
fallback no `price`); `TreasuryAmountInput` ganhou prop `priceSide` (hint diz "PU de
compra/venda"). Lados por tela: **`buy`** = aporte, destinos de reinvestimento, lotes do
saldo de abertura; **`sell`** = resgate/despesa (`AprovacoesView`), valorização do PL; os
modais do `/historico` ramificam por tipo (APORTE=buy, saídas=sell). O modo `daily` e o
`catalog` da Edge Function NÃO mudaram (seguem só no PU Venda via `parseTesouroTransparente`).
**Requer redeploy da Edge Function + novo `?mode=backfill` em prod** para preencher
`buy_price` (linhas antigas ficam NULL → caem no fallback venda até lá). Ressalva: mesmo
com o PU Compra, pode haver pequena diferença vs. B3 (o CSV traz o snapshot da manhã; o
PU flutua durante o dia, mais nos IPCA+) — o componente sistemático (lado compra/venda)
é que foi resolvido. Testes: `prices.test.ts` (parser distingue compra ≠ venda).
**86 testes verdes**; build/lint ok.

**Override no saldo + remoção de obrigação (migração
`20260620300000_obligation_dismiss_and_override_balance.sql`):** dois ajustes na
adimplência. (1) O `status_override` do admin era respeitado SÓ no status mensal
(`v_monthly_obligations`, via `COALESCE`), mas o SALDO TOTAL
(`v_cotista_balance.balance`) o ignorava — marcar um mês como PAGO (caso fora do
sistema, ex. pago em dinheiro sem APORTE) tirava o mês da lista de pendentes mas o
`MyPatrimony` seguia mostrando "saldo devedor". Decisão: **override PAGO = mês
liquidado fora do sistema ⇒ sai do esperado** (some da dívida E da acumulação FIFO);
override PENDENTE conta normal. `v_cotista_balance.total_expected` passou a filtrar
`status_override IS DISTINCT FROM 'PAID'`; o `cum_expected` da `v_monthly_obligations`
soma 0 para meses override=PAID (não consomem a cobertura dos aportes dos meses
seguintes). (2) **Remoção permanente** de uma obrigação via **soft-delete**: coluna
aditiva `monthly_obligations.is_dismissed` (tombstone). Hard-delete não servia — o
gerador (`pap_generate_obligations`/cron) recriaria o mês (`INSERT … ON CONFLICT DO
NOTHING` preenche faltantes); a linha dismissed continua ocupando o slot único
`(profile_id, reference_month)` ⇒ o ON CONFLICT a preserva e o mês NÃO volta, enquanto
as views/UI a escondem (`WHERE NOT is_dismissed`). RPC nova `delete_obligation(admin,
id)` (gate admin). UI `AdminView`: botão "Remover" (com `confirm()`) ao lado de Marcar
paga/Auto (desktop + mobile); descrição do card atualizada. Testes em
`obligations.test.ts` (override zera dívida; remoção some da view e não é recriada pelo
gerador; gate admin). **88 testes verdes**; build/lint ok.

**Nota de texto em movimentações (migração `20260620310000_transaction_note.sql`):**
campo de observação livre opcional em aporte, resgate, despesa e reinvestimento. Coluna
aditiva `transactions.note TEXT` (NULLABLE). É **metadata pura** — NÃO entra em nenhum
cálculo (PL/cotas/IR/FIFO) e **sobrevive ao replay** (`pap_rebuild_history` só reescreve
`quotas_amount`/`quota_price`/`quantity` e reseta lotes, nunca toca em `note`), então o
motor não muda; só foi threadada pelas RPCs. Criação: `register_aporte`/
`request_withdrawal` (grava nos 3 caminhos: proposta pendente, despesa direta e resgate)/
`register_reinvestment` ganharam `p_note TEXT DEFAULT NULL` (DROP+recreate; grava
`NULLIF(btrim(p_note),'')` ⇒ vazio/só-espaços = NULL). Edição: `pap_update_transaction_core`
ganhou `p_note TEXT DEFAULT NULL` com semântica **NULL = mantém / '' = limpa / texto =
substitui** (o wrapper legado `update_transaction`, 6 args, segue preservando a nota);
`apply_event_changes` repassa `note` nos ramos create (todos os tipos) e update.
`approve_expense`/`reject_expense` não tocam a nota (a proposta já a carrega; persiste na
reclassificação). UI: primitivo `Textarea` em `ui.tsx`; campo "Nota (opcional)" em
`AportesView` (aporte + reinvestimento), `AprovacoesView` (saída) e nos modais criar/editar
do `/historico`; a nota aparece como linha itálica discreta sob o título na tabela/cards do
`/historico` (e nas criações pendentes). `lib/events.ts`: `note` em `EventRow`/`EVENT_SELECT`
e nos tipos `CreateAporteChange`/`CreateWithdrawalChange`/`UpdateChange` (opcional;
`effectiveValues` reflete edição pendente). Testes: `tests/note.test.ts` (grava + sobrevive
ao rebuild, vazio→NULL, update edita/limpa/mantém). **91 testes verdes**; build/lint ok.

**Formulário de operação unificado + modal corrigido (migração
`20260620320000_reposition_in_event_changes.sql`):** havia TRÊS transcrições divergentes
do mesmo formulário (AportesView, AprovacoesView, modais Create/Edit do `/historico`) —
cada uma escolhia quais campos expor. A queixa-gatilho: editar um aporte pelo `/historico`
não permitia mexer na divisão resgate×aporte (`reposition_amount`). **Front:** novo
componente apresentacional `src/components/OperationFields.tsx` (sem rpc/fetch — recebe
`values`/`onChange`, o pai detém estado e decide o submit) cobrindo aporte e saída
(resgate/despesa/despesa direta); reinvestimento fica de fora (UI própria na AportesView,
edição bloqueada). Tipos/helpers puros em `src/lib/operations.ts` (`OperationKind`,
`OperationValues`, `emptyOperationValues`, `KIND_LABELS`, `suggestedReposition`/
`effectiveReposition` — split extraído da AportesView; separado do componente por
react-refresh). Adotado nas 4 vias: páginas mantêm submit/RPC/cards; modais carregam o
`outstanding` do cotista (hook `useRepayment`) e emitem `CreateChange`/`UpdateChange`.
AprovacoesView trocou o checkbox "lançar já aprovada" pela opção "Despesa dos pais (direta)"
no seletor de tipo (mais consistente com o modal). Prop `purchasableOnly` (default true)
deixa a edição mostrar título de aporte antigo fora de venda. **Modal (`ModalShell` do
`/historico`):** renderizado por `createPortal(document.body)` — a view raiz tem
`animate-rise`, cujo `transform` residual (fill-mode `both`) ancorava `position:fixed` no
container em vez da viewport (blur/centralização presos à área de conteúdo, header nítido);
o portal resolve. Também `z-40` (cobre header z-20 e dropdown z-30), largura `sm:max-w-xl`
(folga ao grid de 3 colunas do TreasuryAmountInput), Esc fecha + scroll-lock. **Backend:**
`pap_update_transaction_core` ganhou `p_reposition_amount NUMERIC DEFAULT NULL` (NULL =
mantém clampado ao novo valor = legado; número = substitui, validado 0≤rep≤amount, só
APORTE); `apply_event_changes` repassa no ramo `update`. Rótulo contábil → motor/replay
intactos. Tipos em `lib/events.ts`: `reposition_amount` em `EventRow`/`EVENT_SELECT`,
`CreateAporteChange` e `UpdateChange`. Testes: `tests/repayment.test.ts` (editar reposição
via batch ajusta adimplência sem mexer em cotas; criar com reposição em batch; omitir
reposição na edição preserva a atual). **94 testes verdes**; build/lint ok. Validação
visual do modal (largura/blur/portal) ainda pendente de eyeballing.

**Etapa E (keep-alive) concluída:** `.github/workflows/keep-alive.yml` — GitHub
Action que faz um único `GET` de leitura no PostgREST (`SELECT bond_id FROM
treasury_bonds LIMIT 1`, tabela com GRANT SELECT p/ anon) usando a anon key, para
manter o projeto Supabase free tier fora do estado "paused" por inatividade (~7
dias). Roda via `schedule` (cron `0 8 */3 * *` — a cada ~3 dias, 08:00 UTC) +
`workflow_dispatch` manual. **Só leitura — NÃO** dispara o cálculo diário de PL
(isso é o `pg_cron` + Edge Function `daily-pl`); valida o HTTP status e falha o job
se não for 2xx. **Requer 2 secrets no GitHub** (Settings > Secrets and variables >
Actions): `SUPABASE_URL` e `SUPABASE_ANON_KEY`.

**REFACTOR_PLAN concluído (Itens 4–7 — fechamento):** o `REFACTOR_PLAN.md` está 100%
fechado (1–5, 7, 8 implementados; 6 decidido em A). Nesta rodada:
- **Item 4 — helper único de IR (migração `20260620330000_ir_net_helper.sql`):** a fórmula
  "valor líquido = bruto − IR sobre o ganho positivo (faixa por dias)" estava copiada em 3
  funções. Novo helper puro `pap_lot_net_value(qty, price, cost_price, days)` (IMMUTABLE,
  usa `pap_ir_rate`); `recalculate_pl`, `pap_portfolio_net_value` e
  `reinvestment_source_proceeds` passam a chamá-lo. **Cada caller mantém sua fonte de preço
  e filtros** (current_price sem clamp vs. `pap_price_on`+`GREATEST(dias,0)`+filtro
  `purchase_date<=date` vs. FIFO por lote) — só a fórmula foi centralizada; as divergências
  de filtro são intencionais. O `proceeds` deriva o IR do helper (`bruto − net`) por
  precisar de bruto e IR separados no JSON. Equivalência garantida por
  engine/rebuild/reinvestment.
- **Item 5 — `REJECTED` morto removido (sem migração):** desde o fluxo unificado nenhum
  caminho produz `transaction_status.REJECTED` (`reject_expense` reclassifica p/
  RESGATE_PESSOAL). Tiradas as entradas `REJECTED` de `STATUS_LABELS`/`STATUS_STYLES`
  (`aprovacoes`, `historico`) e o badge "rejeitada" do `MyPatrimony`. O **valor de enum
  permanece** (Postgres não dropa valor de enum facilmente) — **deprecado**, sem uso.
- **Item 6 — `monthly_obligations` decidido em (A):** mantida a materialização por mês +
  gerador + cron + views derivadas (permite valor mensal variável no futuro e ancora o
  `status_override`). Sem mudança de código.
- **Item 7 — consolidação de criação (resíduo fechado):** o grosso já fora feito na
  `…320000` (`OperationFields`/`lib/operations.ts` nas 3 telas). Agora os `TYPE_LABELS`
  locais duplicados em `aprovacoes` e `MyPatrimony` foram removidos → ambos importam de
  `lib/events.ts` (fonte única). Nota: isso alinhou os rótulos de `MyPatrimony`/`aprovacoes`
  ao texto curto de `events.ts` ("Resgate"/"Despesa" em vez de "Resgate pessoal"/"Despesa
  dos pais").

**94 testes verdes**; build/lint ok.

**Manual do usuário sincronizado (sem migração):** `src/views/manual/index.tsx` (rota
`/manual`, botão "?" no header) revisado para refletir tudo que entrou desde a sua
criação (commit `7f79342`). Adicionadas seções **Reinvestimento** (rotação de carteira:
origem→destinos, bruto/IR/líquido, não conta como aporte/cota) e **Catálogo de títulos**
(admin cadastra vencimentos novos via "Buscar títulos no Tesouro" + toggle comprável).
Atualizados: **Aportes** (campos interligados qtd↔unitário↔total + chip de sugestão de
preço, nota opcional, divisão aporte×reposição de resgate), **Saídas** ("resgate a
repor", nota), **Obrigações** (override PAGO sai do saldo devedor; ação Remover/dismiss),
**Histórico** (reinvestimento não editável), **Conceitos** (termo "Lote"/FIFO),
**Papéis**/**Setup** (catálogo, reinvestimento). **Correção factual-chave:** removida a
afirmação de que operações do dia a dia NÃO disparam rebuild — desde o auto-rebuild
(`…250000`) aporte/resgate/reinvestimento reconstroem a curva sozinhos; "Reconstruir
histórico" é sobretudo pós-backfill (ajustado em Manutenção, Aportes e FAQ). Índice agora
com 14 seções. build/lint ok.

**Próxima:**
- Deploy das migrações Fase 1/2 + Edge Function no Supabase de produção (rodar o
  backfill `?mode=backfill` 1x e depois o rebuild) — ainda NÃO feito. Inclui a
  migração `…290000_bond_buy_price` + redeploy da Edge Function + novo backfill para
  popular `buy_price` no histórico de produção. Inclui também as migrações
  `…300000_obligation_dismiss_and_override_balance` (override no saldo + remoção de
  obrigação), `…310000_transaction_note` (nota de texto em movimentações),
  `…320000_reposition_in_event_changes` (reposição editável na edição) e
  `…330000_ir_net_helper` (helper único de IR) — só schema/views/RPC, sem passos extras
  de dados.
