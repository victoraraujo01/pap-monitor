// Tipos e helpers puros do formulário de operação compartilhado (OperationFields).
// Separado do componente para não violar react-refresh/only-export-components.

// Tipos de operação cobertos pelo formulário compartilhado. Reinvestimento fica de
// fora (UI própria na AportesView, edição bloqueada no histórico).
export type OperationKind =
  | 'APORTE'
  | 'RESGATE_PESSOAL'
  | 'DESPESA_PAIS'
  | 'DESPESA_DIRETA'

// Valores canônicos do formulário (todos string, no padrão dos inputs). A verdade
// enviada às RPCs é sempre qtd + valor total; o preço unitário é derivado dentro do
// TreasuryAmountInput. `eventDate` vazio = hoje. `repositionAmount` vazio = usar a
// sugestão automática da divisão (só relevante p/ APORTE com saldo a repor).
export type OperationValues = {
  bondId: string
  eventDate: string
  quantity: string
  amount: string
  note: string
  repositionAmount: string
}

export function emptyOperationValues(eventDate = ''): OperationValues {
  return {
    bondId: '',
    eventDate,
    quantity: '',
    amount: '',
    note: '',
    repositionAmount: '',
  }
}

// Título mínimo para o select. `is_available_for_purchase` é opcional: quando o pai
// já filtra a lista (páginas), o campo pode faltar e o aporte mantém tudo; quando o
// pai passa o catálogo inteiro (modais), o aporte filtra pelos compráveis.
export type BondOption = {
  id: string
  api_reference_name: string
  display_name: string | null
  is_available_for_purchase?: boolean | null
}

export function bondLabel(b: BondOption | null | undefined): string {
  if (!b) return '—'
  return b.display_name ?? b.api_reference_name
}

export const KIND_LABELS: Record<OperationKind, string> = {
  APORTE: 'Aporte',
  RESGATE_PESSOAL: 'Resgate pessoal',
  DESPESA_PAIS: 'Despesa dos pais (proposta)',
  DESPESA_DIRETA: 'Despesa dos pais (direta)',
}

// Divisão sugerida do aporte: cobre 1 mensalidade na obrigação e repõe o excedente,
// limitado ao que ainda falta repor. Pura — reusada na UI e no submit do pai.
export function suggestedReposition(
  amount: number,
  outstanding: number,
  monthly: number,
): number {
  if (!(amount > 0) || !(outstanding > 0)) return 0
  const repoMax = Math.min(amount, outstanding)
  return Math.min(Math.max(amount - monthly, 0), repoMax)
}

// Reposição efetiva dado o campo (''/sugestão ou valor digitado), clampada a [0, min(
// amount, outstanding)]. O pai chama isto no submit para montar `reposition_amount`.
export function effectiveReposition(
  amount: number,
  repositionField: string,
  outstanding: number,
  monthly: number,
): number {
  const repoMax = Math.min(amount > 0 ? amount : 0, outstanding)
  if (repositionField === '')
    return suggestedReposition(amount, outstanding, monthly)
  return Math.min(Math.max(Number(repositionField) || 0, 0), repoMax)
}
