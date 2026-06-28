# CLAUDE.md — Fundo PAP

Guia para agentes neste repositório. Leia inteiro antes de implementar.

## O que é

Sistema do **Fundo de Investimento Familiar PAP (Projeto Aposentadoria Pais)**.
Três irmãos (cotistas) aportam mensalmente em títulos do Tesouro Direto, comprando
**cotas** do fundo. Um motor interno cruza diariamente um **Catálogo Central de
Títulos** com preços do Tesouro e a tabela regressiva de IR para recalcular o
**Patrimônio Líquido (PL)** e o **Valor da Cota**.

> **Fonte da verdade do produto:** a pasta `docs/` (4 arquivos), **imutável**. Em
> dúvida de regra/schema, leia `docs/`. Em ambiguidade, **pergunte antes de assumir**.

## Stack (inegociável)

- **Frontend:** Vite + React 19 + TypeScript + Tailwind v3. Deploy: Vercel.
- **Backend/DB:** Supabase (PostgreSQL + Auth + Edge Functions Deno/TS).
- **Cálculo/regras:** vivem no **banco** (RPCs); o front só chama RPC e lê tabelas.
- **Job diário:** Edge Function `daily-pl` acionada por `pg_cron`.
- **Keep-alive:** GitHub Action faz um GET de leitura a cada ~3 dias (não processa nada).
- **Pacotes:** `npm`.

## Comandos

```bash
npm run dev / build / lint / format / test        # test = vitest run (exige DB local)
npm run db:start / db:stop / db:reset             # supabase local (precisa de Docker)
npm run db:backfill   # popula bond_price_history com preços reais (Edge Function ?mode=backfill)
npm run db:sim        # cenário local: Victor(ADMIN)+Ana, abertura + rebuild (idempotente)
npm run gen:types     # regenera src/services/supabase/database.types.ts do DB local
```

Subir DB local: `open -a Docker` → `npm run db:start`. Studio em :54323, API em :54321.
**Antes de dar tarefa por pronta:** `build` + `lint` (+ `test` se mexeu no banco) verdes.

## Estrutura

```
docs/                       # Spec (FONTE DA VERDADE) — não editar/formatar
supabase/
├── migrations/             # SQL versionado (29 migrações; ordem cronológica importa)
├── functions/daily-pl/     # Edge Function: index.ts + prices.ts (parser puro, testado)
└── seed.sql                # catálogo treasury_bonds
tests/                      # Vitest: *.test.ts (banco, exige DB local) + *.test.tsx (jsdom)
                            #   helpers/db.ts = pg p/ fixtures + supabase-js p/ RPCs
src/
├── context/                # auth-context.ts / AuthProvider.tsx / useAuth.ts
├── components/             # ProtectedRoute, AppLayout, ui.tsx (primitivos),
│                           #   TreasuryAmountInput, OperationFields (form compartilhado)
├── views/                  # auth, dashboards (CdU 5-7 + RecentEvents), aportes, aprovacoes,
│                           #   historico (livro completo), admin, manual (rota /manual)
├── services/supabase/      # client.ts (tipado), index.ts (reexports), database.types.ts (GERADO)
└── lib/                    # format, events, operations, prices (fetchPriceOn),
                            #   useRepayment, fundSettings (useDebtMode)
```

Roteamento (`src/App.tsx`, react-router): `/login`/`/signup` públicas; `/`, `/aportes`,
`/aprovacoes`, `/historico`, `/admin`, `/manual` sob `<ProtectedRoute>` → `<AppLayout>`.
Nav = 3 destinos (Painel/Aportes/Resgates) + Admin condicional; `/historico` via "Ver tudo".
Import por alias `@` → `src/`.

## Schema (resumo — autoritativo em `docs/03` + migrações)

Enums: `user_role(COTISTA|ADMIN)`, `obligation_status(PENDING|PAID)`,
`transaction_type(APORTE|RESGATE_PESSOAL|DESPESA_PAIS|REINVESTIMENTO)`,
`transaction_status(PENDING_APPROVAL|APPROVED|REJECTED)` — **REJECTED está deprecado**
(nenhum caminho o produz; `reject_expense` reclassifica para RESGATE_PESSOAL).

