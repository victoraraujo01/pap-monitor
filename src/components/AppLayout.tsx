import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '@/context/useAuth'

const navItems = [
  { to: '/', label: 'Painel', end: true },
  { to: '/aportes', label: 'Aportes', end: false },
  { to: '/aprovacoes', label: 'Resgates/Despesas', end: false },
]

// Shell das áreas protegidas: masthead com marca, navegação em abas com filete
// dourado, identificação do cotista e logout. O conteúdo entra pelo <Outlet/>.
export function AppLayout() {
  const { profile, signOut } = useAuth()

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-white/80 backdrop-blur-md">
        <div className="rule-brass" />
        <div className="mx-auto max-w-5xl px-5 py-3.5">
          {/* Linha da marca + cotista. No desktop as abas entram no meio desta
              mesma linha; no mobile elas descem para uma segunda linha própria. */}
          <div className="flex items-center justify-between gap-x-7 gap-y-3">
            <a href="/" className="group flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-md border border-brass/50 font-display text-sm font-semibold text-brass">
                P
              </span>
              <span className="leading-none">
                <span className="block font-display text-base font-semibold tracking-tight text-bone">
                  Fundo PAP
                </span>
                <span className="eyebrow text-[0.55rem] text-sage">
                  Aposentadoria Pais
                </span>
              </span>
            </a>
            <nav className="hidden flex-1 gap-1 sm:flex">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `border-b-2 px-3 py-1.5 text-sm font-medium transition-colors ${
                      isActive
                        ? 'border-brass text-bone'
                        : 'border-transparent text-sage hover:text-bone'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="flex items-center gap-4">
              <div className="text-right leading-tight">
                <span className="eyebrow block text-[0.55rem] text-sage">
                  Cotista
                </span>
                <span className="text-sm font-medium text-bone">
                  {profile?.name ?? '…'}
                </span>
              </div>
              <button
                type="button"
                onClick={signOut}
                className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-bone-dim transition-colors hover:border-brass/50 hover:text-bone"
              >
                Sair
              </button>
            </div>
          </div>
          {/* Abas em linha própria no mobile, largura total e thumb-friendly. */}
          <nav className="mt-3 flex gap-1 sm:hidden">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex-1 border-b-2 px-3 py-1.5 text-center text-sm font-medium transition-colors ${
                    isActive
                      ? 'border-brass text-bone'
                      : 'border-transparent text-sage hover:text-bone'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8">
        <Outlet />
      </main>
      <footer className="mx-auto w-full max-w-5xl px-5 pb-8 pt-2">
        <div className="rule-brass opacity-40" />
        <p className="eyebrow mt-3 text-center text-[0.55rem] text-sage/70">
          Patrimônio em Tesouro Direto · cotas recalculadas diariamente
        </p>
      </footer>
    </div>
  )
}
