// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock do supabase: builder encadeável thenable + rpc. Cada tabela resolve para
// um dataset fixo; rpc registra as chamadas para checarmos nome + argumentos.
const rpc = vi.fn().mockResolvedValue({ data: 1, error: null })

const tableData: Record<string, { data: unknown[] }> = {
  treasury_bonds: {
    data: [
      {
        id: 'b1',
        api_reference_name: 'Tesouro Selic 2027',
        display_name: 'Tesouro Selic 2027',
      },
    ],
  },
  transactions: { data: [] },
  profiles: { data: [] },
}

function builder(result: { data: unknown[] }) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit']) {
    b[m] = vi.fn(() => b)
  }
  b.then = (resolve: (r: { data: unknown[] }) => unknown) =>
    Promise.resolve(result).then(resolve)
  return b
}

vi.mock('@/services/supabase', () => ({
  supabase: {
    from: vi.fn((t: string) => builder(tableData[t] ?? { data: [] })),
    rpc,
  },
}))

// useAuth fixo: cotista logado.
vi.mock('@/context/useAuth', () => ({
  useAuth: () => ({
    profile: { id: 'p1', name: 'Tester', role: 'COTISTA' },
    session: {},
    loading: false,
    signOut: vi.fn(),
  }),
}))

const { AportesView } = await import('@/views/aportes')
const { AprovacoesView } = await import('@/views/aprovacoes')

beforeEach(() => rpc.mockClear())
afterEach(cleanup)

describe('AportesView (CdU 2)', () => {
  it('chama register_aporte com os argumentos do formulário', async () => {
    const user = userEvent.setup()
    render(<AportesView />)

    // espera o título carregar no dropdown
    await screen.findByRole('option', { name: 'Tesouro Selic 2027' })

    await user.selectOptions(screen.getByRole('combobox'), 'b1')
    const [qty, price] = screen.getAllByRole('spinbutton')
    await user.type(qty, '2')
    await user.type(price, '100')
    await user.click(screen.getByRole('button', { name: /registrar aporte/i }))

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('register_aporte', {
        p_profile_id: 'p1',
        p_bond_id: 'b1',
        p_quantity: 2,
        p_purchase_price: 100,
      }),
    )
  })
})

describe('AprovacoesView (CdU 3-4)', () => {
  it('chama request_withdrawal com o tipo padrão (resgate pessoal)', async () => {
    const user = userEvent.setup()
    render(<AprovacoesView />)

    await screen.findByRole('option', { name: 'Tesouro Selic 2027' })

    // primeiro combobox = tipo (default RESGATE_PESSOAL); segundo = título
    const [, bondSelect] = screen.getAllByRole('combobox')
    await user.selectOptions(bondSelect, 'b1')
    await user.type(screen.getByRole('spinbutton'), '500')
    await user.click(screen.getByRole('button', { name: /solicitar saída/i }))

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('request_withdrawal', {
        p_profile_id: 'p1',
        p_bond_id: 'b1',
        p_amount_brl: 500,
        p_type: 'RESGATE_PESSOAL',
      }),
    )
  })

  it('mostra estado vazio quando não há despesas pendentes', async () => {
    render(<AprovacoesView />)
    expect(
      await screen.findByText(/nenhuma despesa pendente/i),
    ).toBeInTheDocument()
  })
})
