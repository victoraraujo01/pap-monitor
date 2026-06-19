# Fluxos de Execução (Motor Interno e Dashboards)

Esta seção detalha as lógicas que devem ser implementadas através de Edge Functions, RPCs do Supabase ou Queries no Client-Side.

## Caso de Uso 1: Atualização Diária de Preços e PL (100% no Supabase)
1. **Gatilho:** A extensão `pg_cron` do PostgreSQL dispara a Edge Function interna de fechamento diário.
2. **Busca de Dados (Edge Function):**
   - A função faz uma requisição HTTP para a API pública de preços do Tesouro.
   - Faz o parse do JSON e atualiza o campo `current_price` de todos os títulos correspondentes na tabela `treasury_bonds` (via `UPSERT`).
3. **Cálculo de IR e PL (Procedure no Banco):**
   - O sistema busca todos os registros ativos em `fund_bond_lots` cruzando com o `current_price` do catálogo.
   - Calcula o valor bruto atual do lote: `quantity * current_price`.
   - Aplica a tabela regressiva de IR sobre o lucro de cada lote ativo (Até 180 dias: 22,5%; 181-360 dias: 20%; 361-720 dias: 17,5%; >720 dias: 15%).
   - Valor Líquido do Lote = `Valor Bruto - IR`.
4. **Consolidação:**
   - Soma o Valor Líquido de todos os lotes = `novo_pl_global_brl`.
   - Salva em `pl_history` a cota do dia, dividindo o PL pelo total de cotas aprovadas das transações.

## Caso de Uso 2: Registro de Aporte
1. O frontend faz um `GET` na tabela `treasury_bonds` (filtrando `is_available_for_purchase = true`) e popula o dropdown.
2. O Cotista seleciona o título, informa o Preço de Compra da Unidade e a Quantidade.
3. O banco lança a `transaction` gerando cotas com base na última cotação conhecida e salva o lote em `fund_bond_lots` referenciando o `bond_id`.
4. O sistema dá baixa (`status = 'PAID'`) nas faturas mais antigas pendentes em `monthly_obligations`.

## Caso de Uso 3: Solicitação de Saída (Resgate Pessoal vs. Despesa)
Quando o dinheiro sai do fundo, é crucial classificar o impacto na tabela `transactions`.
1. **Input:** O Cotista informa no frontend a necessidade de liquidação, selecionando o tipo de título (`bond_id`) e o valor a ser sacado.
2. **Se for Resgate Pessoal:**
   - A transação nasce diretamente com status `APPROVED`.
   - O sistema aplica a lógica FIFO (reduzindo a `quantity` na tabela `fund_bond_lots` para os lotes mais antigos daquele título).
   - O sistema **queima as cotas** do irmão solicitante de forma equivalente ao valor bruto retirado (reduzindo a fatia dele no fundo).
3. **Se for Despesa dos Pais:**
   - A transação nasce com status `PENDING_APPROVAL`.
   - Nesta etapa, **nenhuma cota é queimada e nenhum título é liquidado** da base `fund_bond_lots`. Fica no aguardo do Caso 4.

## Caso de Uso 4: Aprovação de Despesa do Fundo
1. **Input:** Outro Cotista visualiza o alerta de solicitação pendente e clica em "Aprovar".
2. **Processamento:**
   - O sistema altera a transação para `APPROVED` e assina o campo `approved_by` com o ID de quem aprovou.
   - Imediatamente, o sistema aplica a lógica FIFO aos lotes (`fund_bond_lots`), liquidando a fração do título necessária para cobrir a despesa.
   - **Regra de Ouro:** Nenhuma cota de nenhum irmão é queimada.
   - Consequência: Na próxima execução do Caso de Uso 1 (Cálculo Diário), o PL Total do fundo será menor, forçando o Valor da Cota a cair proporcionalmente para todos os cotistas.

## Caso de Uso 5: Dashboard - Consulta ao Histórico do Fundo
1. **Objetivo:** Fornecer visão macro da saúde financeira do Fundo PAP.
2. **Queries (Client-side / Views):**
   - Fetch na tabela `pl_history` ordenado por data.
   - Renderização de gráfico de linha evolutivo mostrando o crescimento do **Patrimônio Líquido (PL) em R$** e a flutuação do **Valor da Cota**.
   - Agrupamento em `fund_bond_lots` com `treasury_bonds` para mostrar a "Composição da Carteira" (ex: 60% IPCA+, 40% Selic).

## Caso de Uso 6: Dashboard - Consulta ao Histórico Individual
1. **Objetivo:** Responder à pergunta: "Quanto eu tenho e estou devendo alguma coisa?".
2. **Queries (Client-side / Views):**
   - Filtro na tabela `transactions` pelo `profile_id` do usuário logado.
   - Exibição de um extrato claro: Data, Tipo (Aporte ou Resgate), Valor (R$) e Cotas Adquiridas/Queimadas.
   - Exibição em destaque do Patrimônio Individual Atual: `(Total de Cotas do Usuário) * (Último Valor da Cota)`.
   - Card de Alerta informando o status de adimplência consumindo a tabela `monthly_obligations`.

## Caso de Uso 7: Dashboard - Comparativo de Aportes entre Cotistas
1. **Objetivo:** Transparência mútua e visualização da participação de cada irmão.
2. **Queries (Client-side / Views):**
   - Agregação do somatório de cotas agrupado por `profile_id`.
   - Cálculo de "Total Aportado Líquido" (Soma de Aportes - Soma de Resgates Pessoais).
   - Renderização de um gráfico comparativo (Pizza ou Barras horizontais) detalhando o percentual de posse atual (`Fatia do Bolo = Cotas Individuais / Quantidade Total de Cotas`).