- `profiles` — 1:1 com `auth.users`; `role`.
- `treasury_bonds` — Catálogo Central (Admin). `api_reference_name` (UNIQUE, chave da
  API), `current_price` (job diário), `is_available_for_purchase` (governança).
- `transactions` — **log de eventos**. Campos chave: `type`, `status`, `amount_brl`,
  `quotas_amount` (delta assinado), `quota_price`, `quantity` (unidades), `event_date`
  (data econômica — telas exibem/ordenam por ela, `created_at` só desempata),
  `is_opening`, `target_bond_id`, `source_bond_id`, `targets jsonb`, `reposition_amount`,
  `note`, `approved_by`.
- `fund_bond_lots` — carteira do fundo (sem `profile_id` — posse é só via cotas).
  **É projeção pura do ledger:** `pap_rebuild_history` faz `TRUNCATE` e recria os lotes.
  `quantity` (mexido pelo FIFO), `original_quantity` (imutável, trigger só em INSERT),
  `purchase_price`, `purchase_date`, `is_active`, `is_opening`, `transaction_id`.
- `monthly_obligations` — congela só o `amount_expected` de cada mês; status efetivo e
  saldo derivam de views. `status_override` (NULL=auto), `is_dismissed` (soft-delete).
- `bond_price_history(bond_id, date, price, buy_price)` — `price`=PU Venda (resgate, base
  do PL), `buy_price`=PU Compra (sugestão de aporte). Re-derivável por backfill.
- `pl_history` — snapshot diário: `total_pl_brl`, `total_quotas`, `quota_price`.
- `fund_settings` — linha única; `debt_mode` (`NOMINAL`|`PARTICIPACAO`, default NOMINAL).
- `app_config` — segredos do cron; **única tabela SEM GRANT SELECT** (fica trancada).

## Regras de negócio que NÃO podem se perder

**IR regressivo** (sobre o rendimento de cada lote): ≤180d 22,5% · 181–360 20% ·
361–720 17,5% · >720 15%. `Rendimento = qty × (preço − preço_compra)`. Helper único
`pap_lot_net_value(qty, price, cost, days)`; cada caller decide fonte de preço/filtros.

**PL diário:** para cada lote ativo, valor líquido = bruto − IR; PL = Σ líquidos;
`quota_price = PL / total_quotas APPROVED`. **Bootstrap da cota = R$1,00** com `pl_history`
vazio. `total_quotas = SUM(quotas_amount) WHERE status=APPROVED`; patrimônio individual =
mesmo SUM por `profile_id` × cota.

**`quotas_amount` é delta assinado:** APORTE `+`, RESGATE_PESSOAL `−` (queima),
DESPESA_PAIS e REINVESTIMENTO `0`.

**Aporte:** título comprável; grava `transaction` + 1 lote; cota provisória pela última
cotação, recomposta pelo rebuild. Pode dividir-se entre obrigação mensal e **reposição de
resgate** (`reposition_amount`, R$, só rótulo contábil — o aporte inteiro minta cota).

**Saídas (fluxo unificado):** toda saída = qtd + valor bruto + data, por qualquer cotista.
- **RESGATE_PESSOAL** (direto): nasce APPROVED; FIFO reduz `quantity` dos lotes mais
  antigos do título; **queima as cotas do solicitante** (valor bruto).
- **DESPESA_PAIS** (proposta): nasce PENDING, não conta até o admin classificar →
  `approve_expense` (vira despesa) ou `reject_expense` (vira RESGATE_PESSOAL do solicitante).
- **DESPESA_PAIS direta** (só admin): nasce APPROVED.
- **Regra de Ouro da despesa:** nenhuma cota de ninguém é queimada — o PL cai e a cota cai
  proporcionalmente para todos. Admin não classifica a própria proposta.

