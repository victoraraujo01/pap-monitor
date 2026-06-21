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
>

// Colunas lidas em toda listagem de eventos (preview e página completa).
export const EVENT_SELECT =
  'id, type, status, amount_brl, quantity, event_date, profile_id, target_bond_id, is_opening, created_at'

export const TYPE_LABELS: Record<string, string> = {
  APORTE: 'Aporte',
  RESGATE_PESSOAL: 'Resgate',
  DESPESA_PAIS: 'Despesa',
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
