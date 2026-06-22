import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '@/context/useAuth'

const baseNavItems = [
  { to: '/', label: 'Painel', end: true },
  { to: '/aportes', label: 'Aportes', end: false },
  { to: '/aprovacoes', label: 'Resgates', end: false },
]

// Iniciais para o avatar: 1ª letra do primeiro e do último nome (ou 2 letras).
function initialsOf(name?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Shell das áreas protegidas: masthead com marca, navegação em abas com filete
// dourado, identificação do cotista e logout. O conteúdo entra pelo <Outlet/>.
export function AppLayout() {
  const { profile, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // A aba Admin só aparece para administradores (governança do histórico).
  const navItems =
    profile?.role === 'ADMIN'
      ? [...baseNavItems, { to: '/admin', label: 'Admin', end: false }]
      : baseNavItems

  const roleLabel = profile?.role === 'ADMIN' ? 'Administrador' : 'Cotista'

  // Fecha o menu do avatar ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!menuOpen) return
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

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
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Menu do cotista"
                className="grid h-9 w-9 place-items-center rounded-full border border-brass/40 bg-pine/60 font-display text-sm font-semibold text-brass transition-colors hover:border-brass/70 hover:bg-pine"
              >
                {initialsOf(profile?.name)}
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-white shadow-[0_18px_44px_-24px_rgba(40,52,44,0.45)]"
                >
                  <div className="border-b border-line px-4 py-3">
                    <span className="eyebrow block text-[0.55rem] text-sage">
                      {roleLabel}
                    </span>
                    <span className="text-sm font-medium text-bone">
                      {profile?.name ?? '…'}
                    </span>
                  </div>
                  <NavLink
                    to="/manual"
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                    className="block px-4 py-2.5 text-sm text-bone-dim transition-colors hover:bg-bone/5 hover:text-bone"
                  >
                    Manual de operação
                  </NavLink>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false)
                      signOut()
                    }}
                    className="block w-full px-4 py-2.5 text-left text-sm text-bone-dim transition-colors hover:bg-bone/5 hover:text-bone"
                  >
                    Sair
                  </button>
                </div>
              )}
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
