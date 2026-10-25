# Faith Brothers Control — Entrega V1.0

**Classificação:** V1.0 consolidada — operação com bloqueios.  
**Repositório:** https://github.com/andrecruzdevbr/faith-brothers-control  
**Branch:** `main`  
**Aplicação:** https://faith-brothers-control.vercel.app  
**Tag:** `v1.0.0` (commit anotado na `main`; confirmar com `git rev-parse v1.0.0`)

Este documento fecha a versão. Não descreve trabalho futuro como se fosse pendência de código.

---

## Arquitetura

SPA React autenticada no Vercel. Dados e regras no Supabase (PostgreSQL, RLS, RPCs, Edge Functions Deno). WhatsApp via Evolution API na VPS, sempre atrás do gate de envio (`WHATSAPP_SEND_ENABLED` + allowlist). Cobranças via Asaas. Automações de Billing, Birthday e fila WhatsApp em GitHub Actions, apontando só para Production.

Login: WhatsApp + senha, e-mail sintético `@wa.faithbrothers.app`. Papéis: `admin`, `professor`, `aluno`.

## Tecnologias

- Frontend: React 18, Vite, TypeScript, Tailwind, shadcn/ui, TanStack Query
- Backend: Supabase Postgres + RLS + Edge Functions (Deno)
- CI/CD: GitHub (Actions + PRs), Vercel Production
- Integrações: Evolution API 2.3.7 (HTTPS), Asaas

## Funcionalidades entregues

- Cadastro, aprovação e gestão de alunos (incluindo fluxo familiar e catálogos oficializados)
- Presença por QR com validação server-side
- Graduação, ranking, turmas e horários
- Financeiro: planos, mensalidades, boleto Asaas, webhook, histórico
- WhatsApp: fila `whatsapp_messages`, envio admin, cobrança, aniversário, OTP de senha
- Dashboard administrativo com dados reais
- Recuperação de senha por OTP WhatsApp

## Infraestrutura

| Peça | Função |
|------|--------|
| Vercel Production | SPA `faith-brothers-control.vercel.app` |
| Supabase Production | `wojqjxtaqjasnfhbotxi` |
| Supabase Staging | `apbksfaztfkxshxffpik` (separado; sem cópia de credenciais de Production) |
| Evolution | `https://faithbrothers-wa.chickenkiller.com` — instância `FaithBrothersAcademia` |
| GitHub Actions | Billing, Birthday, WhatsApp Queue |

DNS, Docker, Caddy e VPS **não** foram alterados neste fechamento.

## Integrações

- **Evolution API:** HTTPS, versão 2.3.7. Envio real só depois de `WHATSAPP_SEND_ENABLED` e allowlist em `_shared/whatsapp.ts`.
- **Asaas:** geração de boleto em `generate-monthly-billings`; confirmação em `asaas-webhook`.
- **GitHub Actions:** chama Edge Functions com `x-cron-secret`. Recusa staging `apbksfaztfkxshxffpik` e exige Production.

## Ambientes

| | Production | Staging |
|--|------------|---------|
| Ref | `wojqjxtaqjasnfhbotxi` | `apbksfaztfkxshxffpik` |
| App | Vercel Production | não é o alvo desta versão |
| Crons | só Production (quando habilitados) | recusados pelo YAML |
| Dados | oficiais | não misturar com Production |

## Edge Functions (Production, conferidas neste fechamento)

| Função | Versão | Publicada (UTC) | JWT |
|--------|--------|-----------------|-----|
| `generate-monthly-billings` | 92 | 2026-10-24T23:31:12Z | false |
| `send-billing-whatsapp` | 87 | 2026-10-24T23:31:51Z | false |
| `process-whatsapp-queue` | 88 | 2026-10-24T23:31:59Z | false |
| `send-whatsapp` | 81 | 2026-10-24T23:32:06Z | true |
| `send-birthday-whatsapp` | 27 | 2026-10-25T00:49:05Z | false |
| `asaas-webhook` | 80 | (anterior) | false |
| `register-student` | 81 | (anterior) | false |
| `reset-password` | 80 | (anterior) | false |
| `record-attendance` | 76 | (anterior) | true |
| `whatsapp-status` | 50 | (anterior) | true |
| `notify-registration-event` | 18 | (anterior) | true |
| `notify-contract-approved` | 16 | (anterior) | true |

`seed-admin-users` existe no repositório e **não** está publicada em Production.

## Automações (GitHub Actions)

| Workflow | Estado | Agenda |
|----------|--------|--------|
| WhatsApp Queue cron | **active** | `2,7,12,17,22,27,32,37,42,47,52,57 * * * *` UTC |
| Billing cron | **disabled_manually** | dia 12 e 19, 11:00 UTC |
| Birthday cron | **disabled_manually** | diário 11:00 UTC |

