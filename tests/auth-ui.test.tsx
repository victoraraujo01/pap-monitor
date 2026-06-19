// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Mock do cliente Supabase: estes testes de UI NÃO batem no banco. Controlamos a
// sessão devolvida por getSession para exercitar a guarda de rota.
const getSession = vi.fn()
const onAuthStateChange = vi.fn(() => ({
  data: { subscription: { unsubscribe: vi.fn() } },
}))

vi.mock('@/services/supabase', () => ({
  supabase: {
    auth: { getSession, onAuthStateChange },
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({ single: () => Promise.resolve({ data: null }) }),
      }),
    })),
  },
}))

// Importados depois do mock para que o vi.mock seja aplicado.
const { AuthProvider } = await import('@/context/AuthProvider')
const App = (await import('@/App')).default
const { LoginView } = await import('@/views/auth/LoginView')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ProtectedRoute', () => {
  it('redireciona para /login quando não há sessão', async () => {
    getSession.mockResolvedValue({ data: { session: null } })

    render(
      <MemoryRouter initialEntries={['/aportes']}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    )

    // Espera o getSession resolver (loading=false) e o redirect renderizar o login.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /entrar/i }),
      ).toBeInTheDocument(),
    )
  })
})

describe('LoginView', () => {
  it('renderiza os campos de e-mail e senha', () => {
    getSession.mockResolvedValue({ data: { session: null } })

    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginView />
        </AuthProvider>
      </MemoryRouter>,
    )

    expect(screen.getByLabelText(/e-mail/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/senha/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /entrar/i })).toBeInTheDocument()
  })
})
