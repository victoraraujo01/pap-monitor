import { useAuth } from '@/context/useAuth'
import { FundEvolution } from './FundEvolution'
import { MyPatrimony } from './MyPatrimony'
import { Participation } from './Participation'
import { RecentEvents } from './RecentEvents'

// Painel (Etapa D) — reúne os três instrumentos de leitura do fundo:
// CdU 5 (histórico do fundo), CdU 6 (histórico individual) e CdU 7 (comparativo).
// Mantidos numa página só para não inflar a navegação (3 destinos primários).
export function DashboardView() {
  const { profile } = useAuth()
  const firstName = profile?.name?.split(' ')[0] ?? 'cotista'

  const sections = [
    { title: 'Evolução do fundo', node: <FundEvolution /> },
    { title: 'Meu patrimônio', node: <MyPatrimony /> },
    { title: 'Participação', node: <Participation /> },
    { title: 'Lançamentos', node: <RecentEvents /> },
  ]

  return (
    <div className="flex flex-col gap-10">
      <header className="animate-rise">
        <p className="eyebrow text-brass">Livro-razão · {hoje()}</p>
        <h1 className="mt-2 font-display text-4xl font-medium leading-tight tracking-tight text-bone">
          {saudacao()}, {firstName}.
        </h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-bone-dim">
          O motor cruza diariamente o catálogo do Tesouro com a tabela
          regressiva de IR para recalcular o patrimônio e o valor da cota.
        </p>
      </header>

      {sections.map((s, i) => (
        <section
          key={s.title}
          className="animate-rise flex flex-col gap-4"
          style={{ animationDelay: `${120 + i * 90}ms` }}
        >
          <div className="flex items-baseline gap-3">
            <h2 className="font-display text-2xl font-medium tracking-tight text-bone">
              {s.title}
            </h2>
            <div className="rule-brass mt-1 flex-1 opacity-30" />
          </div>
          {s.node}
        </section>
      ))}
    </div>
  )
}

function hoje(): string {
  return new Date().toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function saudacao(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}
