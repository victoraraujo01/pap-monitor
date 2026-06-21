// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const rpc = vi.fn().mockResolvedValue({ data: { applied: 1 }, error: null })

const tableData: Record<string, { data: unknown[] }> = {
  treasury_bonds: {
    data: [
      {
        id: 'b1',
        api_reference_name: 'Tesouro Selic 2027',
        display_name: 'Tesouro Selic 2027',
        is_available_for_purchase: true,
      },
    ],
  },
  profiles: { data: [{ id: 'p1', name: 'Joao' }] },
  transactions: {
    data: [
      {
        id: 't1',
        type: 'APORTE',
        status: 'APPROVED',
        amount_brl: 1000,
        quantity: 0.1,
        event_date: '2026-01-10',
        profile_id: 'p1',
        target_bond_id: 'b1',
        is_opening: false,
        created_at: '2026-01-10T00:00:00Z',
      },
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
    rpc,
  },
}))

vi.mock('@/context/useAuth', () => ({
  useAuth: () => ({
    profile: { id: 'p1', name: 'Joao', role: 'COTISTA' },
    session: {},
    loading: false,
    signOut: vi.fn(),
  }),
}))

const { HistoricoView } = await import('@/views/historico')

beforeEach(() =>
  rpc.mockClear().mockResolvedValue({ data: { applied: 1 }, error: null }),
)
afterEach(cleanup)

describe('HistoricoView — rascunho em batch', () => {
  it('empilha uma remoção e salva tudo numa só chamada apply_event_changes', async () => {
    const user = userEvent.setup()
    render(<HistoricoView />)
    await screen.findByText('Tesouro Selic 2027')

    await user.click(screen.getByRole('button', { name: 'Remover' }))
    // Barra de pendências apareceu.
    expect(
      screen.getByRole('button', { name: /salvar alterações/i }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /salvar alterações/i }))

    await waitFor(() => {
      expect(rpc).toHaveBeenCalledTimes(1)
    })
    const [fn, args] = rpc.mock.calls[0]
    expect(fn).toBe('apply_event_changes')
    expect(args.p_caller_id).toBe('p1')
    expect(args.p_changes).toEqual([
      { ref: 't1', op: 'delete', transaction_id: 't1' },
    ])
  })

  it('Desfazer remove a pendência do rascunho', async () => {
    const user = userEvent.setup()
    render(<HistoricoView />)
    await screen.findByText('Tesouro Selic 2027')

    await user.click(screen.getByRole('button', { name: 'Remover' }))
    expect(
      screen.getByRole('button', { name: /salvar alterações/i }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Desfazer' }))
    // Sem pendências: a barra de salvar some e o botão Remover volta.
    expect(
      screen.queryByRole('button', { name: /salvar alterações/i }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remover' })).toBeInTheDocument()
  })

  it('mantém o rascunho quando o save falha', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'ref=t1|item 1: erro qualquer' },
    })
    const user = userEvent.setup()
    render(<HistoricoView />)
    await screen.findByText('Tesouro Selic 2027')

    await user.click(screen.getByRole('button', { name: 'Remover' }))
    await user.click(screen.getByRole('button', { name: /salvar alterações/i }))

    // Erro exibido e a barra de salvar continua (nada foi limpo — atômico).
    await screen.findByText(/erro qualquer/i)
    expect(
      screen.getByRole('button', { name: /salvar alterações/i }),
    ).toBeInTheDocument()
  })
})
