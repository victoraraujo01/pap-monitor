# Contexto e Arquitetura do Sistema PAP

## 1. Visão Geral do Produto
O sistema gerencia o Fundo de Investimento Familiar **PAP (Projeto Aposentadoria Pais)**. O backend possui um "Motor de PL Interno" que estima o valor total do patrimônio líquido do fundo com base no valor atual de cada título do tesouro direto (a ser obtido via API) e referências de impostos. O sistema possui um **Catálogo Central de Títulos**, gerenciado pelo Administrador, que atua como a única fonte da verdade para os ativos operados pelo fundo. O motor cruza esse catálogo com os preços da internet para encontrar o Patrimônio Líquido (PL) Consolidado e atualizar o Valor da Cota.

## 2. Stack Tecnológico
* **Frontend:** React (Vite/Next.js) na Vercel (Repositório Privado).
* **Backend & Banco de Dados:** Supabase (PostgreSQL, Auth).
* **Regras de Negócio e Cálculo:** Supabase Edge Functions (Deno/TypeScript) acionadas nativamente via `pg_cron`.
* **Infraestrutura (Keep-Alive):** GitHub Actions rodando um script (Cron Job) a cada 3 dias APENAS para disparar um ping (HTTP GET) na API do Supabase, prevenindo que o projeto entre em pausa no plano gratuito. O GitHub Actions não processa dados financeiros.

## 3. Papéis de Usuário (RBAC)
* **Cotista (Irmãos):** Registra aportes (selecionando o título a partir do Catálogo Interno), resgates e despesas. Visualiza dashboards, consulta histórico e aprova transações.
* **Administrador:** Além de gerir usuários e monitorar cargas via logs de edge functions, é o responsável pela **Governança do Catálogo de Títulos** (ativar/desativar títulos permitidos para compra e sincronizar identificadores da API)