import type { Tables } from '@/services/supabase'

// Lançamento do livro-razão (linha de transactions exibida no histórico).
export type EventRow = Pick<
  Tables<'transactions'>,
  | 'id'
  | 'type'
  | 'status'
  | 'amount_brl'
  | 'quantity'
  | 'event_date'
  | 'profile_id'
  | 'target_bond_id'
  | 'is_opening'
  | 'created_at'
  | 'note'
  | 'reposition_amount'
>

// Colunas lidas em toda listagem de eventos (preview e página completa).
export const EVENT_SELECT =
  'id, type, status, amount_brl, quantity, event_date, profile_id, target_bond_id, is_opening, created_at, note, reposition_amount'

export const TYPE_LABELS: Record<string, string> = {
  APORTE: 'Aporte',
  RESGATE_PESSOAL: 'Resgate',
  DESPESA_PAIS: 'Despesa',
  REINVESTIMENTO: 'Reinvestimento',
}

// Rótulo do status de uma transação. Fonte única (reusado por aprovacoes e historico).
export const STATUS_LABELS: Record<string, string> = {
  APPROVED: 'Aprovado',
  PENDING_APPROVAL: 'Pendente',
}

// Quem pode editar/excluir um lançamento: admin (qualquer um), cotista (só os
// próprios). Lançamentos de abertura são geridos pelo saldo de abertura.
export function canManageEvent(
  ev: Pick<EventRow, 'profile_id' | 'is_opening'>,
  caller: { id: string; role: string | null } | null | undefined,
): boolean {
  if (!caller || ev.is_opening) return false
  if (caller.role === 'ADMIN') return true
  return ev.profile_id === caller.id
}

// ---------------------------------------------------------------------------
// Alterações em batch (RPC apply_event_changes). Cada change carrega um `ref`
// (id de cliente): o transaction_id para update/delete, um id temporário para
// create. Em erro, o banco devolve "ref=<ref>|item N: ..." para destacar a linha.
// ---------------------------------------------------------------------------
export type CreateAporteChange = {
  ref: string
  op: 'create'
  kind: 'APORTE'
  profile_id: string
  bond_id: string
  quantity: number
  amount_brl: number
  event_date: string
  note?: string
  // Parte do aporte destinada a abater resgate (rótulo contábil; não mexe em PL/cotas).
  reposition_amount?: number
}

export type CreateWithdrawalChange = {
  ref: string
  op: 'create'
  kind: 'WITHDRAWAL'
  type: 'RESGATE_PESSOAL' | 'DESPESA_PAIS'
  direct: boolean
  profile_id: string
  bond_id: string
  quantity: number
  amount_brl: number
  event_date: string
  note?: string
}

export type CreateChange = CreateAporteChange | CreateWithdrawalChange

export type UpdateChange = {
  ref: string
  op: 'update'
  transaction_id: string
  bond_id: string
  quantity: number
  amount_brl: number
  event_date: string
  // '' limpa a nota; texto substitui; ausência/undefined mantém a atual.
  note?: string
  // Reposição (só APORTE). Ausente = mantém a atual; número = substitui. Depende da
  // migração …320000 (pap_update_transaction_core) para ter efeito no backend.
  reposition_amount?: number
}

export type DeleteChange = {
  ref: string
  op: 'delete'
  transaction_id: string
}

// Op pendente sobre uma linha já existente (mapeada por transaction_id).
export type RowChange = UpdateChange | DeleteChange

export type EventChange = CreateChange | RowChange

// Extrai o `ref` do item que falhou da mensagem de erro ("ref=<ref>|item N: ...").
export function parseFailedRef(
  message: string | undefined | null,
): string | null {
  if (!message) return null
  const m = message.match(/ref=([^|]+)\|/)
  return m ? m[1] : null
}
