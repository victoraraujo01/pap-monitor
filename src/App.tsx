import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AppLayout } from '@/components/AppLayout'
import { LoginView } from '@/views/auth/LoginView'
import { SignupView } from '@/views/auth/SignupView'
import { DashboardView } from '@/views/dashboards'
import { AportesView } from '@/views/aportes'
import { AprovacoesView } from '@/views/aprovacoes'

function App() {
  return (
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
        </Route>
      </Route>

      {/* Qualquer outra rota volta para o dashboard */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
