import type { ReactNode } from 'react'
import { Card } from '@/components/ui'

// Manual de operação do Fundo PAP. Página de referência completa, aberta a todos
// os cotistas (seções de Admin sinalizadas). Acessada pelo botão "?" no header —
// NÃO entra na barra de abas para não quebrar o layout mobile (ver AppLayout).

type SectionDef = { id: string; label: string }

const SECTIONS: SectionDef[] = [
  { id: 'visao-geral', label: 'Visão geral' },
  { id: 'conceitos', label: 'Conceitos-chave' },
  { id: 'papeis', label: 'Papéis: Admin e Cotista' },
  { id: 'setup', label: 'Primeiros passos (Admin)' },
  { id: 'cotas-abertura', label: 'Cotas de abertura' },
  { id: 'aportes', label: 'Registrar um aporte' },
  { id: 'saidas', label: 'Resgates e despesas' },
  { id: 'reinvestimento', label: 'Reinvestimento' },
  { id: 'historico', label: 'Histórico e correções' },
  { id: 'obrigacoes', label: 'Obrigações mensais' },
  { id: 'catalogo', label: 'Catálogo de títulos' },
  { id: 'fechamento', label: 'Fechamento diário' },
  { id: 'manutencao', label: 'Manutenção do histórico' },
  { id: 'faq', label: 'Dúvidas comuns' },
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

export function ManualView() {
  return (
    <div className="animate-rise flex flex-col gap-6">
      <div>
        <span className="eyebrow text-sage">Manual de operação</span>
        <h1 className="mt-1 font-display text-3xl font-medium tracking-tight text-bone">
          Como o Fundo PAP funciona
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-bone-dim">
          Guia de referência do fundo familiar: dos conceitos ao dia a dia.
          Pensado para os três cotistas — as seções marcadas com{' '}
          <span className="eyebrow rounded border border-brass/40 px-1.5 py-0.5 text-[0.55rem] text-brass">
            Admin
          </span>{' '}
          são tarefas do administrador.
        </p>
      </div>

      {/* Índice */}
      <Card title="Índice">
        <nav className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {SECTIONS.map((s, i) => (
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

      {/* 1. Visão geral */}
      <div id="visao-geral" className="scroll-mt-24">
        <Card title="Visão geral">
          <div className="flex flex-col gap-4">
            <P>
              O Fundo PAP é um fundo de investimento familiar fechado entre três
              irmãos. Todo mês cada um aporta um valor em títulos do Tesouro
              Direto. Em vez de controlar “quem comprou qual título”, o fundo
              usa um sistema de <strong className="text-bone">cotas</strong>:
              cada aporte compra cotas, e a posse de cada irmão é a quantidade
              de cotas que ele detém.
            </P>
            <P>
              Diariamente, um processo automático lê os preços oficiais do
              Tesouro e recalcula quanto vale o patrimônio do fundo e, com isso,
              o <strong className="text-bone">valor de cada cota</strong>. Assim
              o ganho (ou a perda) é distribuído de forma justa, proporcional à
              participação de cada um — sem ninguém precisar refazer contas.
            </P>
            <P>
              A navegação tem três abas para todos —{' '}
              <strong className="text-bone">Painel</strong> (visão geral,
              patrimônio individual, participação e a prévia de lançamentos),{' '}
              <strong className="text-bone">Aportes</strong> e{' '}
              <strong className="text-bone">Resgates</strong> — mais a aba{' '}
              <strong className="text-bone">Admin</strong> para o administrador.
              O livro completo (Histórico) abre pelo botão “Ver tudo” na prévia
              do painel.
            </P>
          </div>
        </Card>
      </div>

      {/* 2. Conceitos */}
      <div id="conceitos" className="scroll-mt-24">
        <Card
          title="Conceitos-chave"
          description="As ideias que explicam quase tudo no fundo."
        >
          <div className="flex flex-col gap-4">
            <Term term="Cota (participação / propriedade)">
              A unidade de posse do fundo. Quantas cotas você tem define que
              fatia do patrimônio é sua. Aportar aumenta suas cotas; um resgate
              pessoal queima (reduz) as suas cotas.
            </Term>
            <Term term="Valor da cota">
              Quanto vale uma cota hoje ={' '}
              <span className="nums">Patrimônio Líquido ÷ total de cotas</span>.
              Começa em <span className="nums">R$ 1,00</span> na abertura do
              fundo e sobe/desce conforme os títulos rendem. Seu patrimônio ={' '}
              <span className="nums">suas cotas × valor da cota</span>.
            </Term>
            <Term term="Patrimônio Líquido (PL)">
              O valor de mercado de toda a carteira do fundo, já descontado o
              imposto de renda que incidiria no resgate. É a soma do valor
              líquido de cada lote de título.
            </Term>
            <Term term="IR regressivo">
              O imposto sobre o rendimento de cada lote cai com o tempo de
              posse: <span className="nums">22,5%</span> até 180 dias,{' '}
              <span className="nums">20%</span> de 181 a 360,{' '}
              <span className="nums">17,5%</span> de 361 a 720 e{' '}
              <span className="nums">15%</span> acima de 720 dias. O fundo
              aplica isso sozinho no cálculo diário.
            </Term>
            <Term term="Lote">
              Cada compra de um título vira um lote (quantidade + preço de
              custo + data). Saídas vendem unidades do lote mais antigo daquele
              título primeiro (regra FIFO), o que mantém o IR e o rendimento de
              cada compra calculados corretamente.
            </Term>
            <Callout>
              <strong>Cota ≠ adimplência.</strong> Cotas medem{' '}
              <em>propriedade</em> (quanto do fundo é seu). Estar “em dia” mede{' '}
              <em>pontualidade</em> nas mensalidades (seção{' '}
              <a href="#obrigacoes" className="text-brass underline">
                Obrigações mensais
              </a>
              ). São coisas independentes: dá para ter poucas cotas e estar 100%
              em dia, ou muitas cotas e estar atrasado.
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
                <LI>Acompanha painel, patrimônio individual e participação.</LI>
                <LI>Registra os próprios aportes e reinvestimentos.</LI>
                <LI>Pede resgates pessoais e propõe despesas dos pais.</LI>
                <LI>Edita ou remove os próprios lançamentos no histórico.</LI>
              </UL>
            </div>
            <div>
              <H3>
                Administrador <AdminTag />
              </H3>
              <UL>
                <LI>Define o saldo de abertura do fundo.</LI>
                <LI>
                  Classifica despesas propostas (despesa dos pais × resgate) e
                  pode lançar despesa direta.
                </LI>
                <LI>Cadastra novos títulos no catálogo do Tesouro.</LI>
                <LI>Gera, concilia e remove as obrigações mensais.</LI>
                <LI>
                  Reconstrói o histórico e administra qualquer lançamento.
                </LI>
              </UL>
            </div>
          </div>
        </Card>
      </div>

      {/* 4. Setup */}
      <div id="setup" className="scroll-mt-24">
        <Card
          title="Primeiros passos (Admin)"
          description="A sequência para colocar o fundo no ar a partir de uma carteira que já existia."
        >
          <div className="flex flex-col gap-4">
            <P>
              O fundo começa num momento arbitrário (data de corte, ou{' '}
              <strong className="text-bone">D0</strong>), não no primeiro dia da
              vida real da carteira. Tudo que veio antes é colapsado no saldo de
              abertura. A ordem recomendada:
            </P>
            <UL>
              <LI>
                <strong>1. Carregar os preços históricos</strong> <AdminTag />{' '}
                Rode o <span className="nums">backfill</span> uma vez para
                popular a base de preços do Tesouro (ver{' '}
                <a href="#manutencao" className="text-brass underline">
                  Manutenção
                </a>
                ). É o que permite o D0 sugerir os preços automaticamente e o
                histórico ser reconstruído com fidelidade.
              </LI>
              <LI>
                <strong>2. Conferir o catálogo de títulos</strong> <AdminTag />{' '}
                Garanta que todos os títulos da sua carteira existem no catálogo
                (ver{' '}
                <a href="#catalogo" className="text-brass underline">
                  Catálogo de títulos
                </a>
                ). Um título que não está no catálogo não recebe preço nem pode
                ser comprado.
              </LI>
              <LI>
                <strong>3. Gravar o saldo de abertura</strong> <AdminTag /> Na
                aba <strong className="text-bone">Admin</strong>, informe a data
                de corte e, para cada título da carteira em D0, uma{' '}
                <strong>contribuição</strong>: o irmão que aportou, o título, a
                quantidade e o valor (o preço é sugerido pela base). A cota de
                cada irmão sai do valor que ele aportou (ver{' '}
                <a href="#cotas-abertura" className="text-brass underline">
                  Cotas de abertura
                </a>
                ).
              </LI>
              <LI>
                <strong>4. Gerar as obrigações mensais</strong> <AdminTag />{' '}
                Cria as mensalidades de cada irmão da abertura até hoje (ver{' '}
                <a href="#obrigacoes" className="text-brass underline">
                  Obrigações mensais
                </a>
                ).
              </LI>
            </UL>
            <P>
              A partir daí, cada aporte, resgate ou reinvestimento reconstrói a
              curva de patrimônio sozinho — você só volta a “Reconstruir
              histórico” depois de carregar preços novos ou editar lançamentos
              antigos.
            </P>
          </div>
        </Card>
      </div>

      {/* 5. Cotas de abertura */}
      <div id="cotas-abertura" className="scroll-mt-24">
        <Card
          title="Cotas de abertura"
          description="Como decidir quantas cotas cada irmão recebe no D0."
        >
          <div className="flex flex-col gap-4">
            <P>
              Em D0 não há imposto a destacar: o preço informado de cada título
              vira a própria base de custo. O patrimônio de abertura é a soma{' '}
              <span className="nums">quantidade × preço</span> de cada
              contribuição. A cota de cada irmão{' '}
              <strong>deriva do valor que ele aportou</strong> — você não
              distribui cotas à mão, elas saem das contribuições.
            </P>
            <H3>Passo a passo</H3>
            <UL>
              <LI>
                Para cada título da carteira em D0, lance uma{' '}
                <strong>contribuição</strong> com o irmão que o aportou, a
                quantidade e o valor.
              </LI>
              <LI>
                A cota de cada irmão é calculada sozinha:{' '}
                <span className="nums">
                  cotas_irmão = Σ (valor que ele aportou) ÷ valor inicial da
                  cota
                </span>
                . Com o valor inicial em <span className="nums">R$ 1,00</span>{' '}
                (o padrão recomendado), as cotas de cada um são iguais ao que
                ele aportou e a cota de abertura sai exatamente em{' '}
                <span className="nums">R$ 1,00</span>.
              </LI>
              <LI>
                Se um título foi aportado por mais de um irmão, lance-o como{' '}
                <strong>duas contribuições</strong> (a fatia de cada um).
              </LI>
            </UL>
            <P>
              O <strong>valor inicial da cota</strong> é a cotação de gênese do
              fundo: a mesma para todos os irmãos e a base de toda a evolução da
              cota daí em diante. Deixe em <span className="nums">R$ 1,00</span>{' '}
              salvo se tiver um motivo para começar noutro valor.
            </P>
            <Callout>
              Exemplo: a carteira em D0 vale{' '}
              <span className="nums">R$ 90.000</span> e a participação combinada
              é 40% / 35% / 25% → cotas{' '}
              <span className="nums">36.000 / 31.500 / 22.500</span>.
            </Callout>
            <H3>Casos especiais</H3>
            <UL>
              <LI>
                <strong>Não sei o quanto cada um aportou:</strong> não tem
                problema — você só informa as <em>cotas</em> de cada irmão. A
                participação real vem das cotas; o valor de cada fatia é
                derivado (cotas × valor inicial da cota).
              </LI>
              <LI>
                <strong>Irmão que entrou depois / aportou menos:</strong> recebe
                menos cotas — e está tudo certo. Menos cotas é menos
                propriedade, não significa estar devendo.
              </LI>
              <LI>
                <strong>Irmão que começa em débito</strong> (sacou mais do que
                tinha de lastro antes do D0): grave a abertura com as cotas que
                ele de fato tem e lance, no histórico, um{' '}
                <strong>resgate pessoal datado logo após o D0</strong> com o
                valor do saque. A reconstrução acerta as cotas dele.
              </LI>
            </UL>
          </div>
        </Card>
      </div>

      {/* 6. Aportes */}
      <div id="aportes" className="scroll-mt-24">
        <Card
          title="Registrar um aporte"
          description="Aba Aportes. Como entra dinheiro novo no fundo."
        >
          <div className="flex flex-col gap-4">
            <UL>
              <LI>
                Escolha um título <em>disponível para compra</em> (só esses
                aparecem na lista), informe a quantidade de unidades e o{' '}
                <strong>valor total aportado</strong> em reais. O preço unitário
                aparece ao lado, interligado: editar a quantidade, o preço ou o
                valor total atualiza os outros — o último campo que você mexer
                manda. Um <strong>chip de sugestão</strong> traz a cotação de
                compra do título na data do evento (vinda da base de preços);
                clique para preencher.
              </LI>
              <LI>
                O aporte vira cotas pela cotação vigente e cria um lote real na
                carteira do fundo.
              </LI>
              <LI>
                A adimplência se ajusta sozinha: o valor aportado abate seu{' '}
                <strong>saldo devedor</strong> e quita os meses em aberto, do
                mais antigo para o mais novo (ver{' '}
                <a href="#obrigacoes" className="text-brass underline">
                  Obrigações mensais
                </a>
                ).
              </LI>
              <LI>
                A data pode ser retroativa (qualquer cotista). O lançamento
                reconstrói o histórico na hora, então o valor da cota já sai
                certo para a data escolhida.
              </LI>
              <LI>
                <strong>Nota (opcional):</strong> um campo livre para registrar
                o contexto do aporte. É só texto — não entra em nenhum cálculo.
              </LI>
            </UL>
            <H3>Aporte que também repõe um resgate</H3>
            <P>
              Se você fez um resgate pessoal antes (tirou dinheiro para si), o
              painel mostra um saldo de{' '}
              <strong className="text-bone">resgate a repor</strong>. Quando há
              esse saldo, o aporte exibe uma <strong>divisão</strong>: parte do
              valor vai para a mensalidade do mês e parte para abater o resgate.
              O sistema sugere cobrir a mensalidade e mandar o excedente para a
              reposição, mas você ajusta como quiser.
            </P>
            <Callout>
              A divisão é só um rótulo contábil — o aporte inteiro compra o
              título e gera cotas normalmente. O que ela controla é quanto do
              aporte conta como mensalidade (adimplência) e quanto abate o
              “resgate a repor”. A parte marcada como reposição{' '}
              <strong>não</strong> conta como contribuição do mês.
            </Callout>
          </div>
        </Card>
      </div>

      {/* 7. Saídas */}
      <div id="saidas" className="scroll-mt-24">
        <Card
          title="Resgates e despesas"
          description="Aba Resgates. Todo dinheiro que sai do fundo segue por um destes três caminhos."
        >
          <div className="flex flex-col gap-4">
            <P>
              Toda saída é registrada igual: título, quantidade, valor bruto e
              data (com a mesma sugestão de preço do aporte, aqui pela cotação de
              venda/resgate). O que muda é a natureza:
            </P>
            <div>
              <H3>1. Resgate pessoal (direto)</H3>
              <P>
                Um irmão tira dinheiro para si. Nasce já aprovado: o fundo vende
                as unidades (do lote mais antigo daquele título primeiro) e{' '}
                <strong className="text-bone">queima as cotas</strong> do
                solicitante no valor do resgate. Só afeta quem resgatou. O valor
                retirado vira um <strong>resgate a repor</strong> no painel, que
                um aporte futuro pode abater (ver{' '}
                <a href="#aportes" className="text-brass underline">
                  Aportes
                </a>
                ).
              </P>
            </div>
            <div>
              <H3>2. Despesa dos pais (proposta)</H3>
              <P>
                Um gasto em benefício dos pais, proposto por qualquer cotista.
                Nasce <strong className="text-bone">pendente</strong> e não
                conta até o admin classificar:
              </P>
              <UL>
                <LI>
                  <strong>Aprovar como despesa</strong> <AdminTag /> — o fundo
                  liquida o necessário e o custo é dividido por todos.
                </LI>
                <LI>
                  <strong>Reclassificar como resgate</strong> <AdminTag /> —
                  vira um resgate pessoal do solicitante (liquida e queima as
                  cotas dele).
                </LI>
              </UL>
            </div>
            <div>
              <H3>
                3. Despesa dos pais (direta) <AdminTag />
              </H3>
              <P>
                Atalho do admin para um gasto já decidido: nasce aprovado, sem
                passar pela fila de classificação.
              </P>
            </div>
            <Callout>
              <strong>Regra de ouro da despesa dos pais:</strong> nenhuma cota
              de nenhum irmão é queimada. O patrimônio total cai e o valor da
              cota cai proporcionalmente para todos — cada um arca com sua
              fatia. O admin não pode classificar a própria proposta.
            </Callout>
          </div>
        </Card>
      </div>

      {/* 8. Reinvestimento */}
      <div id="reinvestimento" className="scroll-mt-24">
        <Card
          title="Reinvestimento"
          description="Aba Aportes, cartão Reinvestimento. Quando um título vence ou você rebalanceia a carteira."
        >
          <div className="flex flex-col gap-4">
            <P>
              Reinvestimento é uma <strong>rotação de carteira</strong>: o fundo
              liquida unidades de um título de <strong>origem</strong> e reaplica
              o caixa em um ou mais títulos de <strong>destino</strong>. O
              dinheiro já era do fundo (coletivo), então isto{' '}
              <strong className="text-bone">não é um aporte</strong>: nenhuma
              cota é gerada ou queimada, ninguém ganha participação e{' '}
              <strong>não conta como mensalidade</strong>. Use quando um título
              vence (o caixa precisa ir para outro) ou para rebalancear.
            </P>
            <H3>Como preencher</H3>
            <UL>
              <LI>
                Escolha o título de <strong>origem</strong> (pode ser qualquer
                um da carteira, inclusive já vencido) e a quantidade a liquidar,
                mais a data.
              </LI>
              <LI>
                O painel mostra <span className="nums">bruto → IR → líquido</span>{' '}
                da origem: o bruto é a venda das unidades, o IR é descontado lote
                a lote, e o <strong>líquido</strong> é o caixa que sobra para
                reaplicar.
              </LI>
              <LI>
                Liste um ou mais títulos de <strong>destino</strong>{' '}
                (disponíveis para compra), cada um com quantidade e valor. A soma
                dos destinos precisa <strong>bater com o líquido</strong> (até R$
                0,01) — isso garante que o patrimônio do fundo não muda na troca.
              </LI>
            </UL>
            <Callout>
              Como o patrimônio é conservado (sai um título, entra outro de
              mesmo valor líquido) e nenhuma cota se mexe, o valor da cota segue
              contínuo. Reinvestimento não pode ser editado — para corrigir,
              remova e lance de novo. Na lista do histórico ele aparece com a
              origem e, no destino, “N títulos” quando reaplicou em vários.
            </Callout>
          </div>
        </Card>
      </div>

      {/* 9. Histórico */}
      <div id="historico" className="scroll-mt-24">
        <Card
          title="Histórico e correções"
          description="Página Histórico (botão “Ver tudo” na prévia do painel). O livro completo de lançamentos."
        >
          <div className="flex flex-col gap-4">
            <UL>
              <LI>
                Filtre por cotista, tipo e período. Cada um pode{' '}
                <strong>editar ou remover os próprios lançamentos</strong>; o
                admin administra qualquer um. O saldo de abertura não é editável
                aqui (gerido na aba Admin) e reinvestimentos não são editáveis
                (corrija removendo e recriando).
              </LI>
              <LI>
                As mudanças funcionam como um <strong>rascunho</strong>: você
                empilha criações, edições e remoções, vê tudo refletido na
                tabela (linhas riscadas, valores destacados) e pode desfazer
                linha a linha. O modal de novo lançamento cobre aporte, resgate e
                despesa, com os mesmos campos das abas de operação.
              </LI>
              <LI>
                Só ao clicar em <strong>Salvar alterações</strong> tudo é
                enviado de uma vez e o histórico é reconstruído uma única vez.
                Se alguma linha falhar, nada é gravado (tudo ou nada) e o erro
                aponta a linha culpada.
              </LI>
              <LI>
                Lançamentos criados aqui já saem com a cota histórica correta,
                porque a reconstrução recompõe a cota de cada data.
              </LI>
            </UL>
          </div>
        </Card>
      </div>

      {/* 10. Obrigações */}
      <div id="obrigacoes" className="scroll-mt-24">
        <Card
          title="Obrigações mensais"
          description="Aba Admin. O controle de quem está em dia com a mensalidade."
        >
          <div className="flex flex-col gap-4">
            <P>
              A adimplência tem{' '}
              <strong className="text-bone">duas lentes</strong>, ambas
              calculadas sozinhas a partir dos seus aportes:
            </P>
            <UL>
              <LI>
                <strong>Saldo da mensalidade</strong> (dinheiro exato): o total
                que você deveria ter aportado menos o que aportou. Se sobrou,
                vira <strong>crédito</strong> e abate os próximos meses; se
                faltou, acumula como <strong>saldo devedor</strong>. É o número
                que aparece no seu painel. A parte de um aporte marcada como
                reposição de resgate não entra nessa conta.
              </LI>
              <LI>
                <strong>Status de cada mês</strong> (verde/vermelho): um mês é
                considerado <strong>quitado</strong> quando seus aportes cobrem
                pelo menos <span className="nums">90%</span> do valor esperado
                acumulado até ele. A folga de 10% existe justamente porque preço
                de título raramente fecha redondo.
              </LI>
            </UL>
            <Callout>
              <strong>Quitei tudo atrasado de uma vez?</strong> Sem problema. O
              valor aportado preenche os meses em aberto do mais antigo para o
              mais novo — então pagar cinco meses atrasados num aporte só pinta
              os cinco de verde retroativamente, e o saldo zera.
            </Callout>
            <H3>Ações do admin</H3>
            <UL>
              <LI>
                <strong>Gerar obrigações</strong> <AdminTag /> cria uma fatura
                por irmão por mês, da data de abertura até o mês corrente, com o
                valor mensal definido (padrão{' '}
                <span className="nums">R$ 1.000</span>). Gerar de novo não
                duplica nem sobrescreve o que já existe — e guardar uma linha
                por mês é o que permite mudar o valor mensal no futuro sem
                reescrever o passado.
              </LI>
              <LI>
                <strong>Override manual</strong> <AdminTag /> o status é
                automático, mas o admin pode forçar um mês para{' '}
                <strong>pago</strong> ou <strong>pendente</strong> (casos fora
                do sistema: contribuição em dinheiro, mês perdoado). Um mês
                forçado como <strong>pago</strong> sai também do saldo devedor
                (some da dívida). O mês ganha a etiqueta <em>manual</em>; o botão{' '}
                <strong>Auto</strong> remove o override e devolve o cálculo à
                regra dos 90%.
              </LI>
              <LI>
                <strong>Remover</strong> <AdminTag /> apaga um mês de vez (por
                exemplo, um mês que não deveria existir). Diferente do override,
                ele some da lista e <strong>não é recriado</strong> ao gerar as
                obrigações de novo.
              </LI>
              <LI>
                Todo dia 1º, o sistema gera automaticamente a mensalidade do mês
                novo.
              </LI>
            </UL>
          </div>
        </Card>
      </div>

      {/* 11. Catálogo de títulos */}
      <div id="catalogo" className="scroll-mt-24">
        <Card
          title="Catálogo de títulos"
          description="Aba Admin, cartão Catálogo de títulos. Quais títulos o fundo conhece."
        >
          <div className="flex flex-col gap-4">
            <P>
              O catálogo é a lista central de títulos que o fundo acompanha. O
              fechamento diário só atualiza o preço de títulos{' '}
              <strong>já cadastrados</strong> — um vencimento novo que aparece no
              Tesouro (ex.: um “Tesouro Selic 2032”) fica de fora até ser
              adicionado, e só títulos marcados como{' '}
              <strong>disponíveis para compra</strong> aparecem nos aportes.
            </P>
            <H3>Ações do admin</H3>
            <UL>
              <LI>
                <strong>Buscar títulos no Tesouro</strong> <AdminTag /> consulta
                o CSV oficial e lista os títulos (Selic e IPCA+) que ainda não
                estão no catálogo. Escolha um — o nome e o preço vêm prontos,
                sem digitação — marque se está disponível para compra e adicione.
              </LI>
              <LI>
                <strong>Tornar comprável / indisponível</strong> <AdminTag /> na
                lista do catálogo, controla quais títulos aparecem como opção de
                aporte. Adicionar um título nunca sobrescreve um preço já
                conhecido (isso é tarefa do job diário).
              </LI>
            </UL>
          </div>
        </Card>
      </div>

      {/* 12. Fechamento diário */}
      <div id="fechamento" className="scroll-mt-24">
        <Card
          title="Fechamento diário"
          description="O que acontece sozinho, todo dia útil — você não precisa fazer nada."
        >
          <div className="flex flex-col gap-4">
            <P>
              Em dias úteis, à noite, um processo agendado executa
              automaticamente:
            </P>
            <UL>
              <LI>
                Baixa os preços oficiais do dia (CSV público do Tesouro
                Transparente, sem custo).
              </LI>
              <LI>Atualiza o preço de cada título do catálogo.</LI>
              <LI>
                Recalcula o patrimônio líquido (aplicando o IR regressivo lote a
                lote) e grava o novo valor da cota no histórico.
              </LI>
            </UL>
            <P>
              É por isso que o painel mostra patrimônio e valor de cota sempre
              atualizados sem ninguém mexer.
            </P>
          </div>
        </Card>
      </div>

      {/* 13. Manutenção */}
      <div id="manutencao" className="scroll-mt-24">
        <Card
          title="Manutenção do histórico"
          description="As três ações do cartão Gestão de histórico, na aba Admin."
        >
          <div className="flex flex-col gap-4">
            <div>
              <H3>
                Atualizar preços diários (backfill) <AdminTag />
              </H3>
              <P>
                Baixa de uma vez todo o histórico de preços do Tesouro na base (a
                partir do CSV oficial, em modo{' '}
                <span className="nums">backfill</span>). Rode antes da abertura e
                sempre que faltarem preços: é o que dá lastro à sugestão de preço
                e à reconstrução fiel.
              </P>
            </div>
            <div>
              <H3>
                Reconstruir histórico <AdminTag />
              </H3>
              <P>
                Reprocessa todos os eventos em ordem cronológica contra os
                preços históricos: recompõe a carteira a cada data, recalcula as
                cotas de cada lançamento pela cota real do dia e regenera a
                curva diária de patrimônio e cota desde o primeiro evento.{' '}
                <strong>
                  Aportes, resgates e reinvestimentos já reconstroem a curva
                  sozinhos ao serem lançados
                </strong>{' '}
                — use este botão sobretudo depois de carregar preços novos
                (backfill).
              </P>
            </div>
            <div>
              <H3>
                Limpar todas as movimentações <AdminTag />
              </H3>
              <P>
                Zera o livro inteiro — aportes, resgates, despesas,
                reinvestimentos, obrigações e a curva de PL, inclusive o saldo de
                abertura. Só preserva o catálogo de títulos e os preços
                históricos diários. É irreversível: exige digitar{' '}
                <span className="nums">limpar tudo</span> para liberar. Use para
                recomeçar o fundo do zero.
              </P>
            </div>
            <Callout>
              Sem os preços históricos carregados (backfill), a reconstrução usa
              o último preço conhecido para trás (carry-forward) — funciona, mas
              a curva fica menos precisa. Rode o backfill primeiro.
            </Callout>
          </div>
        </Card>
      </div>

      {/* 14. FAQ */}
      <div id="faq" className="scroll-mt-24">
        <Card title="Dúvidas comuns">
          <div className="flex flex-col gap-4">
            <Term term="Por que meu patrimônio mudou se eu não fiz nada?">
              Porque o valor da cota muda todo dia com o preço dos títulos. Suas
              cotas continuam as mesmas; o que elas valem é que oscila.
            </Term>
            <Term term="Tenho menos cotas que meus irmãos. Estou devendo?">
              Não necessariamente. Cotas medem propriedade. Estar “em dia” é
              outra conta, nas obrigações mensais. Veja{' '}
              <a href="#conceitos" className="text-brass underline">
                Conceitos-chave
              </a>
              .
            </Term>
            <Term term="O mês está verde, mas ainda apareço com saldo devedor. Como?">
              São as duas lentes da{' '}
              <a href="#obrigacoes" className="text-brass underline">
                adimplência
              </a>
              : o mês fica verde com 90% do valor, mas o saldo é dinheiro exato.
              Se você aportou R$ 980 de R$ 1.000, o mês conta como quitado e
              sobram R$ 20 no saldo — que o próximo aporte abate.
            </Term>
            <Term term="O que é o “resgate a repor” no meu painel?">
              É quanto você já tirou em resgates pessoais e ainda não devolveu ao
              fundo. Some um aporte e use a divisão dele para abater esse saldo
              (ver{' '}
              <a href="#aportes" className="text-brass underline">
                Aportes
              </a>
              ). Não é obrigatório, é só um indicador.
            </Term>
            <Term term="Lancei um aporte com data antiga — preciso reconstruir o histórico?">
              Não. Aportes, resgates e reinvestimentos já reconstroem a curva ao
              serem salvos, então a cota sai certa para a data. Só volte a{' '}
              <a href="#manutencao" className="text-brass underline">
                reconstruir
              </a>{' '}
              depois de carregar preços novos.
            </Term>
            <Term term="Um título que comprei não aparece na lista de aportes.">
              Ou ele não está no catálogo, ou está marcado como indisponível para
              compra. O admin resolve no{' '}
              <a href="#catalogo" className="text-brass underline">
                catálogo de títulos
              </a>
              .
            </Term>
            <Term term="Propus uma despesa dos pais e ela não apareceu no patrimônio.">
              Despesas propostas ficam pendentes e não contam até o admin
              classificá-las como despesa ou resgate.
            </Term>
            <Term term="Errei um lançamento. Como corrigir?">
              No{' '}
              <a href="#historico" className="text-brass underline">
                Histórico
              </a>
              , edite ou remova (seus próprios lançamentos; o admin, qualquer
              um) e salve as alterações. Reinvestimento não se edita — remova e
              lance de novo.
            </Term>
          </div>
        </Card>
      </div>
    </div>
  )
}
