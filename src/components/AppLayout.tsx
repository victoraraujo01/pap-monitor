import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '@/context/useAuth'

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/aportes', label: 'Aportes', end: false },
  { to: '/aprovacoes', label: 'Resgates/Despesas', end: false },
]

// Shell das áreas protegidas: cabeçalho com identificação do cotista + logout e
// navegação entre as views. O conteúdo de cada rota entra pelo <Outlet/>.
export function AppLayout() {
  const { profile, signOut } = useAuth()

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="text-lg font-semibold">Fundo PAP</span>
            <nav className="flex gap-1">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">
              {profile?.name ?? '…'}
            </span>
            <button
              type="button"
              onClick={signOut}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Sair
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