**Reinvestimento:** rotação de carteira (vencimento/rebalanceamento). Liquida a origem
(FIFO) e abre 1 lote por destino (`targets`). `quotas_amount=0`, PL conservado (Σdestinos
== líquido da origem), **não conta como aporte mensal**. Não editável (remover+recriar).

**Adimplência = saldo acumulado + status derivado** (sem baixa por aporte). Duas lentes
(views, sempre consistentes com o rebuild):
- `v_monthly_obligations` — status mensal por **cobertura FIFO-90%**: mês *m* quitado ⟺
  total contribuído ≥ 0,90 × Σ(esperado até *m*). `status = COALESCE(status_override, regra)`.
- `v_cotista_balance` (ancorada em `profiles`) — saldo total + dívida de resgate.
  Contribuição mensal = `amount_brl − reposition_amount` (exclui `is_opening`). Override
  PAGO sai do esperado; dismissed também.

**Dívida de resgate — toggle NOMINAL ⇄ PARTICIPACAO** (`fund_settings.debt_mode`, global,
admin). A `v_cotista_balance` expõe **as duas leituras sempre**: nominal em R$
(`withdrawn_total`/`reposed_total`/`repayment_outstanding` = Σ amount_brl − Σ reposition) e
participação em cotas (`*_cotas` = Σ(−quotas_amount) − Σ(reposition/quota_price)). O modo
vive **só no front** (qual exibir) — trocar é pura apresentação, não altera dado nem dispara
rebuild, reversível.

## Camada de banco (RPCs — use no front, não duplique a lógica)

Tudo de cota+lote vive no banco (atomicidade). RPCs são `SECURITY DEFINER`. Chame por args
**nomeados** (várias têm DEFAULTs e foram reordenadas ao longo do tempo).

**Operações** (todas rodam `pap_autorebuild()` ao final, exceto despesa pendente):
- `register_aporte(profile, bond, quantity, amount_brl, event_date?, reposition_amount?, note?)`
- `request_withdrawal(profile, bond, quantity, amount_brl, type, event_date?, direct?, note?)`
- `approve_expense(txn, approver)` / `reject_expense(txn, approver)` — reject → RESGATE_PESSOAL
- `register_reinvestment(profile, source_bond, source_quantity, targets jsonb, event_date, note?)`
- `reinvestment_source_proceeds(bond, qty, date) → {gross, ir, net, available, priced}`

**Gestão de eventos** (admin OU dono; bloqueiam `is_opening`; REINVESTIMENTO não editável):
- `delete_transaction(caller, txn)` · `update_transaction(caller, txn, bond, qty, amount, date)`
- `apply_event_changes(caller, changes jsonb) → jsonb` — **batch atômico** (create/update/
  delete) com **um** rebuild ao final; gate por item; rollback total na falha (`ref=…|item N`).

**Admin / setup:**
- `set_opening_balance(admin, date, contributions jsonb, quota_price)` — gênese. 1 transação
  `is_opening` por contribuição `{profile_id, bond_id, quantity, amount}` (título + dono +
  cota derivada de `amount/quota_price`); substitui a abertura anterior; chama rebuild.
- `rebuild_fund_history(admin)` — replay cronológico completo (wrapper gateado de
  `pap_rebuild_history`). Botão "Reconstruir histórico" do `/admin`.
- `upsert_treasury_bond(admin, api_reference_name, display_name?, is_available?, current_price?)`
  — cadastra/togla; **nunca sobrescreve `current_price` conhecido** (território do job).
- `generate_monthly_obligations(admin, amount=1000)` · `set_obligation_status(admin, id,
  status=NULL)` (NULL limpa o override) · `delete_obligation(admin, id)` (soft-delete).
- `set_debt_mode(admin, mode)` — `NOMINAL`|`PARTICIPACAO`.

**Job/preços:** `recalculate_pl(date=current_date)` · `update_bond_prices(jsonb)→int` (UPSERT
`current_price` por `api_reference_name`) · `update_bond_price_history(jsonb)` (UPSERT price+buy_price).

