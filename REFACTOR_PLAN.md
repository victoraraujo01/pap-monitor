# Plano de consistência & simplificação — Fundo PAP

Plano de execução das melhorias levantadas na análise abrangente do app. Cada item é
**autocontido**: dá para abrir este arquivo do zero (contexto limpo), ler só a seção do
item e executá-lo sem reconstruir o resto. Faça **um item por vez, na ordem**.

> Fonte da verdade do produto continua sendo `docs/` (imutável) e o `CLAUDE.md` (guia +
> histórico de decisões). Este arquivo é o **plano de obra**; quando um item for
> concluído, marque-o como ✅ aqui e registre no roadmap do `CLAUDE.md`.

---

## Como trabalhar em CADA tarefa (ritual fixo)

1. **Orientação:** leia o `CLAUDE.md` inteiro (stack, schema, RPCs, convenções e o
   histórico de etapas). Ele explica o modelo "log de eventos + replay" que tudo abaixo
   assume.
2. **Ambiente:** o Supabase local precisa estar de pé (Docker).
   - Checar: `docker ps | grep supabase_db_pap-monitor` e
     `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:54321/rest/v1/` (espera 200).
   - Se não estiver: `open -a Docker` → `npm run db:start`.
3. **Migrações são append-only.** O banco local já tem todas as migrações aplicadas.
   QUALQUER mudança de schema/função = **NOVA** migração (nunca edite uma já aplicada).
   - Numeração: use o **próximo** timestamp livre. Cheque com `ls supabase/migrations`.
     A última hoje é `20260620260000_aporte_reposition_split.sql`.
   - Para aplicar: `npm run db:reset` (reaplica tudo do zero + roda o `seed-sim`).
   - Funções são redefinidas via `CREATE OR REPLACE` em migração nova (convenção do
     projeto — a definição mais recente vence; as antigas ficam no histórico).
4. **Tipos gerados:** depois de mudar schema, rode `npm run gen:types` (regenera
   `src/services/supabase/database.types.ts` — NÃO editar à mão).
5. **Verificação final (tudo verde antes de considerar pronto):**
   ```
   npm run db:reset      # só se mexeu em SQL
   npm run gen:types     # só se mexeu em schema
   npm run test          # vitest — exige DB local de pé
   npm run build         # tsc -b + vite (typecheck)
   npm run lint          # eslint
   ```
   Hoje a baseline é **78 testes verdes**. Se um teste quebrar, entenda se é regressão
   (corrigir o código) ou se o teste codificava o comportamento antigo de propósito
   (aí o ajuste do teste é legítimo — explique o porquê no commit/resumo).
6. **Documentar:** ao terminar, adicione uma entrada no roadmap do `CLAUDE.md` (mesmo
   formato das demais: o que mudou, por quê, nº de testes, "build/lint ok") e marque ✅ aqui.

### Convenções que o Item 1 estabeleceu (valem para os próximos)

- **Auto-rebuild:** toda RPC de operação (`register_aporte`, `request_withdrawal`,
  `register_reinvestment`, `approve_expense`, `reject_expense`) roda
  `pap_rebuild_history()` ao final, via `pap_autorebuild()`.
- **Flag `pap.suppress_rebuild`** (GUC transação-local): `apply_event_changes` a seta
  com `set_config('pap.suppress_rebuild','on',true)` para as RPCs internas pularem o
  rebuild — o batch roda **um** replay no fim. Se você criar uma RPC de operação nova,
  siga o mesmo padrão (chame `pap_autorebuild()` no fim; se for chamável pelo batch,
  ela já respeita a flag).
- **Consistência cronológica:** o replay processa por `event_date`. Lançamentos têm que
  fazer sentido na ordem temporal (não resgatar um título antes de existir lote dele).

---

## Item 1 — Auto-rebuild nas RPCs de operação ✅ CONCLUÍDO

Migração `20260620250000_auto_rebuild_on_operations.sql`. Fim do rebuild manual; cota
provisória recomposta na hora; flag de supressão para o batch. Ver entrada no `CLAUDE.md`
("Auto-rebuild nas RPCs de operação"). Mantido aqui só para referência das convenções acima.

---

