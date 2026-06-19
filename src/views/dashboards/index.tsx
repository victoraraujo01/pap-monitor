import { useAuth } from '@/context/useAuth'

// Placeholder do Dashboard (CdU 5–7, Etapa D).
export function DashboardView() {
  const { profile } = useAuth()
  return (
    <Placeholder
      title="Dashboard"
      subtitle={`Bem-vindo, ${profile?.name ?? 'cotista'}.`}
    >
      Evolução de PL/cota, patrimônio individual e comparativo de participação
      virão na Etapa D.
    </Placeholder>
  )
}

export function Placeholder({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children?: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      {children && <p className="mt-4 text-sm text-slate-600">{children}</p>}
    </section>
  )
}
