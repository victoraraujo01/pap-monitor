# Plano: unificar formulário de operação + correções no modal

> Status: **aprovado, não implementado.** Decisões fechadas com o dono:
> split editável na edição (Fase 4 completa, com migração).

## Diagnóstico consolidado

| Sintoma | Causa-raiz | Correção |
|---|---|---|
| Edição não permite mexer na divisão resgate×aporte | `EditModal` tem campos hand-rolled sem o bloco de split; `pap_update_transaction_core` nem aceita `p_reposition_amount` | Compartilhar campos + migração no backend |
| 3 transcrições divergentes do form | Sem componente de campos compartilhado | Extrair `OperationFields` |
| Blur só no centro, header nítido | `animate-rise` (tailwind.config.js, fill-mode `both`, termina em `transform: translateY(0)`) deixa um `transform` no container → `fixed` ancora nele, não na viewport | `createPortal` no `document.body` |
| Modal estreito no desktop, chip sobrepõe o valor ("1R$ 19.177,52") | `max-w-md` (448px) aperta o grid de 3 colunas do `TreasuryAmountInput` | Largura responsiva + ajuste do chip |

## Escopo

- **Dentro:** aporte e saída (resgate/despesa/despesa direta) — as duas vias (páginas + modais).
- **Fora:** reinvestimento (mantém o `ReinvestmentCard` próprio na AportesView; edição segue bloqueada no histórico). Justificativa: a peça de proceeds/multi-destino/trava-de-soma é complexa e específica; misturá-la dilui o ganho.

---

## Fase 0 — Correções de UI do modal (rápido, isolável, sem backend)

**Arquivo:** `src/views/historico/index.tsx` (`ModalShell`).

1. **Portal.** Importar `createPortal` de `react-dom`. Envolver o retorno do `ModalShell`:
   ```tsx
   return createPortal(
     <div className="fixed inset-0 z-40 ...">…</div>,
     document.body,
   )
   ```
   Escapa o `transform` do `animate-rise` → `fixed inset-0` volta a ser viewport-relativo. O blur passa a cobrir a tela inteira (incl. header) e a centralização fica correta.

2. **z-index.** Subir o overlay de `z-30` para `z-40` (header é `z-20`, dropdown do avatar é `z-30`).

3. **Largura desktop.** Trocar `max-w-md` por `max-w-md sm:max-w-xl` no wrapper. O `TreasuryAmountInput` é `sm:grid-cols-3`; `xl` (576px) dá folga para qtd · unitário · total sem o chip atropelar o valor.

4. **Chip sobreposto.** O `pr-[5.5rem]` reserva espaço fixo mas valores longos ainda passam por baixo. Opções:
   - (a) Com o modal mais largo, valida visualmente — provavelmente some.
   - (b) Se persistir: mover o chip para *baixo* do campo (linha "Sugestão: R$ X · usar") em vez de overlay absoluto. Mais robusto; mexe no layout do `TreasuryAmountInput`.
   - **Recomendação: (a)**, cair em (b) só se a captura ainda mostrar colisão.

5. **Acessibilidade leve (oportunístico):** fechar no `Esc` e travar scroll do body enquanto aberto (`overflow-hidden`).

> Fase 0 entrega valor visível e não depende do resto. Pode ir sozinha num commit.

---

## Fase 1 — Extrair `OperationFields` (componente apresentacional)

**Novo arquivo:** `src/components/OperationFields.tsx`.

**Princípio:** componente "burro" — **não** faz `supabase.rpc`, **não** carrega catálogo/perfis/saldo. Recebe tudo por props e emite valores. Preserva a fronteira staging (histórico) × submit-instantâneo (páginas).

**API proposta:**
```tsx
type OperationKind = 'APORTE' | 'RESGATE_PESSOAL' | 'DESPESA_PAIS' | 'DESPESA_DIRETA'

type OperationValues = {
  bondId: string
  eventDate: string        // '' = hoje
  quantity: string
  amount: string
  note: string
  repositionAmount: string // só relevante p/ APORTE com outstanding
}

function OperationFields({
  kind,                    // controla priceSide, catálogo filtrado, label do valor, split
  bonds,                   // catálogo já filtrado pelo pai (aporte = compráveis; saída = todos)
  values, onChange,        // controlado: pai detém o estado
  repaymentOutstanding,    // >0 → renderiza bloco de split (default 0 = oculto)
  monthlyExpected,         // p/ sugestão da divisão
  showTypeSelector,        // páginas/modais que escolhem o tipo dentro do form
  isAdmin,                 // habilita "despesa direta"
}: {...})
```

