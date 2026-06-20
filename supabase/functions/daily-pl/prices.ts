// Parsing puro do CSV de Preços e Taxas do Tesouro Transparente (CdU 1).
// Fonte oficial do governo, gratuita e sem token:
//   https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv
// SEM dependências de Deno/rede para poder ser importado também pelos testes
// (Vitest, ambiente node). O index.ts (Deno) faz o fetch do CSV e chama isto.
//
// Formato (separador ';', decimal vírgula, datas dd/mm/yyyy), 8 colunas:
//   Tipo Titulo;Data Vencimento;Data Base;Taxa Compra;Taxa Venda;
//   PU Compra Manha;PU Venda Manha;PU Base Manha
// O CSV traz TODO o histórico (~13MB), então ficamos com a Data Base mais
// recente de cada título. Preço = PU Venda Manha (resgate, o que o fundo realiza).

export const DEFAULT_TESOURO_API_URL =
  'https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv'

// Só Tesouro Selic e IPCA+ (exatos, sem "com Juros Semestrais") — decisão do dono.
const ALLOWED_TYPES = new Set(['Tesouro Selic', 'Tesouro IPCA+'])

// Converte "19.240,11" / "19240,11" / number → Number finito e positivo, ou null.
export function parsePrice(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null
  }
  if (typeof value === 'string') {
    const s = value.trim()
    const normalized = s.includes(',')
      ? s.replace(/\./g, '').replace(',', '.')
      : s
    const n = Number(normalized)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return null
}

// dd/mm/yyyy → "yyyymmdd" (comparável lexicograficamente), ou null.
function toDateKey(ddmmyyyy: string): string | null {
  const [d, m, y] = ddmmyyyy.split('/')
  if (!d || !m || !y || !/^\d{4}$/.test(y)) return null
  return `${y}${m.padStart(2, '0')}${d.padStart(2, '0')}`
}

// dd/mm/yyyy → "yyyy-mm-dd" (ISO, formato aceito pelo PostgreSQL), ou null.
function toIsoDate(ddmmyyyy: string): string | null {
  const [d, m, y] = ddmmyyyy.split('/')
  if (!d || !m || !y || !/^\d{4}$/.test(y)) return null
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

// Extrai um mapa nome→preço a partir do CSV. O nome é derivado como
// "<Tipo Titulo> <ano de vencimento>" (ex.: "Tesouro Selic 2027"), que casa com
// o api_reference_name do catálogo. Mantém só a Data Base mais recente de cada
// título. Ignora cabeçalho, tipos fora de Selic/IPCA+ e linhas malformadas.
export function parseTesouroTransparente(csv: string): Map<string, number> {
  // name → registro mais recente conhecido
  const latest = new Map<string, { dateKey: string; price: number }>()

  for (const line of csv.split(/\r?\n/)) {
    if (!line) continue
    const cols = line.split(';')
    if (cols.length < 8) continue

    const tipo = cols[0].trim()
    if (!ALLOWED_TYPES.has(tipo)) continue // descarta cabeçalho e outros tipos

    const year = cols[1].trim().split('/')[2]
    if (!year || !/^\d{4}$/.test(year)) continue

    const dateKey = toDateKey(cols[2].trim())
    if (!dateKey) continue

    // PU Venda Manha (resgate) com fallback PU Base → PU Compra.
    const price =
      parsePrice(cols[6]) ?? parsePrice(cols[7]) ?? parsePrice(cols[5])
    if (price === null) continue

    const name = `${tipo} ${year}`
    const prev = latest.get(name)
    if (!prev || dateKey > prev.dateKey) {
      latest.set(name, { dateKey, price })
    }
  }

  const prices = new Map<string, number>()
  for (const [name, rec] of latest) prices.set(name, rec.price)
  return prices
}

export type HistoryRow = { name: string; date: string; price: number }

// Modo backfill (Fase 2): extrai TODAS as datas (não só a mais recente) de cada
// título Selic/IPCA+ do CSV, no formato { name, date (ISO), price }. Alimenta
// bond_price_history via update_bond_price_history, base do replay histórico.
export function parseTesouroHistory(csv: string): HistoryRow[] {
  const rows: HistoryRow[] = []

  for (const line of csv.split(/\r?\n/)) {
    if (!line) continue
    const cols = line.split(';')
    if (cols.length < 8) continue

    const tipo = cols[0].trim()
    if (!ALLOWED_TYPES.has(tipo)) continue

    const year = cols[1].trim().split('/')[2]
    if (!year || !/^\d{4}$/.test(year)) continue

    const date = toIsoDate(cols[2].trim())
    if (!date) continue

    const price =
      parsePrice(cols[6]) ?? parsePrice(cols[7]) ?? parsePrice(cols[5])
    if (price === null) continue

    rows.push({ name: `${tipo} ${year}`, date, price })
  }

  return rows
}
