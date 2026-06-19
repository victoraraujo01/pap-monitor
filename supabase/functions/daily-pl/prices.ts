// Parsing puro da resposta da API de Tesouro Direto da brapi (CdU 1).
// SEM dependências de Deno/rede para poder ser importado também pelos testes
// (Vitest, ambiente node). O index.ts (Deno) faz o fetch e chama estas funções.
//
// brapi: GET https://brapi.dev/api/v2/treasury/list  (Authorization: Bearer <token>)
// Resposta: { results: [{ symbol, bondType, maturityDate, sellPrice, buyPrice,
//             basePrice, ... }], ... }  — docs: https://brapi.dev/docs/tesouro-direto

export const DEFAULT_TESOURO_API_URL = 'https://brapi.dev/api/v2/treasury/list'

// Converte para Number finito e positivo, ou null. Aceita number ou string
// (a brapi devolve number, mas mantemos robusto a "1234.56"/"1.234,56").
export function parsePrice(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null
  }
  if (typeof value === 'string') {
    const s = value.trim()
    // Heurística pt-BR: se tem vírgula decimal, remove milhar e troca vírgula.
    const normalized = s.includes(',')
      ? s.replace(/\./g, '').replace(',', '.')
      : s
    const n = Number(normalized)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return null
}

interface BrapiTreasury {
  symbol?: unknown // id único, ex.: "tesouro-selic-01032031"
  bondType?: unknown // ex.: "Tesouro Selic"
  maturityDate?: unknown // ex.: "2031-03-01"
  sellPrice?: unknown // valor de resgate (o que o fundo realiza) — preferido
  basePrice?: unknown // preço de referência — fallback
  buyPrice?: unknown // valor de investimento (compra) — fallback
}

interface BrapiResponse {
  results?: BrapiTreasury[]
}

// Nome no estilo do catálogo a partir de bondType + ano de vencimento:
// { bondType: "Tesouro Selic", maturityDate: "2027-03-01" } → "Tesouro Selic 2027".
function derivedName(bondType: string, maturityDate: unknown): string | null {
  if (typeof maturityDate !== 'string') return null
  const year = maturityDate.slice(0, 4)
  if (!/^\d{4}$/.test(year)) return null
  return `${bondType} ${year}`
}

// Extrai um mapa chave→preço a partir do JSON da brapi. Cada título é indexado
// por DUAS chaves apontando para o mesmo preço: o `symbol` (id único da brapi) e
// o nome derivado "<bondType> <ano>" (casa com o api_reference_name do seed).
// Assim o catálogo casa tanto se guardar o symbol quanto o nome amigável.
// Preço = sellPrice (resgate) com fallback basePrice → buyPrice. Nunca lança.
export function parseBrapiTreasury(json: unknown): Map<string, number> {
  const prices = new Map<string, number>()
  const list = (json as BrapiResponse)?.results
  if (!Array.isArray(list)) {
    return prices
  }

  for (const bond of list) {
    if (!bond) continue
    const price =
      parsePrice(bond.sellPrice) ??
      parsePrice(bond.basePrice) ??
      parsePrice(bond.buyPrice)
    if (price === null) continue

    if (typeof bond.symbol === 'string' && bond.symbol.trim()) {
      prices.set(bond.symbol.trim(), price)
    }
    if (typeof bond.bondType === 'string' && bond.bondType.trim()) {
      const name = derivedName(bond.bondType.trim(), bond.maturityDate)
      if (name) prices.set(name, price)
    }
  }

  return prices
}