## Item 2 — Padronizar datas em `event_date` (nunca `created_at`) ✅ CONCLUÍDO

Concluído sem migração: `MyPatrimony`, `AportesView` e `AprovacoesView` passaram a
selecionar/ordenar/exibir por `event_date`, com `created_at` mantido só como desempate
no `.order(...)` (espelha `/historico`/`RecentEvents`). 82 testes verdes; build/lint ok.
Ver entrada no `CLAUDE.md`. Detalhe original do item mantido abaixo para referência.

---

**Objetivo:** todas as telas exibirem e ordenarem pela **data econômica do evento**
(`event_date`), não pelo timestamp de digitação (`created_at`).

**Por quê (falha de processo):** lançamentos retroativos aparecem com a data errada no
extrato do cotista e nas listas de operação. O `/historico` e o `RecentEvents` já usam
`event_date`; o resto destoa, confundindo auditoria.

**Evidência (trocar `created_at` → `event_date`):**
- `src/views/dashboards/MyPatrimony.tsx` — linha 10 (campo do `Pick`), 40 (`.select`),
  42 (`.order`), 162 (exibição `formatDate(t.created_at)`).
- `src/views/aportes/index.tsx` — linha 27 (`Pick`), 53 (`.select`), 56 (`.order`),
  222 (exibição).
- `src/views/aprovacoes/index.tsx` — linhas 23 e 27 (dois `Pick`), 89 e 99 (`.select`),
  92 e 102 (`.order`), 319 e 373 (exibição).

**Já corretos (não mexer):** `src/views/historico/index.tsx` (ordena `event_date` depois
`created_at` como desempate), `src/views/dashboards/RecentEvents.tsx` (idem).

**Plano:**
1. Em cada arquivo acima, troque `created_at` por `event_date` no tipo `Pick`, no
   `.select(...)`, no `.order(...)` e na exibição `formatDate(...)`.
2. Onde houver desempate útil, ordene `event_date desc` e depois `created_at desc`
   (espelha o `/historico`/`RecentEvents`).
3. Não precisa migração nem types novos (`event_date` já existe e está nos tipos).

**Gotchas:**
- `formatDate` (`src/lib/format.ts`) já trata date-only (`'YYYY-MM-DD'`) e ISO sem bug de
  fuso (fatia os 10 primeiros chars). Logo a troca é segura na exibição — **não** use
  `new Date(event_date)` cru em lugar nenhum (volta um dia no fuso BRT).
- `event_date` é `DATE` (sem hora); ordenar só por ele empata lançamentos do mesmo dia —
  por isso o desempate por `created_at`.

**Impacto em testes:** os testes de UI (`tests/dashboards.test.tsx`, `tests/views.test.tsx`)
mockam o `supabase` e geralmente não assertam a coluna de data; rode a suíte e ajuste se
algum mock referenciar `created_at`. Sem impacto no banco.

**Pronto quando:** `grep -rn "created_at" src/ | grep -v database.types.ts` só retornar
`src/lib/events.ts` (que mantém `created_at` como desempate no `EVENT_SELECT`) e o
`historico`/`RecentEvents`. `test`/`build`/`lint` verdes.

---

## Item 3 — Conferência valor × quantidade no resgate ✅ CONCLUÍDO

Resolvido por padronização em vez do aviso passivo: novo componente compartilhado
`src/components/TreasuryAmountInput.tsx` (quantidade + preço unitário ↔ valor total
interligados, com chip de sugestão por `fetchPriceOn(bond, data)`). O preço unitário
fica visível e ancorado na cotação da data, tornando a divergência qtd×valor óbvia ao
usuário; canônico armazenado = qtd + total (espelha as RPCs). Aplicado em Aportes,
Aprovações, destinos do Reinvestimento, modais do `/historico` e lotes da AdminView
(data movida para antes dos valores). **Sem guarda de backend** (opção B descartada por
ora). Avança boa parte do **Item 7** (form compartilhado). Helper `src/lib/prices.ts`
(`fetchPriceOn`/`today`). 82 testes verdes; build/lint ok. Ver `CLAUDE.md`. Detalhe
original mantido abaixo para referência.

---

