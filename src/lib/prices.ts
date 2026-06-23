import { supabase } from '@/services/supabase'

// Data de hoje em 'YYYY-MM-DD' (mesma convenção usada nos formulários).
export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// Lado da cotação: 'sell' = PU Venda (resgate/despesa/valorização do PL); 'buy' =
// PU Compra (aporte e destinos de reinvestimento — o que a B3 cobra ao adquirir). O
// CSV do Tesouro traz as duas pontas e há um spread entre elas.
export type PriceSide = 'sell' | 'buy'

type PriceRow = { price: number; buy_price: number | null }

function pickSide(row: PriceRow, side: PriceSide): number {
  // No lado compra usa buy_price; se o título não tiver PU Compra publicado, cai no
  // PU Venda como fallback (melhor que nada).
  return side === 'buy' ? (row.buy_price ?? row.price) : row.price
}

// Espelha pap_price_on(bond, data): último preço com date <= data; na falta, o
// primeiro posterior. Lê bond_price_history direto (tem GRANT SELECT) em vez da
// RPC SECURITY DEFINER — mesma semântica de carry-forward do helper SQL, e o
// padrão que a tela de admin já usava para sugerir o preço do lote em D0.
export async function fetchPriceOn(
  bondId: string,
  onDate: string,
  side: PriceSide = 'sell',
): Promise<number | null> {
  if (!bondId || !onDate) return null
  const before = await supabase
    .from('bond_price_history')
    .select('price, buy_price')
    .eq('bond_id', bondId)
    .lte('date', onDate)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (before.data) return pickSide(before.data, side)
  const after = await supabase
    .from('bond_price_history')
    .select('price, buy_price')
    .eq('bond_id', bondId)
    .gt('date', onDate)
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle()
  return after.data ? pickSide(after.data, side) : null
}
