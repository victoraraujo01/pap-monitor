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
