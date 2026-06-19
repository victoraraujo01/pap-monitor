# Regras de Negócio, Títulos e Cotas

## 1. O Catálogo de Títulos (Bond Registry)
O sistema não confia em *strings* soltas. Existe uma entidade central de Títulos (`treasury_bonds`).
* Apenas títulos cadastrados e marcados como ativos nesta tabela podem ser selecionados pelos cotistas no momento de um novo aporte.
* O script diário de automação usa a chave de identificação desta tabela para buscar o preço correto na API e atualiza o campo `current_price` no próprio catálogo.

## 2. A Tabela Regressiva de IR
O cálculo do PL líquido deve iterar sobre todos os lotes ativos cruzando-os com o preço atual salvo no Catálogo de Títulos e considerando o imposto que seria cobrado sobre o rendimento.

```
Rendimento = (Qtd Títulos * Preço Atual no Catálogo) - (Qtd Títulos * Preço de Compra)
```

Tabela de imposto: 
* Até 180 dias: 22,5% | 181 a 360 dias: 20,0% | 361 a 720 dias: 17,5% | Acima de 720 dias: 15,0%

## 3. Eventos Transacionais

### A. Aporte (Compra)
* Ao aportar, o Cotista visualiza um dropdown alimentado exclusivamente pela tabela `treasury_bonds` do banco. Ele preenche a quantidade e o preço pago. O lote é salvo com referência relacional ao título (`bond_id`) e ao usuário.

### B. Resgate Pessoal e Despesa dos Pais
* A mesma lógica se aplica. A venda de lotes e queima (ou não) de cotas segue o fluxo de FIFO e aprovação.