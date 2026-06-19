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
supabase/migrations/           # SQL versionado (a migração inicial transcreve docs/03)
src/
├── views/
│   ├── dashboards/            # Casos de Uso 5, 6, 7 (histórico fundo/individual, comparativo)
│   ├── aportes/               # Caso de Uso 2 (registro de aporte)
│   └── aprovacoes/            # Casos de Uso 3, 4 (saídas e aprovação de despesa)
├── services/supabase/
│   ├── client.ts              # createClient<Database> tipado; importe o `supabase` daqui
│   ├── index.ts               # reexports: supabase, Tables/Insert/Update, enums
│   └── database.types.ts      # GERADO por `npm run gen:types` — NÃO editar à mão
├── lib/                       # utilitários (vazio)
└── types/                     # tipos compartilhados (vazio)
```

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

## Decisões e convenções deste projeto

- **Sem RLS** por decisão do dono: uso privado por 3 cotistas, todos veem tudo.
- **`docs/` é imutável e está no `.prettierignore`.** Prettier já achatou a indentação
  do SQL em `docs/03` uma vez — nunca rode formatador sobre `docs/`. Trate como spec.
- `database.types.ts` é gerado (`gen:types`) e ignorado por prettier/eslint; não editar.
- `.env` (local, gitignored) tem `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
  Modelo em `.env.example`. Vite só expõe vars com prefixo `VITE_`.
- Estilo: Prettier (`semi:false`, `singleQuote`, `trailingComma:all`, printWidth 80).
- Antes de considerar uma tarefa pronta: `npm run build` (typecheck) + `npm run lint`.

## Estado atual / roadmap

Feito: scaffold front, Tailwind, ESLint+Prettier, cliente Supabase tipado, migração
inicial aplicada no DB local, tipos gerados, árvore de diretórios.

**Ainda NÃO implementado** (próximas rodadas):
- Auth: trigger de criação de `profiles` no signup; proteção de rotas; contexto de sessão.
- Motor de PL: Edge Function (CdU 1) + agendamento `pg_cron` + procedure de IR/FIFO.
- Telas/componentes das views (hoje só placeholders).
- Lógica de aporte/resgate/aprovação (CdU 2–4) — provavelmente como RPCs/funções no DB
  para garantir atomicidade de cotas + lotes.
- GitHub Action de keep-alive.
- Seed do catálogo de títulos.
