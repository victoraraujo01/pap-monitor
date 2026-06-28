import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Card } from '@/components/ui'

// Manual de operação do Fundo PAP. Acessado pelo botão "?" no header — NÃO entra
// na barra de abas (ver AppLayout). Duas visões na mesma página: o manual do
// COTISTA (default, enxuto) e "Administração do fundo" (setup/gestão), alternadas
// por um botão — o cotista comum não é assoberbado com tarefas de admin.

type SectionDef = { id: string; label: string }

const COTISTA_SECTIONS: SectionDef[] = [
  { id: 'visao-geral', label: 'Visão geral' },
  { id: 'conceitos', label: 'Conceitos-chave' },
  { id: 'papeis', label: 'Papéis: Admin e Cotista' },
  { id: 'aportes', label: 'Registrar um aporte' },
  { id: 'saidas', label: 'Resgates e despesas' },
  { id: 'reinvestimento', label: 'Reinvestimento' },
  { id: 'historico', label: 'Histórico e correções' },
  { id: 'fechamento', label: 'Fechamento diário' },
  { id: 'faq', label: 'Dúvidas comuns' },
]

const ADMIN_SECTIONS: SectionDef[] = [
  { id: 'setup', label: 'Primeiros passos' },
  { id: 'cotas-abertura', label: 'Cotas de abertura' },
  { id: 'obrigacoes', label: 'Obrigações mensais' },
  { id: 'catalogo', label: 'Catálogo de títulos' },
  { id: 'manutencao', label: 'Manutenção do histórico' },
]

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-bone-dim">{children}</p>
}

function H3({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-display text-base font-medium tracking-tight text-bone">
      {children}
    </h3>
  )
}

function UL({ children }: { children: ReactNode }) {
  return (
    <ul className="ml-1 flex list-none flex-col gap-2 text-sm leading-relaxed text-bone-dim">
      {children}
    </ul>
  )
}

function LI({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2">
      <span aria-hidden className="mt-px select-none text-brass">
        ›
      </span>
      <span>{children}</span>
    </li>
  )
}

function AdminTag() {
  return (
    <span className="eyebrow ml-2 rounded border border-brass/40 px-1.5 py-0.5 text-[0.55rem] text-brass">
      Admin
    </span>
  )
}

// Bloco de destaque (regra de ouro, avisos).
function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-brass/30 bg-pine/40 px-4 py-3 text-sm leading-relaxed text-bone">
      {children}
    </div>
  )
}

function Term({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-l-2 border-brass/40 pl-3">
      <span className="font-medium text-bone">{term}</span>
      <span className="text-sm leading-relaxed text-bone-dim">{children}</span>
    </div>
  )
}

// Link inline (estilo das âncoras) que troca para a visão de Administração e rola
// até a seção alvo. Usado nas referências cruzadas do manual do cotista.
function AdminLink({
  to,
  onOpen,
  children,
}: {
  to: string
  onOpen: (id?: string) => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(to)}
      className="text-brass underline"
    >
      {children}
    </button>
  )
}

