import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AppLayout } from '@/components/AppLayout'
import { LoginView } from '@/views/auth/LoginView'
import { SignupView } from '@/views/auth/SignupView'

// Telas autenticadas carregadas sob demanda (code-splitting): mantém o JS inicial
// enxuto — as views pesadas (histórico/admin/manual) só baixam ao serem visitadas.
// Auth (Login/Signup) fica eager por ser a porta de entrada.
const DashboardView = lazy(() =>
  import('@/views/dashboards').then((m) => ({ default: m.DashboardView })),
)
const AportesView = lazy(() =>
  import('@/views/aportes').then((m) => ({ default: m.AportesView })),
)
const AprovacoesView = lazy(() =>
  import('@/views/aprovacoes').then((m) => ({ default: m.AprovacoesView })),
)
const HistoricoView = lazy(() =>
  import('@/views/historico').then((m) => ({ default: m.HistoricoView })),
)
const AdminView = lazy(() =>
  import('@/views/admin').then((m) => ({ default: m.AdminView })),
)
const ManualView = lazy(() =>
  import('@/views/manual').then((m) => ({ default: m.ManualView })),
)

function RouteFallback() {
  return (
    <div className="animate-rise p-6 text-sm text-bone-dim">Carregando…</div>
  )
}

function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* Públicas */}
        <Route path="/login" element={<LoginView />} />
        <Route path="/signup" element={<SignupView />} />

        {/* Protegidas: exigem sessão e usam o shell do app */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardView />} />
            <Route path="/aportes" element={<AportesView />} />
            <Route path="/aprovacoes" element={<AprovacoesView />} />
            <Route path="/historico" element={<HistoricoView />} />
            <Route path="/admin" element={<AdminView />} />
            <Route path="/manual" element={<ManualView />} />
          </Route>
        </Route>

        {/* Qualquer outra rota volta para o dashboard */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

export default App
