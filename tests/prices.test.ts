import { describe, expect, it } from 'vitest'
import {
  parsePrice,
  parseBrapiTreasury,
} from '../supabase/functions/daily-pl/prices'

// Parser puro da resposta da brapi (/api/v2/treasury/list) usado pela Edge
// Function daily-pl (CdU 1). Sem rede: só a transformação JSON → mapa chave→preço.

describe('parsePrice', () => {
  it('aceita number positivo finito', () => {
    expect(parsePrice(1234.56)).toBe(1234.56)
  })
  it('rejeita zero, negativo e não-finito', () => {
    expect(parsePrice(0)).toBeNull()
    expect(parsePrice(-5)).toBeNull()
    expect(parsePrice(NaN)).toBeNull()
  })
  it('converte strings (incl. pt-BR) e rejeita lixo', () => {
    expect(parsePrice('812.43')).toBe(812.43)
    expect(parsePrice('2.210,94')).toBe(2210.94)
    expect(parsePrice('abc')).toBeNull()
    expect(parsePrice(null)).toBeNull()
  })
})

describe('parseBrapiTreasury', () => {
  const sample = {
    results: [
      {
        symbol: 'tesouro-selic-01032027',
        bondType: 'Tesouro Selic',
        maturityDate: '2027-03-01',
        sellPrice: 16000.0,
        buyPrice: 16005.0,
        basePrice: 15999.0,
      },
      {
        // sem sellPrice → cai em basePrice
        symbol: 'tesouro-prefixado-01012027',
        bondType: 'Tesouro Prefixado',
        maturityDate: '2027-01-01',
        basePrice: 850.0,
      },
      {
        // só buyPrice
        symbol: 'tesouro-ipca-15052035',
        bondType: 'Tesouro IPCA+',
        maturityDate: '2035-05-15',
        buyPrice: 2300.0,
      },
    ],
  }

  it('indexa por symbol E por "<bondType> <ano>", preferindo sellPrice', () => {
    const map = parseBrapiTreasury(sample)
    // por symbol
    expect(map.get('tesouro-selic-01032027')).toBe(16000.0)
    // por nome derivado (casa com o api_reference_name do seed)
    expect(map.get('Tesouro Selic 2027')).toBe(16000.0)
    expect(map.get('Tesouro Prefixado 2027')).toBe(850.0) // fallback basePrice
    expect(map.get('Tesouro IPCA+ 2035')).toBe(2300.0) // fallback buyPrice
  })

  it('pula títulos sem preço utilizável, sem lançar', () => {
    const map = parseBrapiTreasury({
      results: [
        { symbol: 'x', bondType: 'Tesouro Selic', maturityDate: '2029-01-01' }, // sem preço
        {
          symbol: 'y',
          bondType: 'Tesouro Selic',
          maturityDate: '2031-01-01',
          sellPrice: 0,
        }, // preço <= 0
        {
          symbol: 'bom',
          bondType: 'Tesouro Selic',
          maturityDate: '2032-01-01',
          sellPrice: 50,
        },
      ],
    })
    expect(map.get('bom')).toBe(50)
    expect(map.get('Tesouro Selic 2032')).toBe(50)
    expect(map.has('x')).toBe(false)
    expect(map.has('y')).toBe(false)
  })

  it('retorna mapa vazio para formatos inesperados', () => {
    expect(parseBrapiTreasury(null).size).toBe(0)
    expect(parseBrapiTreasury({}).size).toBe(0)
    expect(parseBrapiTreasury({ results: 'x' }).size).toBe(0)
  })
})
