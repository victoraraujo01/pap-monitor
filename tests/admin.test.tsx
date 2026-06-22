// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const rpc = vi.fn().mockResolvedValue({ data: null, error: null })

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
  profiles: {
    data: [
      { id: 'p1', name: 'Joao' },
      { id: 'p2', name: 'Maria' },
    ],
  },
  transactions: { data: [] },
}

function builder(result: { data: unknown[] }) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'lte', 'gt', 'order', 'limit']) {
    b[m] = vi.fn(() => b)
  }
  b.then = (resolve: (r: { data: unknown[] }) => unknown) =>
    Promise.resolve(result).then(resolve)
  b.maybeSingle = () =>
    Promise.resolve({ data: (result.data as unknown[])[0] ?? null })
  return b
}

vi.mock('@/services/supabase', () => ({
  supabase: {
    from: vi.fn((t: string) => builder(tableData[t] ?? { data: [] })),
    rpc,
  },
}))

// useAuth com role mutável entre os testes.
let role: 'ADMIN' | 'COTISTA' = 'ADMIN'
vi.mock('@/context/useAuth', () => ({
  useAuth: () => ({
    profile: { id: 'p1', name: 'Joao', role },
    session: {},
    loading: false,
    signOut: vi.fn(),
  }),
}))

const { AdminView } = await import('@/views/admin')

beforeEach(() => rpc.mockClear())
afterEach(cleanup)

describe('AdminView (Fase 1)', () => {
  it('bloqueia não-admin', () => {
    role = 'COTISTA'
    render(<AdminView />)
    expect(screen.getByText(/Acesso restrito/i)).toBeInTheDocument()
  })

  it('admin grava saldo de abertura via set_opening_balance', async () => {
    role = 'ADMIN'
    const user = userEvent.setup()
    render(<AdminView />)

    await screen.findByRole('option', { name: 'Tesouro Selic 2027' })

    // Carteira: 1 título (Selic), qtd e preço.
    await user.selectOptions(screen.getByRole('combobox'), 'b1')
    await user.type(screen.getByPlaceholderText('Qtd'), '1')
    await user.type(screen.getByPlaceholderText('Preço unit. D0'), '10000')

    // Cotas por irmão: com a cota inicial em R$1, o PL de 10000 emite 10000
    // cotas — distribuir o total p/ as pendentes fecharem em zero.
    await user.type(screen.getAllByPlaceholderText('Cotas')[0], '10000')

    await user.click(
      screen.getByRole('button', { name: /gravar saldo de abertura/i }),
    )

    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith(
        'set_opening_balance',
        expect.objectContaining({
          p_admin_id: 'p1',
          p_lots: [{ bond_id: 'b1', quantity: 1, price: 10000 }],
          p_quotas: [{ profile_id: 'p1', quotas: 10000 }],
          p_quota_price: 1,
        }),
      )
    })
  })
})