**Objetivo:** impedir (ou ao menos avisar) que um resgate queime cotas num valor
incoerente com a quantidade de títulos que sai da carteira.

**Por quê (erro de lógica):** `request_withdrawal` recebe `p_quantity` (verdade do FIFO)
e `p_amount_brl` (verdade da queima de cotas) como campos independentes, sem checar que
`amount ≈ quantidade × preço`. Se o cotista errar um, a baixa da carteira e a queima de
participação divergem silenciosamente — alguém perde mais/menos cota do que o valor real
sacado. O reinvestimento já tem trava análoga ("soma dos destinos == líquido"); o resgate
não.

**Evidência:**
- Backend: `request_withdrawal` na migração **mais recente** que a define hoje é
  `supabase/migrations/20260620250000_auto_rebuild_on_operations.sql` (reescrita no Item 1).
  Qualquer mudança = NOVA migração que faz `CREATE OR REPLACE` dela de novo.
- Preço de referência da data: helper `pap_price_on(bond, date)` (fallback
  `treasury_bonds.current_price`).
- UI: `src/views/aprovacoes/index.tsx` (form de saída, `handleSubmit` ~linha 126) e o
  modal de criação em `src/views/historico/index.tsx` (`CreateModal`).

**Decisão de produto (PERGUNTAR ao usuário antes de codar):** o preço de execução real
pode legitimamente diferir do preço de referência. Escolher entre:
- **(A) Aviso só na UI (recomendado):** calcular `quantidade × preço_de_referência` e, se
  divergir do valor bruto além de uma tolerância (ex.: ±5%), mostrar um `Alert` não
  bloqueante ("valor informado destoa ~X% da referência — confira"). Zero risco de travar
  resgate legítimo. Sem migração.
- **(B) Guarda no backend com tolerância generosa:** em `request_withdrawal`, comparar
  `p_amount_brl` com `p_quantity * COALESCE(pap_price_on(bond, event_date), current_price)`
  e `RAISE EXCEPTION` se divergir além de, ex., ±20%. Mais seguro, porém pode atrapalhar
  casos extremos (marcação ruim de preço). Exige NOVA migração.
- **(C) Ambos:** aviso suave na UI + guarda larga no backend.

**Plano (assumindo A; ajuste se o usuário escolher B/C):**
1. Na `AprovacoesView`, buscar o preço de referência do título selecionado (já há
   `current_price` no catálogo; ou chamar `pap_price_on` via RPC se quiser o da data).
   - Atenção: a tela hoje carrega `bonds` só com `id, api_reference_name, display_name`
     (linha ~108). Inclua `current_price` no select se for usar o do catálogo.
2. Computar `esperado = qty * preço`; se `amount` informado divergir > tolerância, exibir
   `Alert kind="info"` perto do botão (não desabilitar o submit).
3. Replicar o mesmo aviso no `CreateModal` do `/historico` para resgate/despesa.
4. (Se B/C) criar `2026062026XXXX_withdrawal_value_guard.sql` recriando `request_withdrawal`
   com a checagem; manter TODO o resto do corpo idêntico ao da `…250000` (incluindo o
   `PERFORM pap_autorebuild()` nos caminhos aprovados e o respeito à flag de supressão).

**Gotchas:**
- Se for backend (B/C): **não** quebre os fixtures que informam valor ≠ qty×preço de
  propósito — ex.: `tests/opening-balance.test.ts` "RESGATE grava quantidade + valor bruto
  como verdade" usa qty 0.05 e bruto 450 com `current_price` 10000 (preço implícito 9000).
  Uma tolerância de ±20% reprovaria isso (9000 vs 10000 = 10%, passa; mas confira a conta).
  Calibre a tolerância OU ajuste o fixture conscientemente.
- A despesa proposta (pendente) também passa por aqui; decida se o aviso vale para ela
  (o valor só é "usado" na classificação).

**Impacto em testes:** nenhum se A (UI). Se B/C, revise `engine.test.ts` (CdU 3) e
`opening-balance.test.ts` (Fase 2) — vários usam valores não-redondos.

**Pronto quando:** o caminho escolhido funciona manualmente (resgate coerente passa;
incoerente avisa/bloqueia) e a suíte está verde.

