// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// Datasets por tabela. O builder é thenable e ignora a ordem dos filtros, então
// cada tabela resolve sempre para o mesmo conjunto (suficiente para os asserts).
const tableData: Record<string, { data: unknown[] }> = {
  // Linha única: o builder mock ignora order/limit, e FundEvolution (asc, .at(-1))
  // e MyPatrimony (desc, [0]) leem a mesma tabela esperando pontas opostas.
  pl_history: {
    data: [
      { date: '2026-06-19', total_pl_brl: 1200, quota_price: 1.1, total_quotas: 1090 },
    ],
  },
  fund_bond_lots: {
    data: [
      {
        quantity: 10,
        treasury_bonds: {
          display_name: 'Tesouro Selic 2027',
          api_reference_name: 'Tesouro Selic 2027',
          current_price: 100,
        },
      },
    ],
  },
  transactions: {
    data: [
      {
        id: 't1',
        profile_id: 'p1',
        type: 'APORTE',
        status: 'APPROVED',
        amount_brl: 1000,
        quotas_amount: 1000,
        created_at: '2026-06-19',
      },
    ],
  },
  monthly_obligations: { data: [] },
  profiles: {
    data: [
      { id: 'p1', name: 'Tester Um' },
      { id: 'p2', name: 'Tester Dois' },
    ],
  },
}

function builder(result: { data: unknown[] }) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) {
    b[m] = vi.fn(() => b)
  }
  b.then = (resolve: (r: { data: unknown[] }) => unknown) =>
    Promise.resolve(result).then(resolve)
  return b
}

vi.mock('@/services/supabase', () => ({
  supabase: {
    from: vi.fn((t: string) => builder(tableData[t] ?? { data: [] })),
    rpc: vi.fn(),
  },
}))

vi.mock('@/context/useAuth', () => ({
  useAuth: () => ({
    profile: { id: 'p1', name: 'Tester Um', role: 'COTISTA' },
    session: {},
    loading: false,
    signOut: vi.fn(),
  }),
}))

const { DashboardView } = await import('@/views/dashboards')

afterEach(cleanup)

describe('DashboardView (CdU 5-7)', () => {
  it('renderiza as três seções do painel', () => {
    render(<DashboardView />)
    expect(screen.getByText('Evolução do fundo')).toBeInTheDocument()
    expect(screen.getByText('Meu patrimônio')).toBeInTheDocument()
    expect(screen.getByText('Participação')).toBeInTheDocument()
  })

  it('mostra o PL mais recente e a composição da carteira (CdU 5)', async () => {
    render(<DashboardView />)
    // PL do último fechamento (1200) formatado em BRL.
    expect(await screen.findByText(/1\.200,00/)).toBeInTheDocument()
    expect(screen.getByText('Composição da carteira')).toBeInTheDocument()
    expect(await screen.findByText('Tesouro Selic 2027')).toBeInTheDocument()
  })

  it('calcula o patrimônio individual e marca o cotista logado (CdU 6/7)', async () => {
    render(<DashboardView />)
    // 1000 cotas × última cota 1,1 = R$ 1.100,00.
    expect(await screen.findByText(/1\.100,00/)).toBeInTheDocument()
    // O cotista logado aparece marcado como "(você)" na participação.
    expect(await screen.findByText(/Tester Um \(você\)/)).toBeInTheDocument()
  })
})