**Helpers internos** (não chamar do front): `pap_ir_rate`, `pap_lot_net_value`,
`pap_latest_quota_price`, `pap_liquidate_fifo`, `pap_price_on` (carry-forward),
`pap_portfolio_net_value`, `pap_emit_pl`, `pap_rebuild_history` (replay SEM gate),
`pap_autorebuild`, `pap_require_admin`, `pap_require_admin_or_owner`, `pap_run_daily_pl`.

**Convenções que NÃO se quebram:**
- **Auto-rebuild + flag `pap.suppress_rebuild`:** cada operação chama o rebuild; `apply_event_changes`
  seta a flag (GUC transação-local) p/ as RPCs internas PULAREM o rebuild e o batch fazer só 1
  no fim. O replay processa por `event_date` e **exige consistência cronológica** (saída antes do
  lote que a financia falha no FIFO — em prod a abertura dá lastro).
- **`fund_bond_lots` é só projeção** — recriado do ledger pelo rebuild em ordem cronológica
  (`event_date, is_opening DESC, created_at, id`), o que deixa o FIFO correto. **Envelhecer um
  lote = mudar a `event_date` da transação**; patchear `purchase_date` direto não sobrevive ao replay.
- **Bond preço de compra × venda:** sugestão de tela usa `buy_price` no aporte/destinos de
  reinvestimento/lotes da abertura, `price` (venda) nas saídas. Nenhuma função de cálculo usa
  `buy_price`. Front: `fetchPriceOn(bond, date, side)`.
- **`reposition_amount` e `note` são rótulos** — sobrevivem ao replay (o rebuild só reescreve
  `quotas_amount`/`quota_price`/`quantity` e recria lotes).
- **GRANT:** RPCs `SECURITY DEFINER` + `GRANT SELECT ON ALL TABLES … TO anon, authenticated`.
  Nova tabela ⇒ lembrar o GRANT SELECT (exceto `app_config`). **service_role não tem GRANT
  direto** — a Edge Function escreve via RPC, nunca `from(table).update()`.
- **Entrada de operação:** componente `TreasuryAmountInput` (qtd + preço unitário ↔ valor total,
  "último editado manda"); o canônico enviado é **qtd + valor total** (unitário derivado, nunca
  persistido). `OperationFields` + `lib/operations.ts` = form compartilhado (aporte/saída).

## Edge Function `daily-pl`

Fecha o dia 100% no Supabase. `index.ts`: fetch do CSV do **Tesouro Transparente** (oficial,
gratuito, sem token) → parser puro `prices.ts` (só Selic e IPCA+, Data Base mais recente, PU
Venda) → `update_bond_prices` → `recalculate_pl`. Chave = `"<Tipo> <ano venc>"` (casa o
`api_reference_name`). Modos extra: `?mode=backfill` (todo o histórico → `bond_price_history`,
inclui `buy_price`) e `?mode=catalog` (read-only: lista títulos do CSV ainda não cadastrados).

Acionamento: `pg_cron` (dias úteis 21:00 UTC) → `pap_run_daily_pl()` → `pg_net` na URL da
função (config em `app_config`, vazia localmente ⇒ cron no-op). `verify_jwt=false`; só o modo
`daily` exige `PAP_CRON_SECRET` (header `x-pap-cron-secret`) — `backfill`/`catalog` são
acionados pela UI do admin e não portam segredo. Trata CORS/OPTIONS. **Mexeu na função ⇒
redeploy em prod.** Decisão de fonte: brapi virou paga; B3 público (410); por isso o CSV.

## Identidade visual ("livro-razão claro" — sálvia/verde)

> **ARMADILHA:** os **nomes** dos tokens vieram de um tema escuro antigo mas hoje guardam
> valores **claros**. Use pelo papel semântico, nunca pelo nome literal. **`brass` = VERDE de
> acento** (não dourado); `void` = tinta carvão; `moss`/`raised` = branco (cartão). Não
> "conserte" o nome; mude só o valor em `tailwind.config.js` se a paleta mudar.