---

## Item 4 — Helper único de IR / valor líquido (matar 3 cópias)

**Objetivo:** uma só implementação da regra "valor líquido = bruto − IR sobre o lucro
positivo, por faixa de dias".

**Por quê (redundância):** a mesma fórmula está copiada em 3 funções; uma mudança na
regra fiscal precisa ser feita em 3 lugares e pode divergir.

**Evidência (as 3 cópias — usar a definição mais recente de cada):**
- `recalculate_pl` — `supabase/migrations/20260619160100_pl_engine_and_rpcs.sql:106-121`
  (valoriza por `treasury_bonds.current_price`; dias = `p_date - purchase_date`; **NÃO**
  filtra `purchase_date <= p_date`).
- `pap_portfolio_net_value` — `supabase/migrations/20260620120000_history_engine.sql:143-157`
  (valoriza por `pap_price_on(bond, date)` com fallback `purchase_price`; filtra
  `purchase_date <= p_date`; usa `is_active`).
- `reinvestment_source_proceeds` — `supabase/migrations/20260620220000_reinvestment_multi_target.sql:60-87`
  (FIFO por lote da origem; mesma fórmula de IR por lote).
- A faixa de IR já está isolada em `pap_ir_rate(days)` — reusar.

**Plano:**
1. Nova migração `2026062027XXXX_ir_net_helper.sql`.
2. Criar helper puro por lote, ex.:
   ```sql
   CREATE OR REPLACE FUNCTION pap_lot_net_value(
     p_qty NUMERIC, p_price NUMERIC, p_cost_price NUMERIC, p_days INT
   ) RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
     SELECT GREATEST(p_qty,0) * p_price
            - CASE WHEN p_qty*(p_price - p_cost_price) > 0
                   THEN p_qty*(p_price - p_cost_price) * pap_ir_rate(GREATEST(p_days,0))
                   ELSE 0 END;
   $$;
   ```
   (Decida a assinatura final; o ponto é centralizar a expressão "bruto − IR sobre ganho".)
3. `CREATE OR REPLACE` das 3 funções reescrevendo o miolo para chamar o helper, mantendo
   **cada uma com sua própria fonte de preço e seus filtros atuais** (não unifique a fonte
   de preço — só a fórmula de IR/líquido).
4. `npm run gen:types` não é necessário (sem mudança de tabela/coluna), mas roule por
   garantia se o linter de tipos reclamar.

**Gotchas:**
- **Não** "conserte" a divergência de filtro entre `recalculate_pl` (sem
  `purchase_date<=date`) e `pap_portfolio_net_value` (com) neste item — só centralize a
  fórmula. Se quiser unificar os filtros também, faça como passo separado e teste o CdU 1
  (`engine.test.ts` "calcula PL líquido aplicando IR").
