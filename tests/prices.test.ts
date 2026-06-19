import { describe, expect, it } from 'vitest'
import {
  parsePrice,
  parseTesouroTransparente,
} from '../supabase/functions/daily-pl/prices'

// Parser puro do CSV do Tesouro Transparente usado pela Edge Function daily-pl
// (CdU 1). Sem rede: só a transformação CSV → mapa nome→preço (Selic/IPCA+,
// Data Base mais recente, PU Venda Manha).

const HEADER =
  'Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;PU Compra Manha;PU Venda Manha;PU Base Manha'

describe('parsePrice', () => {
  it('aceita number positivo e string pt-BR (com/sem milhar)', () => {
    expect(parsePrice(1234.56)).toBe(1234.56)
    expect(parsePrice('19240,11')).toBe(19240.11)
    expect(parsePrice('19.240,11')).toBe(19240.11)
  })
  it('rejeita zero, negativo e lixo', () => {
    expect(parsePrice('0')).toBeNull()
    expect(parsePrice(-5)).toBeNull()
    expect(parsePrice('abc')).toBeNull()
    expect(parsePrice(null)).toBeNull()
  })
})

describe('parseTesouroTransparente', () => {
  it('deriva "<Tipo> <ano>", usa PU Venda Manha e só Selic/IPCA+', () => {
    const csv = [
      HEADER,
      'Tesouro Selic;01/03/2027;18/06/2026;0,01;0,02;19251,61;19240,11;19240,11',
      'Tesouro IPCA+;15/05/2035;18/06/2026;8,09;8,21;2378,95;2354,71;2354,71',
      // tipos fora do escopo são ignorados:
      'Tesouro Prefixado;01/01/2027;18/06/2026;13,1;13,2;820,00;812,43;812,43',
      'Tesouro IPCA+ com Juros Semestrais;15/08/2060;18/06/2026;7,0;7,1;100,0;99,0;99,0',
    ].join('\n')

    const map = parseTesouroTransparente(csv)
    expect(map.get('Tesouro Selic 2027')).toBe(19240.11)
    expect(map.get('Tesouro IPCA+ 2035')).toBe(2354.71)
    expect(map.has('Tesouro Prefixado 2027')).toBe(false)
    expect(map.has('Tesouro IPCA+ com Juros Semestrais 2060')).toBe(false)
    expect(map.size).toBe(2)
  })

  it('mantém apenas a Data Base mais recente de cada título', () => {
    const csv = [
      HEADER,
      'Tesouro Selic;01/03/2027;10/06/2026;0,01;0,02;100,00;100,00;100,00',
      'Tesouro Selic;01/03/2027;18/06/2026;0,01;0,02;200,00;200,00;200,00', // mais recente
      'Tesouro Selic;01/03/2027;05/06/2026;0,01;0,02;50,00;50,00;50,00',
    ].join('\n')

    const map = parseTesouroTransparente(csv)
    expect(map.get('Tesouro Selic 2027')).toBe(200.0)
    expect(map.size).toBe(1)
  })

  it('cai para PU Base quando PU Venda é inválido; ignora malformados', () => {
    const csv = [
      HEADER,
      'Tesouro Selic;01/03/2028;18/06/2026;0,01;0,02;0;0;19232,74', // venda 0 → usa base
      'linha;curta;demais', // poucas colunas
      '', // vazia
    ].join('\n')

    const map = parseTesouroTransparente(csv)
    expect(map.get('Tesouro Selic 2028')).toBe(19232.74)
    expect(map.size).toBe(1)
  })

  it('retorna mapa vazio para CSV só com cabeçalho', () => {
    expect(parseTesouroTransparente(HEADER).size).toBe(0)
    expect(parseTesouroTransparente('').size).toBe(0)
  })
})