export function ManualView() {
  const [view, setView] = useState<'cotista' | 'admin'>('cotista')
  // Seção-alvo a rolar após trocar para a visão de admin (ou null = topo).
  const pendingScroll = useRef<string | null>(null)

  useEffect(() => {
    const id = pendingScroll.current
    pendingScroll.current = null
    if (id) {
      requestAnimationFrame(() =>
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }),
      )
    } else {
      window.scrollTo({ top: 0 })
    }
  }, [view])

  function openAdmin(id?: string) {
    pendingScroll.current = id ?? null
    setView('admin')
  }

  if (view === 'admin') {
    return (
      <div className="animate-rise flex flex-col gap-6">
        <div>
          <button
            type="button"
            onClick={() => setView('cotista')}
            className="text-sm text-brass underline"
          >
            ← Manual do cotista
          </button>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-bone">
            Administração do fundo
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-bone-dim">
            Setup e gestão do sistema — tarefas do administrador. O cotista comum
            não precisa desta seção para o dia a dia.
          </p>
        </div>

        <Card title="Índice — Administração">
          <nav className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {ADMIN_SECTIONS.map((s, i) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="flex items-baseline gap-2 text-sm text-bone-dim transition-colors hover:text-brass"
              >
                <span className="nums text-xs text-sage">
                  {String(i + 1).padStart(2, '0')}
                </span>
                {s.label}
              </a>
            ))}
          </nav>
        </Card>

        {/* A1. Primeiros passos */}
        <div id="setup" className="scroll-mt-24">
          <Card
            title="Primeiros passos"
            description="Sequência para colocar o fundo no ar a partir de uma carteira que já existia."
          >
            <div className="flex flex-col gap-4">
              <P>
                O fundo começa numa data de corte (<strong>D0</strong>) arbitrária;
                tudo anterior é colapsado no saldo de abertura. A ordem:
              </P>
              <UL>
                <LI>
                  <strong>1. Carregar preços históricos</strong> rode o{' '}
                  <span className="nums">backfill</span> uma vez (ver{' '}
                  <a href="#manutencao" className="text-brass underline">
                    Manutenção
                  </a>
                  ) — habilita a sugestão de preço e a reconstrução fiel.
                </LI>
                <LI>
                  <strong>2. Conferir o catálogo</strong> todos os títulos da
                  carteira precisam existir no{' '}
                  <a href="#catalogo" className="text-brass underline">
                    catálogo
                  </a>
                  .
                </LI>
                <LI>
                  <strong>3. Gravar o saldo de abertura</strong> data de corte +
                  uma <strong>contribuição</strong> por título (irmão, título,
                  quantidade, valor). A cota de cada um deriva do valor (ver{' '}
                  <a href="#cotas-abertura" className="text-brass underline">
                    Cotas de abertura
                  </a>
                  ).
                </LI>
                <LI>
                  <strong>4. Gerar obrigações mensais</strong> da abertura até hoje
                  (ver{' '}
                  <a href="#obrigacoes" className="text-brass underline">
                    Obrigações mensais
                  </a>
                  ).
                </LI>
              </UL>
              <P>
                Daí em diante, cada operação reconstrói a curva sozinha — só volte a
                “Reconstruir histórico” após carregar preços novos.
              </P>
            </div>
          </Card>
        </div>

        {/* A2. Cotas de abertura */}
        <div id="cotas-abertura" className="scroll-mt-24">
          <Card
            title="Cotas de abertura"
            description="Como cada irmão recebe cotas no D0."
          >
            <div className="flex flex-col gap-4">
              <P>
                Em D0 o preço informado de cada título vira a base de custo. O
                patrimônio de abertura é a soma{' '}
                <span className="nums">quantidade × preço</span> das contribuições,
                e a cota de cada irmão{' '}
                <strong>deriva do valor que ele aportou</strong> — você não
                distribui cotas à mão.
              </P>
              <UL>
                <LI>
                  Lance uma <strong>contribuição</strong> por título (irmão que o
                  aportou, quantidade, valor). Título aportado por mais de um irmão =
                  duas contribuições.
                </LI>
                <LI>
                  <span className="nums">
                    cotas = Σ (valor aportado) ÷ valor inicial da cota
                  </span>
                  . Com o valor inicial em <span className="nums">R$ 1,00</span>{' '}
                  (padrão), as cotas de cada um igualam o que aportou e a cota de
                  abertura sai em <span className="nums">R$ 1,00</span>.
                </LI>
                <LI>
                  <strong>Irmão que entrou depois / aportou menos</strong> recebe
                  menos cotas — menos propriedade, não dívida.
                </LI>
                <LI>
                  <strong>Irmão em débito no D0</strong> (sacou mais do que tinha):
                  grave a abertura com as cotas reais e lance no histórico um{' '}
                  <strong>resgate pessoal datado logo após o D0</strong>; a
                  reconstrução acerta.
                </LI>
              </UL>
            </div>
          </Card>
        </div>

        {/* A3. Obrigações */}
        <div id="obrigacoes" className="scroll-mt-24">
          <Card
            title="Obrigações mensais"
            description="O controle de quem está em dia com a mensalidade."
          >
            <div className="flex flex-col gap-4">
              <P>
                A adimplência tem{' '}
                <strong className="text-bone">duas lentes</strong>, ambas derivadas
                dos aportes:
              </P>
              <UL>
                <LI>
                  <strong>Saldo da mensalidade</strong> (dinheiro exato): total
                  esperado − aportado. Sobra vira <strong>crédito</strong>; falta
                  acumula como <strong>saldo devedor</strong>. A parte de reposição
                  de resgate não entra nessa conta.
                </LI>
                <LI>
                  <strong>Status de cada mês</strong>: quitado quando os aportes
                  cobrem ≥ <span className="nums">90%</span> do esperado acumulado
                  até ele (a folga existe porque preço de título não fecha redondo).
                  Quitar atrasados num aporte só pinta os meses de verde do mais
                  antigo ao mais novo.
                </LI>
              </UL>
              <H3>Ações</H3>
              <UL>
                <LI>
                  <strong>Gerar obrigações</strong> uma fatura por irmão por mês, da
                  abertura ao mês corrente (padrão{' '}
                  <span className="nums">R$ 1.000</span>). Gerar de novo não duplica
                  nem sobrescreve. Todo dia 1º a mensalidade do mês novo é gerada
                  automaticamente.
                </LI>
                <LI>
                  <strong>Override manual</strong> força um mês para{' '}
                  <strong>pago</strong>/<strong>pendente</strong> (casos fora do
                  sistema). Pago sai também do saldo devedor.{' '}
                  <strong>Auto</strong> remove o override.
                </LI>
                <LI>
                  <strong>Remover</strong> apaga o mês de vez — some da lista e não é
                  recriado ao gerar de novo.
                </LI>
              </UL>
            </div>
          </Card>
        </div>

        {/* A4. Catálogo */}
        <div id="catalogo" className="scroll-mt-24">
          <Card
            title="Catálogo de títulos"
            description="Cartão Catálogo na aba Admin. Quais títulos o fundo conhece."
          >
            <div className="flex flex-col gap-4">
              <P>
                O fechamento diário só atualiza o preço de títulos{' '}
                <strong>já cadastrados</strong>, e só os marcados como{' '}
                <strong>disponíveis para compra</strong> aparecem nos aportes.
              </P>
              <UL>
                <LI>
                  <strong>Buscar títulos no Tesouro</strong> lista os títulos (Selic
                  e IPCA+) do CSV oficial ainda não cadastrados — nome e preço vêm
                  prontos; marque se é comprável e adicione.
                </LI>
                <LI>
                  <strong>Tornar comprável / indisponível</strong> controla quais
                  aparecem nos aportes. Adicionar nunca sobrescreve um preço já
                  conhecido (tarefa do job diário).
                </LI>
              </UL>
            </div>
          </Card>
        </div>

        {/* A5. Manutenção */}
        <div id="manutencao" className="scroll-mt-24">
          <Card
            title="Manutenção do histórico"
            description="As ações dos cartões de gestão, na aba Admin."
          >
            <div className="flex flex-col gap-4">
              <div>
                <H3>Atualizar preços (backfill)</H3>
                <P>
                  Baixa todo o histórico de preços do Tesouro de uma vez. Rode antes
                  da abertura e sempre que faltarem preços — é o que dá lastro à
                  sugestão de preço e à reconstrução fiel.
                </P>
              </div>
              <div>
                <H3>Reconstruir histórico</H3>
                <P>
                  Reprocessa todos os eventos em ordem contra os preços históricos e
                  regenera a curva de patrimônio e cota.{' '}
                  <strong>
                    Aportes, resgates e reinvestimentos já reconstroem sozinhos
                  </strong>{' '}
                  — use sobretudo depois de carregar preços novos (backfill).
                </P>
              </div>
              <div>
                <H3>Política de dívida de resgate</H3>
                <P>
                  Define como o <strong>resgate a repor</strong> é medido, para o
                  fundo inteiro:
                </P>
                <UL>
                  <LI>
                    <strong>Nominal (R$)</strong> — a dívida é em reais (tirou R$
                    1.000, deve R$ 1.000; repôs, quitou). Padrão.
                  </LI>
                  <LI>
                    <strong>Participação (cotas)</strong> — você repõe a fatia exata
                    queimada; o valor em reais para zerar acompanha a cota (sobe se o
                    fundo valorizou). Mais justo, porém o número “a repor” oscila.
                  </LI>
                </UL>
                <Callout>
                  Trocar o modo é só leitura: não altera lançamentos nem dispara
                  reconstrução, e é reversível. Mas reescreve o “a repor” de todos
                  retroativamente — é decisão de regra do fundo, não ajuste do dia a
                  dia.
                </Callout>
              </div>
              <div>
                <H3>Limpar todas as movimentações</H3>
                <P>
                  Zera o livro inteiro (aportes, resgates, despesas, reinvestimentos,
                  obrigações, curva de PL e abertura), preservando só o catálogo e os
                  preços históricos. Irreversível: exige digitar{' '}
                  <span className="nums">limpar tudo</span>.
                </P>
              </div>
            </div>
          </Card>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setView('cotista')}
            className="text-sm text-brass underline"
          >
            ← Voltar ao manual do cotista
          </button>
        </div>
      </div>
    )
  }

  // ---- Manual do cotista (default) ----
  return (
    <div className="animate-rise flex flex-col gap-6">
      <div>
        <span className="eyebrow text-sage">Manual de operação</span>
        <h1 className="mt-1 font-display text-3xl font-medium tracking-tight text-bone">
          Como o Fundo PAP funciona
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-bone-dim">
          Guia do dia a dia para os três cotistas. As tarefas de setup e gestão do
          sistema ficam em{' '}
          <button
            type="button"
            onClick={() => openAdmin()}
            className="text-brass underline"
          >
            Administração do fundo
          </button>
          .
        </p>
      </div>

      <Card title="Índice">
        <nav className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {COTISTA_SECTIONS.map((s, i) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="flex items-baseline gap-2 text-sm text-bone-dim transition-colors hover:text-brass"
            >
              <span className="nums text-xs text-sage">
                {String(i + 1).padStart(2, '0')}
              </span>
              {s.label}
            </a>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => openAdmin()}
          className="mt-3 flex w-full items-center justify-between rounded-lg border border-brass/30 bg-pine/40 px-4 py-2.5 text-sm font-medium text-bone transition-colors hover:border-brass/60"
        >
          <span>
            Administração do fundo <AdminTag />
          </span>
          <span aria-hidden className="text-brass">
            →
          </span>
        </button>
      </Card>

      {/* 1. Visão geral */}
      <div id="visao-geral" className="scroll-mt-24">
        <Card title="Visão geral">
          <div className="flex flex-col gap-4">
            <P>
              Fundo de investimento familiar fechado entre três irmãos. Cada um
              aporta mensalmente em títulos do Tesouro Direto. Em vez de controlar
              “quem comprou qual título”, o fundo usa{' '}
              <strong className="text-bone">cotas</strong>: cada aporte compra
              cotas e a posse de cada irmão é a quantidade de cotas que detém. Todo
              dia útil um processo lê os preços oficiais e recalcula o patrimônio e
              o <strong className="text-bone">valor da cota</strong>, distribuindo
              ganho/perda na proporção de cada um.
            </P>
            <P>
              A navegação tem três abas para todos —{' '}
              <strong className="text-bone">Painel</strong>,{' '}
              <strong className="text-bone">Aportes</strong> e{' '}
              <strong className="text-bone">Resgates</strong> — mais{' '}
              <strong className="text-bone">Admin</strong> para o administrador. O
              Histórico completo abre pelo “Ver tudo” na prévia do painel.
            </P>
          </div>
        </Card>
      </div>

      {/* 2. Conceitos */}
      <div id="conceitos" className="scroll-mt-24">
        <Card title="Conceitos-chave">
          <div className="flex flex-col gap-4">
            <Term term="Cota">
              A unidade de posse. Quantas cotas você tem define que fatia do
              patrimônio é sua. Aportar aumenta suas cotas; um resgate pessoal as
              queima.
            </Term>
            <Term term="Valor da cota">
              <span className="nums">Patrimônio Líquido ÷ total de cotas</span>.
              Começa em <span className="nums">R$ 1,00</span> e sobe/desce conforme
              os títulos rendem. Seu patrimônio ={' '}
              <span className="nums">suas cotas × valor da cota</span>.
            </Term>
            <Term term="Patrimônio Líquido (PL)">
              Valor de mercado de toda a carteira, já descontado o IR que incidiria
              no resgate (soma do valor líquido de cada lote).
            </Term>
            <Term term="IR regressivo">
              Imposto sobre o rendimento de cada lote, cai com o tempo de posse:{' '}
              <span className="nums">22,5%</span> até 180d,{' '}
              <span className="nums">20%</span> 181–360,{' '}
              <span className="nums">17,5%</span> 361–720,{' '}
              <span className="nums">15%</span> acima de 720d. Aplicado sozinho no
              cálculo diário.
            </Term>
            <Term term="Lote (FIFO)">
              Cada compra de um título vira um lote (quantidade + custo + data).
              Saídas vendem do lote mais antigo primeiro (FIFO), mantendo IR e
              rendimento corretos por compra.
            </Term>
            <Callout>
              <strong>Cota ≠ adimplência.</strong> Cotas medem{' '}
              <em>propriedade</em>; estar “em dia” mede <em>pontualidade</em> nas
              mensalidades (
              <AdminLink to="obrigacoes" onOpen={openAdmin}>
                Obrigações mensais
              </AdminLink>
              ). São independentes.
            </Callout>
          </div>
        </Card>
      </div>

      {/* 3. Papéis */}
      <div id="papeis" className="scroll-mt-24">
        <Card
          title="Papéis: Admin e Cotista"
          description="Todos veem tudo. A diferença está em quem governa a estrutura do fundo."
        >
          <div className="flex flex-col gap-4">
            <div>
              <H3>Cotista (todos)</H3>
              <UL>
                <LI>Acompanha painel, patrimônio e participação.</LI>
                <LI>Registra os próprios aportes e reinvestimentos.</LI>
                <LI>Pede resgates pessoais e propõe despesas dos pais.</LI>
                <LI>Edita/remove os próprios lançamentos no histórico.</LI>
              </UL>
            </div>
            <div>
              <H3>
                Administrador <AdminTag />
              </H3>
              <UL>
                <LI>Define o saldo de abertura e gera obrigações mensais.</LI>
                <LI>Classifica despesas propostas e cadastra títulos.</LI>
                <LI>Reconstrói o histórico e administra qualquer lançamento.</LI>
              </UL>
              <P>
                Detalhes em{' '}
                <AdminLink to="setup" onOpen={openAdmin}>
                  Administração do fundo
                </AdminLink>
                .
              </P>
            </div>
          </div>
        </Card>
      </div>

      {/* 4. Aportes */}
      <div id="aportes" className="scroll-mt-24">
        <Card
          title="Registrar um aporte"
          description="Aba Aportes. Como entra dinheiro novo no fundo."
        >
          <div className="flex flex-col gap-4">
            <UL>
              <LI>
                Escolha um título <em>disponível para compra</em>, a quantidade e o{' '}
                <strong>valor total aportado</strong>. Quantidade, preço unitário e
                valor total são interligados (o último que você editar manda); um{' '}
                <strong>chip de sugestão</strong> traz a cotação de compra na data.
              </LI>
              <LI>
                O aporte vira cotas pela cotação vigente, cria um lote real e abate
                seu <strong>saldo devedor</strong>, quitando os meses em aberto do
                mais antigo ao mais novo.
              </LI>
              <LI>
                A data pode ser retroativa (qualquer cotista) — a cota sai certa
                para a data. <strong>Nota</strong> é um campo livre, sem cálculo.
              </LI>
            </UL>
            <H3>Aporte que também repõe um resgate</H3>
            <P>
              Se você fez um resgate pessoal antes, o painel mostra um{' '}
              <strong className="text-bone">resgate a repor</strong>. Havendo esse
              saldo, o aporte exibe uma <strong>divisão</strong>: parte vai para a
              mensalidade do mês, parte abate o resgate (o sistema sugere, você
              ajusta).
            </P>
            <Callout>
              A divisão é só rótulo contábil — o aporte inteiro compra o título e
              gera cotas normalmente. Ela só controla quanto conta como mensalidade
              e quanto abate o “resgate a repor”. A parte de reposição{' '}
              <strong>não</strong> conta como contribuição do mês.
            </Callout>
          </div>
        </Card>
      </div>

      {/* 5. Saídas */}
      <div id="saidas" className="scroll-mt-24">
        <Card
          title="Resgates e despesas"
          description="Aba Resgates. Todo dinheiro que sai segue um destes três caminhos."
        >
          <div className="flex flex-col gap-4">
            <P>
              Toda saída registra título, quantidade, valor bruto e data (com a
              mesma sugestão de preço do aporte, pela cotação de venda). Muda só a
              natureza:
            </P>
            <UL>
              <LI>
                <strong>Resgate pessoal (direto)</strong> — um irmão tira dinheiro
                para si. Nasce aprovado: FIFO vende as unidades e{' '}
                <strong className="text-bone">queima as cotas</strong> do
                solicitante. Vira um <strong>resgate a repor</strong> no painel, que
                um aporte futuro pode abater.
              </LI>
              <LI>
                <strong>Despesa dos pais (proposta)</strong> — qualquer cotista
                propõe; nasce <strong className="text-bone">pendente</strong> e não
                conta até o admin <strong>aprovar como despesa</strong> (rateada por
                todos) ou <strong>reclassificar como resgate</strong> do
                solicitante.
              </LI>
              <LI>
                <strong>Despesa dos pais (direta)</strong> <AdminTag /> atalho do
                admin: nasce aprovada, sem fila.
              </LI>
            </UL>
            <P>
              Como o “a repor” é medido depende da{' '}
              <strong className="text-bone">política de dívida de resgate</strong>{' '}
              do admin (
              <AdminLink to="manutencao" onOpen={openAdmin}>
                Administração do fundo
              </AdminLink>
              ): em reais (repôs o que tirou, quitou) ou em cotas (repõe a fatia
              exata queimada, e o valor em reais acompanha a cota do dia).
            </P>
            <Callout>
              <strong>Regra de ouro da despesa dos pais:</strong> nenhuma cota de
              ninguém é queimada. O patrimônio total cai e a cota cai
              proporcionalmente para todos. O admin não classifica a própria
              proposta.
            </Callout>
          </div>
        </Card>
      </div>

      {/* 6. Reinvestimento */}
      <div id="reinvestimento" className="scroll-mt-24">
        <Card
          title="Reinvestimento"
          description="Aba Aportes, cartão Reinvestimento. Quando um título vence ou você rebalanceia."
        >
          <div className="flex flex-col gap-4">
            <P>
              <strong>Rotação de carteira</strong>: o fundo liquida unidades de um
              título de <strong>origem</strong> e reaplica o caixa em um ou mais{' '}
              <strong>destinos</strong>. O dinheiro já era do fundo, então{' '}
              <strong className="text-bone">não é aporte</strong>: nenhuma cota é
              gerada/queimada e não conta como mensalidade.
            </P>
            <UL>
              <LI>
                Escolha a origem (qualquer título da carteira) + quantidade + data.
                O painel mostra{' '}
                <span className="nums">bruto → IR → líquido</span> da origem.
              </LI>
              <LI>
                Liste os destinos (compráveis), cada um com quantidade e valor. A
                soma precisa <strong>bater com o líquido</strong> (±R$ 0,01) — isso
                conserva o patrimônio do fundo.
              </LI>
            </UL>
            <Callout>
              Patrimônio conservado e nenhuma cota mexida ⇒ valor da cota contínuo.
              Reinvestimento não se edita: para corrigir, remova e lance de novo.
            </Callout>
          </div>
        </Card>
      </div>

      {/* 7. Histórico */}
      <div id="historico" className="scroll-mt-24">
        <Card
          title="Histórico e correções"
          description="Página Histórico (“Ver tudo” na prévia do painel). O livro completo de lançamentos."
        >
          <div className="flex flex-col gap-4">
            <UL>
              <LI>
                Filtre por cotista, tipo e período. Cada um{' '}
                <strong>edita/remove os próprios lançamentos</strong>; o admin,
                qualquer um. Abertura não é editável aqui; reinvestimento, também
                não (remova e recrie).
              </LI>
              <LI>
                As mudanças são um <strong>rascunho</strong>: empilhe criações,
                edições e remoções (refletidas inline, desfazíveis linha a linha) e
                só ao <strong>Salvar alterações</strong> tudo vai de uma vez, com{' '}
                <strong>um</strong> rebuild. Se uma linha falhar, nada é gravado
                (tudo ou nada) e o erro aponta a linha.
              </LI>
            </UL>
          </div>
        </Card>
      </div>

      {/* 8. Fechamento diário */}
      <div id="fechamento" className="scroll-mt-24">
        <Card
          title="Fechamento diário"
          description="O que acontece sozinho, todo dia útil."
        >
          <div className="flex flex-col gap-4">
            <P>
              À noite, em dias úteis, um processo agendado baixa os preços oficiais
              do dia (CSV público do Tesouro Transparente, sem custo), atualiza cada
              título do catálogo e recalcula o patrimônio (IR regressivo lote a
              lote), gravando o novo valor da cota. Por isso o painel fica sempre
              atualizado sem ninguém mexer.
            </P>
          </div>
        </Card>
      </div>

      {/* 9. FAQ */}
      <div id="faq" className="scroll-mt-24">
        <Card title="Dúvidas comuns">
          <div className="flex flex-col gap-4">
            <Term term="Por que meu patrimônio mudou se eu não fiz nada?">
              O valor da cota muda todo dia com os preços do Tesouro e o IR. Seu
              patrimônio é cotas × valor da cota, então oscila junto.
            </Term>
            <Term term="Tenho menos cotas que meus irmãos. Estou devendo?">
              Não. Cotas medem propriedade, não pontualidade. Menos cotas = menos
              participação; estar “em dia” é outra conta.
            </Term>
            <Term term="O mês está verde mas apareço com saldo devedor. Como?">
              O status do mês usa a folga de 90%, mas o saldo é dinheiro exato.
              Aportou R$ 980 de R$ 1.000: o mês conta como quitado e sobram R$ 20 de
              saldo que o próximo aporte abate.
            </Term>
            <Term term="O que é o “resgate a repor” no meu painel?">
              Quanto você tirou em resgates pessoais e ainda não devolveu. Um aporte
              pode abater pela divisão (ver{' '}
              <a href="#aportes" className="text-brass underline">
                Aportes
              </a>
              ). É só um indicador, não é obrigatório.
            </Term>
            <Term term="O “resgate a repor” aparece em cotas, não em reais. Por quê?">
              O admin escolheu o modo <strong>Participação</strong> (
              <AdminLink to="manutencao" onOpen={openAdmin}>
                Administração do fundo
              </AdminLink>
              ): a dívida é em cotas (a fatia que você queimou). O número grande são
              as cotas; abaixo vem o equivalente em reais do momento — quanto aportar
              agora para zerar.
            </Term>
            <Term term="Lancei um aporte com data antiga — preciso reconstruir?">
              Não. Aportes, resgates e reinvestimentos já reconstroem a curva ao
              salvar.
            </Term>
            <Term term="Um título que comprei não aparece na lista de aportes.">
              Ele não está no catálogo ou está marcado como indisponível — o admin
              resolve no{' '}
              <AdminLink to="catalogo" onOpen={openAdmin}>
                catálogo
              </AdminLink>
              .
            </Term>
            <Term term="Errei um lançamento. Como corrigir?">
              No{' '}
              <a href="#historico" className="text-brass underline">
                Histórico
              </a>
              , edite/remova (seus lançamentos; o admin, qualquer um) e salve.
              Reinvestimento: remova e lance de novo.
            </Term>
          </div>
        </Card>
      </div>

      <Card title="Administração do fundo">
        <div className="flex flex-col gap-3">
          <P>
            Setup do fundo, cotas de abertura, obrigações mensais, catálogo de
            títulos e manutenção do histórico — tarefas do administrador, separadas
            para não pesar o dia a dia.
          </P>
          <button
            type="button"
            onClick={() => openAdmin()}
            className="flex w-full items-center justify-between rounded-lg border border-brass/30 bg-pine/40 px-4 py-2.5 text-sm font-medium text-bone transition-colors hover:border-brass/60"
          >
            <span>
              Abrir Administração do fundo <AdminTag />
            </span>
            <span aria-hidden className="text-brass">
              →
            </span>
          </button>
        </div>
      </Card>
    </div>
  )
}