- O helper precisa devolver exatamente os mesmos números das cópias atuais. Os testes que
  travam isso: `engine.test.ts` (IR nas faixas; PL líquido), `rebuild.test.ts` (cota 1.775
  com IR 22,5% em 151 dias), `reinvestment.test.ts` ("aplica a faixa de IR sobre o ganho
  FIFO", IR 15%). São o seu oráculo de equivalência.

**Impacto em testes:** zero se a refatoração for fiel (os testes acima confirmam). Se
algum quebrar, o helper diverge da fórmula original — ajuste o helper, não o teste.

**Pronto quando:** as 3 funções chamam o helper, `engine`/`rebuild`/`reinvestment` verdes,
build/lint ok.

---

## Item 5 — Remover o conceito morto `REJECTED`

**Objetivo:** tirar rótulos/badges de um status que **nenhum caminho de código produz**
mais.

**Por quê (funcionalidade desnecessária):** desde o fluxo unificado, `reject_expense`
**reclassifica** a saída para `RESGATE_PESSOAL` (não marca `REJECTED`). O valor de enum
`transaction_status.REJECTED` ficou órfão; só sobraram rótulos/badges inalcançáveis.

**Evidência:**
- `src/views/aprovacoes/index.tsx:44` (`STATUS_LABELS.REJECTED`) e `:49`
  (`STATUS_STYLES.REJECTED`).
- `src/views/historico/index.tsx:46` (`STATUS_LABELS.REJECTED`).
- `src/views/dashboards/MyPatrimony.tsx:171-175` (badge "rejeitada" — bloco inteiro nunca
  renderiza).
- Enum: `supabase/migrations/20260619150134_initial_schema.sql:9` (`... 'REJECTED'`).

**Plano:**
1. Remover as entradas `REJECTED` dos `Record`s de labels/estilos e o bloco do badge em
   `MyPatrimony` (linhas 171-175). Como nenhum código gera `REJECTED`, os `?? t.status`
   de fallback cobrem o caso teórico.
2. **Enum:** NÃO tente dropar o valor de enum (Postgres não suporta `ALTER TYPE ... DROP
   VALUE` de forma simples). Deixe-o e documente como deprecado no `CLAUDE.md` (uma linha).
   Opcional/avançado: recriar o tipo sem o valor (renomear tipo antigo, criar novo, migrar
   colunas, dropar antigo) — só se quiser muito; alto custo/risco para ganho baixo. Padrão:
   **não fazer**.

**Gotchas:** confira que nenhum teste de UI asserta o texto "Rejeitado"/"rejeitada"
(`grep -rn "ejeit" tests/`). Improvável, mas cheque.

**Impacto em testes:** praticamente nulo (frontend morto). Sem banco.

**Pronto quando:** `grep -rn "REJECTED" src/ | grep -v database.types.ts` só retornar (no
máximo) referências em comentários; build/lint/test verdes.

---

## Item 6 — Decidir o destino de `monthly_obligations`

**Objetivo:** reduzir maquinaria não exercida da adimplência, OU confirmar que ela se
justifica.

**Por quê (conceito possivelmente desnecessário):** hoje a tabela `monthly_obligations`
só "congela" o `amount_expected` de cada mês; o status é 100% derivado em views
(`v_monthly_obligations` regra FIFO-90%; `v_cotista_balance`). Como na prática há **um
único valor mensal global** (campo único na AdminView, default 1000), toda a engrenagem
(gerador idempotente `pap_generate_obligations` + wrapper `generate_monthly_obligations` +
cron mensal + tela "Gerar obrigações" + `status_override`) existe sobretudo para suportar
"valor mensal variável no futuro" — recurso ainda **não usado**.

**Evidência:**
- Tabela e gerador: `supabase/migrations/20260620190000_monthly_obligations.sql`,
  `…200000_obligation_balance.sql` (views + `status_override`),
  `…210200_drop_vestigial_status.sql` (gerador sem `status`).
- UI: seção "Obrigações mensais" em `src/views/admin/index.tsx` (linhas ~700-820:
  `handleGenerateObligations`, `toggleObligation`, `clearOverride`, tabela).
- Leitura: `MyPatrimony.tsx` e `AdminView` consomem `v_monthly_obligations` /
  `v_cotista_balance`.

**Decisão (PERGUNTAR ao usuário — muda o que se faz):**
- **(A) Manter como está (recomendado se valores variáveis SÃO um requisito real ou
  provável):** não fazer nada além de documentar o porquê. Materializar por mês é o que
  permite mudar o valor mensal sem reescrever o passado.
- **(B) Simplificar para config + view (se o valor é e será sempre global):** substituir a
  tabela por uma config única (valor mensal + data de início — a abertura já dá a data via
  `min(event_date) WHERE is_opening`) e derivar os meses on-the-fly numa view. Remove a
  tabela, o gerador, o cron e a tela "Gerar obrigações". Mais enxuto, porém perde a
  capacidade de valor por mês e exige migração de dados + reescrita das views + ajustes na
  UI e nos testes (`tests/obligations.test.ts`).

**Plano (só se B):**
1. Nova migração: tabela/coluna de config (ou reuso de `app_config`? **não** — `app_config`
   é trancada/segredos; criar config própria com GRANT SELECT) com o valor mensal.
2. Reescrever `v_monthly_obligations`/`v_cotista_balance` para gerar a grade de meses a
   partir da data de abertura e do valor de config, mantendo `status_override` (precisa de
   uma chave por mês para o override — reavaliar; pode exigir manter uma tabela mínima só
   de overrides).
3. Ajustar `AdminView` (remover "Gerar"; manter override) e `MyPatrimony`.
4. Reescrever `tests/obligations.test.ts` para o novo modelo.

**Gotcha grande:** o `status_override` manual por mês precisa de uma âncora persistente
(id por mês). Se for B, talvez o mais limpo seja manter `monthly_obligations` só como
tabela de **overrides** (linha só quando há override) — pense nisso antes de prometer
remoção total.

**Recomendação honesta:** a menos que o usuário garanta "valor sempre global e fixo", o
custo/risco de B supera o ganho. Favorecer **(A) + uma nota no `CLAUDE.md`**.

**Pronto quando:** decisão registrada; se B, suíte verde com testes reescritos.

---

## Item 7 — Consolidar a criação de lançamentos (operação × histórico)

**Objetivo:** ter **um** caminho canônico de criação, eliminando duplicação de UI/regra
entre as telas de operação e o modal do histórico.

**Por quê (redundância):** `/historico` (`CreateModal`) já cria aporte, resgate, despesa
proposta e despesa direta — quase tudo que `/aportes` e `/aprovacoes` fazem — e, como passa
por `apply_event_changes`, já sai com cota histórica correta. Há dois caminhos paralelos
com regras sutilmente diferentes. (Reinvestimento só existe em `/aportes` — assimetria.)

**Contexto que mudou (importante):** depois do Item 1, as telas de operação **também**
reconstroem a curva na hora. Então a vantagem histórica do `/historico` ("sai com cota
certa") deixou de ser exclusiva — o que torna a consolidação mais fácil de justificar.

**Evidência:**
- Criação instantânea: `src/views/aportes/index.tsx` (aporte + `ReinvestmentCard`),
  `src/views/aprovacoes/index.tsx` (saídas + classificação pendente).
- Criação em rascunho/batch: `src/views/historico/index.tsx` (`CreateModal`, `EditModal`,
  `apply_event_changes`).
- Regras de permissão compartilhadas: `src/lib/events.ts` (`canManageEvent`, tipos de
  change).

**Opções (PERGUNTAR ao usuário — é decisão de UX):**
- **(A) Telas de operação = entrada rápida; `/historico` = edição/correção + criação em
  lote (recomendado):** manter as duas, mas extrair a lógica de form compartilhada
  (campos título/qtd/valor/data, validações, labels) para componentes reutilizáveis em
  `components/` e usados pelos dois lados. Remove duplicação sem remover atalhos.
- **(B) `/historico` vira o único criador:** `/aportes` e `/aprovacoes` viram só leitura/
  atalhos que abrem o `CreateModal`. Menos código, porém muda bastante o fluxo do usuário.
- **(C) Status quo + só extrair helpers de validação/labels:** menor mudança.

**Plano (assumindo A):**
1. Inventariar os campos/validações repetidos entre `AportesView`, `AprovacoesView` e
   `CreateModal`.
2. Extrair um componente de formulário (ou hooks) compartilhado para "lançamento"
   (aporte/saída), parametrizado por modo (instantâneo vs staged) e por papel (admin).
3. Reapontar as 3 telas para o componente comum. Reinvestimento pode virar um sub-form
   compartilhado também (origem→destinos).
4. Garantir que ambos os caminhos usem os mesmos textos/labels (hoje há `TYPE_LABELS`
   duplicados em `aprovacoes/index.tsx`, `MyPatrimony.tsx`, `lib/events.ts` — centralizar
   em `lib/events.ts`).

**Gotchas:**
- Criação instantânea (operação) chama RPCs diretas; criação no histórico empilha
  `EventChange` e manda `apply_event_changes`. O componente comum deve abstrair o
  "commit" (callback), não assumir um dos dois.
- Não regredir permissões: despesa direta só admin; cotista só cria o próprio (ver
  `pap_require_admin_or_owner` no backend e `canManageEvent`/`isAdmin` na UI).

**Impacto em testes:** UI (`tests/views.test.tsx`, `tests/historico-batch.test.tsx`) pode
precisar de ajustes de seletor se a marcação mudar. Backend intacto.

**Pronto quando:** uma só fonte de form/labels alimenta as telas; comportamento e
permissões preservados; `test`/`build`/`lint` verdes.

---

## Item 8 — `v_cotista_balance` depende de `monthly_obligations` existir ✅ CONCLUÍDO

Migração `20260620270000_cotista_balance_all_profiles.sql`. A view passou a ser ancorada
em `profiles` (LEFT JOIN obrigações + contribuições + resgates), então TODO cotista tem
linha mesmo sem obrigações geradas — `withdrawn_total`/`repayment_outstanding` deixam de
sumir e o card "Resgate a repor" volta a renderizar. **Sintoma real encontrado em uso:**
um RESGATE_PESSOAL não aparecia em `MyPatrimony` porque, sem `generate_monthly_obligations`
rodado, a view retornava `[]` para o cotista (a adimplência mostrava "Em dia" e o balde de
resgate ficava invisível). Colunas/semântica idênticas; só mudou a base do FROM. Item 6
ficou em (A), então este foi isolado. Teste em `tests/repayment.test.ts` (cotista com
resgate e sem obrigações). 83 testes verdes; build/lint ok. Ver `CLAUDE.md`. Detalhe
original mantido abaixo.

---

**Objetivo:** garantir que o saldo total e o indicador "resgate a repor" apareçam para
QUALQUER cotista, mesmo sem obrigações mensais geradas.

**Por quê (lacuna latente):** `v_cotista_balance` (e `v_monthly_obligations`) têm `FROM
monthly_obligations` como base — então só retornam linha para cotistas que já têm
obrigações geradas (`generate_monthly_obligations` é manual / cron mensal). Um cotista
com um RESGATE_PESSOAL mas sem obrigações geradas **não apareceria** na view, e o
`repayment_outstanding` (logo o card "Resgate a repor" em `MyPatrimony`) ficaria invisível.
Em produção isso hoje não morde porque as obrigações são geradas desde a abertura, mas é
uma dependência implícita frágil.

**Evidência:**
- View: `supabase/migrations/20260620260000_aporte_reposition_split.sql`
  (`v_cotista_balance` com `FROM monthly_obligations o ... GROUP BY o.profile_id`).
- Consumo: `src/views/dashboards/MyPatrimony.tsx` (card "Resgate a repor"),
  `src/views/aportes/index.tsx` (sugestão de divisão lê `repayment_outstanding`).

**Plano (quando for mexer):** basear a view em `profiles` (LEFT JOIN obrigações +
contribuições + resgates) em vez de `monthly_obligations`, de modo que todo cotista
tenha linha. Cuidado: `total_expected` passa a `COALESCE(Σ amount_expected, 0)` — um
cotista sem obrigações fica com `balance = −total_paid` (crédito), o que é coerente.

**Dependência:** entrelaçado com o **Item 6** (destino de `monthly_obligations`). Se o
Item 6 for por **(B)** (derivar meses on-the-fly de config + data de abertura), esta
lacuna some junto — então **decidir o Item 6 antes**, e só fazer o Item 8 isolado se o
Item 6 ficar em **(A)**.

**Pronto quando:** um cotista com resgate e sem obrigações geradas aparece na view com
`repayment_outstanding` correto; suíte verde (cobrir esse caso em `tests/repayment.test.ts`).

---

## Ordem e dependências

1. **Item 2** (datas) — isolado, rápido, sem migração.
2. **Item 3** (conferência de resgate) — depende de decisão A/B/C (perguntar).
3. **Item 4** (helper de IR) — isolado no banco; testes existentes são o oráculo.
4. **Item 5** (REJECTED) — isolado, frontend.
5. **Item 6** (obrigações) — depende de decisão A/B (perguntar); maior risco.
6. **Item 7** (consolidar criação) — depende de decisão A/B/C (perguntar); melhor por
   último (encosta em quase todas as telas e se beneficia dos itens 2 e 5 já feitos).
7. **Item 8** (`v_cotista_balance` × obrigações) — fazer JUNTO/DEPOIS do Item 6 (se o 6
   for B, resolve-se de graça; se for A, é um ajuste isolado de view + teste).