- **Superfícies:** `moss`/`raised`=branco; `pine`=menta pálida; fundo da página vem do `body`.
- **Texto:** `bone`=principal · `bone-dim`=secundário · `sage`=terciário/rótulos.
- **Acentos:** `brass`/`brass-bright`=VERDE (ações/filetes/foco) · `emerald`=positivo ·
  `clay`=negativo/saída. `line`=filete carvão translúcido.
- **Tipografia:** `font-display`=Fraunces (títulos), `font-sans`=Hanken Grotesk (default),
  `font-mono`=Spline Sans Mono. **Todo número/dinheiro usa `.nums`** (mono + tabular-nums).
- **Utilitárias** (`index.css`): `.nums`, `.eyebrow` (versalete — NÃO `.overline`, colide com
  utility nativa), `.rule-brass`. Movimento via `animate-rise` (+ `animationDelay` p/ escalonar).
- **Componentes base** em `ui.tsx` (Card/Field/NumberInput/DateInput/Select/Button/Alert/Textarea/
  TextInput) — reutilize, sempre via tokens, nunca cores cruas. `Button` variants:
  `primary|secondary|danger`.
- **Header** (`AppLayout.tsx`): sem hambúrguer; desktop numa linha, mobile com abas full-width
  numa 2ª linha (duas `<nav>` por `sm:hidden`/`hidden sm:flex`).

## Decisões e convenções

- **Sem RLS** (uso privado por 3 cotistas, todos veem tudo).
- **`docs/` imutável** e no `.prettierignore` — nunca formate (Prettier já achatou `docs/03`).
- `database.types.ts` é gerado (`gen:types`), ignorado por prettier/eslint — não editar à mão.
- `.env` local (gitignored): `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (modelo em `.env.example`).
- Prettier: `semi:false`, `singleQuote`, `trailingComma:all`, printWidth 80.
- **Testes:** Vitest. `*.test.ts` (banco) exigem DB local; padrão `pg` p/ fixtures + supabase-js
  p/ RPCs (`resetDb` trunca o estado compartilhado, **não** `fund_settings`/catálogo). `*.test.tsx`
  (jsdom) mockam `@/services/supabase`. Gotcha: após `db:reset` o PostgREST pode servir schema em
  cache por alguns segundos (404/P0001 transitório em RPC nova) — rodar de novo resolve.
- **Avaliação local:** `.env.local` aponta o front p/ Supabase local; `npm run db:sim` monta o
  cenário (Victor admin/Ana, senha `paplocal123`); `npm run db:backfill` 1× após `db:reset`.

## Estado atual

App **feature-complete** e em produção (Vercel + Supabase): auth+shell, dashboards (CdU 5-7),
aportes, saídas/aprovações, reinvestimento (multi-destino), histórico (livro com batch),
obrigações mensais, catálogo de títulos, Edge Function `daily-pl` (+ cron + keep-alive),
toggle de dívida de resgate. Suíte Vitest cobrindo motor, rebuild, operações, adimplência,
reinvestimento, batch e UI. `build`/`lint`/`test` verdes.

**Pendência de deploy (prod):** as migrações da Fase 1/2 em diante ainda **não** foram
aplicadas em produção. Ao aplicar, em ordem:
1. Rodar a Edge Function `?mode=backfill` 1× (popula `bond_price_history` incl. `buy_price`;
   **requer redeploy da função**).
2. `rebuild_fund_history(<admin>)` 1× (materializa `fund_bond_lots` como projeção do ledger).
3. Opcional — consolidar a gênese atual (split → consolidado da `…360000`): no SQL Editor,
   `UPDATE transactions SET profile_id=… WHERE is_opening AND target_bond_id=…` (1 por título)
   + `DELETE … WHERE is_opening AND target_bond_id IS NULL`, depois "Reconstruir histórico".
   Retrocompatível: sem o passo, a gênese segue funcionando no split.

As migrações de schema/views/RPC posteriores (catálogo, nota, helper de IR, toggle de dívida
`…370000`) são retrocompatíveis e não exigem passos de dados.