Billing `auth_check` (dispatch) **não** chama Edge Function e **não** gera cobrança. `generate` e `overdue` continuam perigosos se o workflow for habilitado.

WhatsApp Queue: YAML válido na `main`, workflow ativo. **Nenhuma execução `event=schedule` foi observada até este fechamento.** Isso é pendência do agendador do GitHub, não defeito de produto comprovado no YAML. Monitoramento externo já está configurado. Não declarar cron automático como validado.

## Testes (fechamento)

| Check | Resultado |
|-------|-----------|
| Vitest `--maxWorkers=4` | 54 arquivos, **499 aprovados**, 0 falhas |
| TypeScript `tsc --noEmit -p tsconfig.app.json` | exit 0 |
| ESLint | 0 erros, 3 warnings pré-existentes `react-refresh` |
| Vite build | sucesso |

## Histórico dos PRs incorporados

| PR | Merge | SHA do merge | Conteúdo |
|----|-------|--------------|----------|
| [#1](https://github.com/andrecruzdevbr/faith-brothers-control/pull/1) | 2026-10-24T23:23:56Z | `26625cd7d5701c5bb6462db92537ce2418a4b3f3` | Idempotência billing WhatsApp, birthday só Production, OTP expirado fora da fila, validação de número admin |
| [#2](https://github.com/andrecruzdevbr/faith-brothers-control/pull/2) | 2026-10-25T00:46:47Z | `5a0577a7f23e54b58469ef39d484830fce34a57a` | `auth_check` sem cobrança; aniversário não queima unicidade anual quando a allowlist bloqueia |
| [#3](https://github.com/andrecruzdevbr/faith-brothers-control/pull/3) | 2026-10-25T01:21:43Z | `ddb3626694501413543265cb0d5e5b32166a8f6f` | Cron da fila deslocado do minuto zero (um único agendamento) |

Código de produto congelado em `ddb3626`. A tag `v1.0.0` aponta para o commit de documentação na `main` que incorpora este pacote.

## Estado atual das funcionalidades

| Área | Estado |
|------|--------|
| App Vercel | HTTP 200, deploy da `main` em sucesso |
| Envio WhatsApp | `WHATSAPP_SEND_ENABLED=true` |
| Allowlist | 1 número de homologação (`5531*****4156`) |
| Fila | 5 mensagens históricas, **0 elegíveis** |
| Billing automático | desligado |
| Birthday automático | desligado |
| Fila automática | workflow ativo; **schedule não confirmado** |
| Alunos `ativo` em Production | 0 (1 `pendente_aprovacao`) |
| Cobranças em Production | 0 |

Canário WhatsApp já executado antes desta versão (1 mensagem `general`/`sent`). Não repetido no fechamento.

## Limitações operacionais

- Allowlist impede envio a alunos reais.
- Billing e Birthday não disparam.
- GitHub não comprovou `event=schedule` da fila.
- PITR do banco está desligado; ver `RECUPERACAO_E_BACKUP.md`.
- `package.json` permanece `0.0.0`; a versão de produto é a tag Git `v1.0.0`.
- Sem E2E autenticado neste fechamento (evita registros em Production).

## Procedimentos de manutenção

Ver `OPERACAO_PRODUCTION.md`. Resumo: não ligar Billing/Birthday sem autorização explícita; não ampliar allowlist sem autorização; não rodar migrations; não alterar VPS/Docker/Caddy; deploys de function só com `--use-api` no projeto Production e sem `--prune`.

## Rollback

Ver `RECUPERACAO_E_BACKUP.md`. Em emergência de envio: `WHATSAPP_SEND_ENABLED=false` e desabilitar os três workflows. Não fazer force-push. Não dar `db reset`.

## Critérios para futura ativação

**Billing** — só com autorização explícita, depois de:

1. Revisar alunos `ativo` e competência (após o dia 15 a geração aponta o mês seguinte).
2. Saber que `generate` cria boleto real no Asaas mesmo com WhatsApp restrito.
3. Usar só `auth_check` na primeira conferência (não chama function).
4. Manter Birthday desligado nessa janela.
5. Ter plano de rollback (desabilitar o workflow).

**Birthday** — só com autorização explícita, depois de:

1. Confirmar `send-birthday-whatsapp` v27 (allowlist não queima a unicidade anual).
2. Decidir se a allowlist de homologação é aceitável (não-homologação falha e pode ser retentada).
3. Aceitar disparo diário 11:00 UTC.
4. Manter Billing desligado nessa janela.

**Allowlist / SEND** — não remover a allowlist nem alterar SEND neste documento. Qualquer expansão é operação nova, com autorização nova.
