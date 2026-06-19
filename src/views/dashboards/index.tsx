import { useAuth } from '@/context/useAuth'

// Painel inicial. Os instrumentos (CdU 5–7) chegam na Etapa D; por ora um
// cabeçalho com saudação e os cartões previstos, já na identidade do fundo.
export function DashboardView() {
  const { profile } = useAuth()
  const firstName = profile?.name?.split(' ')[0] ?? 'cotista'

  const instruments = [
    {
      tag: 'CdU 5',
      title: 'Evolução do fundo',
      desc: 'Patrimônio líquido e valor da cota ao longo do tempo.',
    },
    {
      tag: 'CdU 6',
      title: 'Meu patrimônio',
      desc: 'Suas cotas × última cotação, extrato e adimplência.',
    },
    {
      tag: 'CdU 7',
      title: 'Participação',
      desc: 'Fatia de cada cotista e composição da carteira.',
    },
  ]

  return (
    <div className="flex flex-col gap-8">
      <header className="animate-rise">
        <p className="eyebrow text-brass">Livro-razão · {hoje()}</p>
        <h1 className="mt-2 font-display text-4xl font-medium leading-tight tracking-tight text-bone">
          Bom dia, {firstName}.
        </h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-bone-dim">
          O motor cruza diariamente o catálogo do Tesouro com a tabela
          regressiva de IR para recalcular o patrimônio e o valor da cota.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {instruments.map((it, i) => (
          <article
            key={it.tag}
            className="animate-rise relative overflow-hidden rounded-2xl border border-line bg-moss/60 p-5 backdrop-blur-sm"
            style={{ animationDelay: `${120 + i * 90}ms` }}
          >
            <div className="flex items-center justify-between">
              <span className="eyebrow text-sage">{it.tag}</span>
              <span className="eyebrow rounded-full border border-line px-2 py-0.5 text-[0.55rem] text-sage/80">
                em breve
              </span>
            </div>
            <h2 className="mt-3 font-display text-lg font-medium text-bone">
              {it.title}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-bone-dim">
              {it.desc}
            </p>
            <div className="rule-brass mt-4 opacity-30" />
          </article>
        ))}
      </div>
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
    <section className="rounded-2xl border border-line bg-moss/60 p-6 backdrop-blur-sm">
      <h1 className="font-display text-xl font-medium text-bone">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-bone-dim">{subtitle}</p>}
      {children && <p className="mt-4 text-sm text-bone-dim">{children}</p>}
    </section>
  )
}