**Renderiza (condicional por `kind`):**
- Seletor de tipo (quando `showTypeSelector`).
- Checkbox "lançar já aprovada" (admin + `DESPESA_PAIS`).
- Select de título (lista já filtrada pelo pai).
- `DateInput` (data).
- `TreasuryAmountInput` com `priceSide` derivado: `APORTE`→`buy`, saídas→`sell`; labels conforme tipo.
- **Bloco de divisão** (lógica `repoMax`/`suggestedRepo`/`obligationPart` movida da AportesView) quando `kind==='APORTE' && repaymentOutstanding>0`.
- `Textarea` de nota.

**Estado:** controlado pelo pai (`values`/`onChange`). A matemática do split fica no componente como cálculo puro, exposta via helper `splitOf(values, outstanding, monthly)` que o pai chama no submit.

**Sem regressão:** `TreasuryAmountInput` não muda (a menos da Fase 0 opção (b)).

---

## Fase 2 — Adotar nas páginas (dedupe real)

1. **`AportesView`** (card "Registrar aporte"): trocar o JSX dos campos por `<OperationFields kind="APORTE" .../>`, passando `repaymentOutstanding`/`monthlyExpected` que já carrega (`loadRepayment`). Mantém `handleSubmit` → `register_aporte`, recentes, sucesso. `ReinvestmentCard` **intacto**.
2. **`AprovacoesView`** (card "Registrar saída"): `<OperationFields>` com `kind` ligado ao seletor de tipo + `isAdmin` p/ despesa direta. Mantém `handleSubmit` → `request_withdrawal`, pendentes, "minhas saídas".

Resultado: split e campos passam a existir em **um** lugar; páginas viram cascas finas de fetch+submit.

---

## Fase 3 — Adotar nos modais do histórico (parity)

1. **`CreateModal`:** campos próprios → `<OperationFields>` com `showTypeSelector` + `isAdmin`. Para o split no create, o modal carrega `v_cotista_balance`/`v_monthly_obligations` do `profileId` selecionado (admin troca o cotista → re-fetch). Emite `CreateChange` com o novo `reposition_amount` (Fase 4).
2. **`EditModal`:** idem, `kind` derivado de `event.type` (sem seletor; reinvestimento continua não-editável e nem chega aqui). Carrega o `outstanding` do `event.profile_id` para o bloco de split. Emite `UpdateChange` com `reposition_amount`.

---

## Fase 4 — Backend: habilitar o split no histórico

**Nova migração** `…320000_reposition_in_event_changes.sql` (numeração de datas do projeto):

1. **`pap_update_transaction_core`**: adicionar `p_reposition_amount NUMERIC DEFAULT NULL` — `NULL` = mantém o atual (clamp como hoje); valor = substitui (validado `0 ≤ rep ≤ amount`). DROP+recreate por mudança de assinatura; atualizar o wrapper `update_transaction`.
2. **`apply_event_changes`**: no ramo `update`, repassar `reposition_amount` quando presente. (No ramo `create APORTE` já é repassado — só falta o campo chegar do front.)
3. **Tipos** (`src/lib/events.ts`): adicionar `reposition_amount?: number` a `CreateAporteChange` **e** `UpdateChange`; `effectiveValues` reflete a edição pendente.

> Sem impacto no motor: `reposition_amount` é rótulo contábil, não entra em PL/cotas/FIFO e já sobrevive ao replay. É puro threading SQL→tipos→UI.

**Testes** (Vitest, exige DB local): estender `tests/repayment.test.ts` — editar `reposition_amount` de um aporte via `apply_event_changes` (update) altera `v_cotista_balance.total_paid`/`repayment_outstanding` sem mexer em cotas/PL; create com reposição via batch idem.

---

## Fase 5 — Verificação

- `npm run build` (typecheck) + `npm run lint` + `npm run test` (todos verdes; hoje 91).
- Ajustar testes de UI dependentes da ordem/estrutura dos campos: `tests/views.test.tsx`, `tests/historico-batch.test.tsx` (builder mock e índices qtd[0]·unitário[1]·total[2]).
- Validação visual do modal (largura, blur de tela cheia, chip).
- Atualizar a seção de status no `CLAUDE.md` com a migração e o componente novos.

---

## Ordem de entrega sugerida (commits independentes)

1. **Fase 0** — correções de UI do modal (rápida, sem risco).
2. **Fases 1–3** — `OperationFields` + adoção nas 3 vias (create já manda reposição; update destrava na Fase 4).
3. **Fase 4** — migração + tipos + testes que destravam editar a divisão.

Risco maior na Fase 2 (mexer nas páginas em produção) — alternativa: fazer Fases 1+3 primeiro (modais ganham parity já) e adotar nas páginas por último, para minimizar exposição.
