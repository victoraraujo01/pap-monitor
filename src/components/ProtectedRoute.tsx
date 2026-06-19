import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/context/useAuth'

// Guarda de rota: bloqueia o acesso até a sessão estar resolvida.
// - loading → tela de carregando (evita flash de /login durante o getSession).
// - sem sessão → redireciona para /login.
// - com sessão → renderiza as rotas filhas.
export function ProtectedRoute() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
        Carregando…
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}
