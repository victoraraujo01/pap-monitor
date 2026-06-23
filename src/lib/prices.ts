import { supabase } from '@/services/supabase'

// Data de hoje em 'YYYY-MM-DD' (mesma convenção usada nos formulários).
export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// Espelha pap_price_on(bond, data): último preço com date <= data; na falta, o
// primeiro posterior. Lê bond_price_history direto (tem GRANT SELECT) em vez da
// RPC SECURITY DEFINER — mesma semântica de carry-forward do helper SQL, e o
// padrão que a tela de admin já usava para sugerir o preço do lote em D0.
export async function fetchPriceOn(
  bondId: string,
  onDate: string,
): Promise<number | null> {
  if (!bondId || !onDate) return null
  const before = await supabase
    .from('bond_price_history')
    .select('price')
    .eq('bond_id', bondId)
    .lte('date', onDate)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (before.data) return before.data.price
  const after = await supabase
    .from('bond_price_history')
    .select('price')
    .eq('bond_id', bondId)
    .gt('date', onDate)
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle()
  return after.data?.price ?? null
}
