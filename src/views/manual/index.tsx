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
  { id: 'historico', label: 'Histórico e correções' },
  { id: 'obrigacoes', label: 'Obrigações mensais' },
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
              Direto. Em vez de controlar “quem comprou qual título”, o fundo usa
              um sistema de <strong className="text-bone">cotas</strong>: cada
              aporte compra cotas, e a posse de cada irmão é a quantidade de
              cotas que ele detém.
            </P>
            <P>
              Diariamente, um processo automático lê os preços oficiais do Tesouro
              e recalcula quanto vale o patrimônio do fundo e, com isso, o{' '}
              <strong className="text-bone">valor de cada cota</strong>. Assim o
              ganho (ou a perda) é distribuído de forma justa, proporcional à
              participação de cada um — sem ninguém precisar refazer contas.
            </P>
          </div>
        </Card>
      </div>

      {/* 2. Conceitos */}
      <div id="conceitos" className="scroll-mt-24">
        <Card
          title="Conceitos-chave"
          description="Quatro ideias que explicam quase tudo no fundo."
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
              Começa em <span className="nums">R$ 1,00</span> na abertura do fundo
              e sobe/desce conforme os títulos rendem. Seu patrimônio ={' '}
              <span className="nums">suas cotas × valor da cota</span>.
            </Term>
            <Term term="Patrimônio Líquido (PL)">
              O valor de mercado de toda a carteira do fundo, já descontado o
              imposto de renda que incidiria no resgate. É a soma do valor
              líquido de cada lote de título.
            </Term>
            <Term term="IR regressivo">
              O imposto sobre o rendimento de cada lote cai com o tempo de posse:{' '}
              <span className="nums">22,5%</span> até 180 dias,{' '}
              <span className="nums">20%</span> de 181 a 360,{' '}
              <span className="nums">17,5%</span> de 361 a 720 e{' '}
              <span className="nums">15%</span> acima de 720 dias. O fundo aplica
              isso sozinho no cálculo diário.
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
                <LI>Registra os próprios aportes.</LI>
                <LI>
                  Pede resgates pessoais e propõe despesas dos pais.
                </LI>
                <LI>
                  Edita ou remove os próprios lançamentos no histórico.
                </LI>
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
                <LI>Gera e concilia as obrigações mensais.</LI>
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
                <strong>2. Gravar o saldo de abertura</strong> <AdminTag /> Na
                aba <strong className="text-bone">Admin</strong>, informe a data
                de corte, a carteira em D0 (cada título com quantidade e preço — o
                preço é sugerido pela base) e as cotas de cada irmão (ver{' '}
                <a href="#cotas-abertura" className="text-brass underline">
                  Cotas de abertura
                </a>
                ).
              </LI>
              <LI>
                <strong>3. Gerar as obrigações mensais</strong> <AdminTag />{' '}
                Cria as mensalidades de cada irmão da abertura até hoje (ver{' '}
                <a href="#obrigacoes" className="text-brass underline">
                  Obrigações mensais
                </a>
                ).
              </LI>
              <LI>
                <strong>4. Reconstruir o histórico</strong> <AdminTag /> Gera a
                curva diária de patrimônio e cota desde o D0.
              </LI>
            </UL>
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
              vira a própria base de custo. Então o patrimônio de abertura é
              simplesmente a soma{' '}
              <span className="nums">quantidade × preço</span> de cada título da
              carteira. As cotas só repartem esse patrimônio entre os irmãos.
            </P>
            <H3>Passo a passo</H3>
            <UL>
              <LI>
                Some o patrimônio em D0:{' '}
                <span className="nums">PL = Σ (quantidade × preço)</span> de todos
                os títulos.
              </LI>
              <LI>
                Defina a <strong>fração de cada irmão</strong> (a divisão de
                propriedade que vocês conseguem defender — por capital líquido
                aportado, ainda que aproximado, ou um acerto combinado).
              </LI>
              <LI>
                Multiplique:{' '}
                <span className="nums">cotas_irmão = fração × PL</span>. Assim a
                soma das cotas é igual ao PL e a cota de abertura sai exatamente
                em <span className="nums">R$ 1,00</span>.
              </LI>
            </UL>
            <Callout>
              Exemplo: a carteira em D0 vale{' '}
              <span className="nums">R$ 90.000</span> e a participação combinada é
              40% / 35% / 25% → cotas{' '}
              <span className="nums">36.000 / 31.500 / 22.500</span>.
            </Callout>
            <H3>Casos especiais</H3>
            <UL>
              <LI>
                <strong>Não sei o quanto cada um aportou:</strong> o campo
                “Aportado (R$)” pode ficar em branco. Ele é só informativo (entra
                nos relatórios de capital aportado); a participação real vem das
                cotas.
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
                <strong>resgate pessoal datado logo após o D0</strong> com o valor
                do saque. A reconstrução acerta as cotas dele.
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
                do lote é deduzido (valor ÷ quantidade) e aparece na prévia.
              </LI>
              <LI>
                O aporte vira cotas pela cotação vigente e cria um lote real na
                carteira do fundo.
              </LI>
              <LI>
                As mensalidades pendentes mais antigas são quitadas
                automaticamente enquanto o valor do aporte cobrir.
              </LI>
              <LI>
                A data pode ser retroativa (qualquer cotista). Lançamentos no
                passado ficam exatos depois de reconstruir o histórico.
              </LI>
            </UL>
          </div>
        </Card>
      </div>

      {/* 7. Saídas */}
      <div id="saidas" className="scroll-mt-24">
        <Card
          title="Resgates e despesas"
          description="Aba Resgates/Despesas. Todo dinheiro que sai do fundo segue por um destes três caminhos."
        >
          <div className="flex flex-col gap-4">
            <P>
              Toda saída é registrada igual: título, quantidade, valor bruto e
              data. O que muda é a natureza:
            </P>
            <div>
              <H3>1. Resgate pessoal (direto)</H3>
              <P>
                Um irmão tira dinheiro para si. Nasce já aprovado: o fundo vende
                as unidades (do lote mais antigo daquele título primeiro) e{' '}
                <strong className="text-bone">queima as cotas</strong> do
                solicitante no valor do resgate. Só afeta quem resgatou.
              </P>
            </div>
            <div>
              <H3>2. Despesa dos pais (proposta)</H3>
              <P>
                Um gasto em benefício dos pais, proposto por qualquer cotista.
                Nasce <strong className="text-bone">pendente</strong> e não conta
                até o admin classificar:
              </P>
              <UL>
                <LI>
                  <strong>Aprovar como despesa</strong> <AdminTag /> — o fundo
                  liquida o necessário e o custo é dividido por todos.
                </LI>
                <LI>
                  <strong>Reclassificar como resgate</strong> <AdminTag /> — vira
                  um resgate pessoal do solicitante (liquida e queima as cotas
                  dele).
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
              <strong>Regra de ouro da despesa dos pais:</strong> nenhuma cota de
              nenhum irmão é queimada. O patrimônio total cai e o valor da cota
              cai proporcionalmente para todos — cada um arca com sua fatia. O
              admin não pode classificar a própria proposta.
            </Callout>
          </div>
        </Card>
      </div>

      {/* 8. Histórico */}
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
                aqui (gerido na aba Admin).
              </LI>
              <LI>
                As mudanças funcionam como um{' '}
                <strong>rascunho</strong>: você empilha criações, edições e
                remoções, vê tudo refletido na tabela (linhas riscadas, valores
                destacados) e pode desfazer linha a linha.
              </LI>
              <LI>
                Só ao clicar em <strong>Salvar alterações</strong> tudo é enviado
                de uma vez e o histórico é reconstruído uma única vez. Se alguma
                linha falhar, nada é gravado (tudo ou nada) e o erro aponta a
                linha culpada.
              </LI>
              <LI>
                Bônus: lançamentos criados em lote já saem com a cota histórica
                correta, porque a reconstrução recompõe a cota de cada data.
              </LI>
            </UL>
          </div>
        </Card>
      </div>

      {/* 9. Obrigações */}
      <div id="obrigacoes" className="scroll-mt-24">
        <Card
          title="Obrigações mensais"
          description="Aba Admin. O controle de quem está em dia com a mensalidade."
        >
          <div className="flex flex-col gap-4">
            <UL>
              <LI>
                <strong>Gerar obrigações</strong> <AdminTag /> cria uma fatura por
                irmão por mês, da data de abertura até o mês corrente, com o valor
                mensal definido (padrão{' '}
                <span className="nums">R$ 1.000</span>). Gerar de novo não duplica
                nem sobrescreve o que já existe.
              </LI>
              <LI>
                Os meses nascem <strong>pendentes</strong>. Marque como{' '}
                <strong>pagos</strong> os que já foram contribuídos — inclusive os
                retroativos, anteriores à entrada do sistema no ar.
              </LI>
              <LI>
                Quando um aporte cobre uma mensalidade, ela é quitada
                automaticamente. O toggle manual serve para corrigir/conciliar.
              </LI>
              <LI>
                Todo dia 1º, o sistema gera automaticamente a mensalidade do mês
                novo.
              </LI>
            </UL>
          </div>
        </Card>
      </div>

      {/* 10. Fechamento diário */}
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
              <LI>
                Atualiza o preço de cada título do catálogo.
              </LI>
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

      {/* 11. Manutenção */}
      <div id="manutencao" className="scroll-mt-24">
        <Card
          title="Manutenção do histórico"
          description="Ferramentas do admin para preço histórico e recomposição da curva."
        >
          <div className="flex flex-col gap-4">
            <div>
              <H3>
                Backfill de preços <AdminTag />
              </H3>
              <P>
                Carrega de uma vez todo o histórico de preços do Tesouro na base
                local (a partir do mesmo CSV oficial, em modo{' '}
                <span className="nums">backfill</span>). É um disparo único,
                feito antes da abertura, e o que dá lastro à sugestão de preço em
                D0 e à reconstrução fiel.
              </P>
            </div>
            <div>
              <H3>
                Reconstruir histórico <AdminTag />
              </H3>
              <P>
                Reprocessa todos os eventos em ordem cronológica contra os preços
                históricos: recompõe a carteira a cada data, recalcula as cotas de
                cada lançamento pela cota real do dia e regenera a curva diária de
                patrimônio e cota desde o primeiro evento. Use depois de editar
                lançamentos antigos ou de carregar novos preços.
              </P>
            </div>
            <Callout>
              Sem os preços históricos carregados (backfill), a reconstrução usa o
              último preço conhecido para trás (carry-forward) — funciona, mas a
              curva fica menos precisa. Rode o backfill primeiro.
            </Callout>
          </div>
        </Card>
      </div>

      {/* 12. FAQ */}
      <div id="faq" className="scroll-mt-24">
        <Card title="Dúvidas comuns">
          <div className="flex flex-col gap-4">
            <Term term="Por que meu patrimônio mudou se eu não fiz nada?">
              Porque o valor da cota muda todo dia com o preço dos títulos. Suas
              cotas continuam as mesmas; o que elas valem é que oscila.
            </Term>
            <Term term="Tenho menos cotas que meus irmãos. Estou devendo?">
              Não necessariamente. Cotas medem propriedade. Estar “em dia” é outra
              conta, nas obrigações mensais. Veja{' '}
              <a href="#conceitos" className="text-brass underline">
                Conceitos-chave
              </a>
              .
            </Term>
            <Term term="Lancei um aporte com data antiga e o valor da cota ficou estranho.">
              Lançamentos retroativos só ficam exatos depois de{' '}
              <a href="#manutencao" className="text-brass underline">
                reconstruir o histórico
              </a>{' '}
              (ou se forem criados pelo rascunho em lote do histórico).
            </Term>
            <Term term="Propus uma despesa dos pais e ela não apareceu no patrimônio.">
              Despesas propostas ficam pendentes e não contam até o admin
              classificá-las como despesa ou resgate.
            </Term>
            <Term term="Errei um lançamento. Como corrigir?">
              No <a href="#historico" className="text-brass underline">Histórico</a>,
              edite ou remova (seus próprios lançamentos; o admin, qualquer um) e
              salve as alterações.
            </Term>
          </div>
        </Card>
      </div>
    </div>
  )
}
