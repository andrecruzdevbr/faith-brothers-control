# Faith Brothers Control — Entrega Final v1.0

**Projeto:** Sistema de gestão da academia Faith Brothers BJJ
**Versão:** 1.0.0
**Data da entrega:** 27 de junho de 2026
**Status:** Pronto para implantação em produção (após deploy operacional)

---

## Resumo do projeto

O **Faith Brothers Control** é uma plataforma web completa para gestão de academias de Jiu-Jitsu, desenvolvida exclusivamente para a **Faith Brothers BJJ** (Ouro Branco, MG). O sistema cobre:

- Cadastro e aprovação de alunos
- Controle de presença via **QR Code**
- Graduação (faixas e graus)
- Ranking e relatórios pedagógicos
- **Financeiro** integrado ao **Asaas** (PIX, boleto, webhook de pagamento)
- **WhatsApp** via Evolution API (cobranças, OTP, fila com reenvio)
- Dashboard administrativo com dados reais do banco

Não há dados mock no frontend. Todas as telas consomem Supabase (PostgreSQL + RLS + RPCs + Edge Functions).

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Vercel)                          │
│  React 18 + Vite + TypeScript + TanStack Query + shadcn/ui       │
│  Auth: Supabase JS Client (JWT)                                 │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTPS (REST / RPC)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SUPABASE (Backend)                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ PostgreSQL   │  │ Auth         │  │ Edge Functions (Deno)│  │
│  │ + RLS        │  │ WhatsApp→    │  │ 8 functions + shared │  │
│  │ + RPCs       │  │ email sint.  │  │ modules              │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└───────────┬───────────────────────────────┬─────────────────────┘
            │                               │
            ▼                               ▼
    ┌───────────────┐               ┌───────────────┐
    │ Asaas API     │               │ Evolution API │
    │ (cobranças)   │               │ (WhatsApp)    │
    └───────────────┘               └───────────────┘
            ▲
            │ Webhook
    ┌───────┴───────┐
    │ Cron externo  │  generate-monthly-billings (dia 12)
    │ (cron-job.org)│  process-whatsapp-queue (5 min)
    └───────────────┘
```

**Princípios de segurança:**

- Multi-tenant por `academy_id` com Row Level Security (RLS) em todas as tabelas sensíveis
- Papéis (`admin`, `professor`, `aluno`) em tabela separada `user_roles`
- Token de QR de presença **nunca** exposto via SELECT — validação exclusiva via RPC `record_attendance_by_token`
- Trigger `auto_assign_role_by_phone` **removido** (evita escalação de privilégio)
- OTP de recuperação de senha persistido no banco com rate limit (`otp_tokens`, `otp_rate_limits`)
- Edge Functions com CORS restrito via `ALLOWED_ORIGINS` em produção
- `seed-admin-users` bloqueado quando `ALLOW_DEV_SEED=false`

---

## Tecnologias

| Camada | Stack |
|--------|-------|
| Frontend | React 18, Vite 5, TypeScript 5, Tailwind CSS 3, shadcn/ui, Radix UI |
| Estado / dados | TanStack Query 5, React Hook Form, Zod |
| Gráficos | Recharts |
| QR Code | qrcode.react (professor), html5-qrcode (aluno) |
| Backend | Supabase (PostgreSQL 15+, Auth, Edge Functions Deno) |
| Pagamentos | Asaas API v3 |
| Mensagens | Evolution API (WhatsApp) |
| Deploy frontend | Vercel (recomendado) |
| Testes | Vitest + Testing Library |
| Lint | ESLint 9 + typescript-eslint |

---

## Estrutura do repositório

```
faith-brothers/
├── src/
│   ├── App.tsx                 # Rotas lazy-loaded + RBAC
│   ├── components/             # Layout, Sidebar, ProtectedRoute, UI shadcn
│   ├── contexts/AuthContext.tsx # Sessão, roles, isAdmin/isProfessor/isAluno
│   ├── hooks/useQueries.ts     # TanStack Query — todas as telas
│   ├── integrations/supabase/  # client.ts, types.ts
│   ├── lib/                    # api.ts, constants.ts, whatsapp-auth.ts
│   └── pages/                  # 18 páginas (staff, admin, aluno)
├── public/logo.svg
├── supabase/
│   ├── migrations/             # 16 migrations SQL versionadas
│   ├── FB_BLOCO1-6_*.sql       # Setup manual idempotente
│   ├── functions/              # 8 Edge Functions
│   │   └── _shared/            # cors, env, phone, supabase, whatsapp
│   ├── config.toml             # JWT verify por function
│   └── dev/staff-seed.example.json
├── .env.example
├── README.md
├── LOCAL_SETUP.md
├── DEPLOY_CHECKLIST.md
├── MANUAL_TEST_PLAN.md
└── FINAL_RELEASE.md              # Este documento
```

---

## Banco de dados

### Tabelas principais

| Tabela | Descrição |
|--------|-----------|
| `academies` | Academias (multi-tenant root) |
| `profiles` | Perfil do usuário (nome, WhatsApp, academy_id) |
| `user_roles` | Papéis RBAC (admin, professor, aluno) |
| `students` | Alunos vinculados a profile + plano |
| `plans` | Planos de mensalidade |
| `classes` | Turmas (horários, plano associado) |
| `billings` | Cobranças mensais (Asaas) |
| `academy_billing_settings` | Dia emissão/vencimento, auto WhatsApp |
| `attendance_sessions` | Sessões QR do professor |
| `attendances` | Registros de presença |
| `whatsapp_messages` | Fila e histórico WhatsApp |
| `otp_tokens` | OTP recuperação de senha |
| `otp_rate_limits` | Rate limit OTP por telefone |

### View

| View | Descrição |
|------|-----------|
| `student_financial_overview` | Visão financeira do aluno (join billings + plans) |

### Enums

| Enum | Valores |
|------|---------|
| `app_role` | `admin`, `professor`, `aluno` |
| `student_status` | `ativo`, `inativo`, `pendente_aprovacao`, `rejeitado` |
| `billing_status` | `pendente`, `gerado`, `enviado_whatsapp`, `pago`, `vencido`, `cancelado`, `falhou` |

### RPCs (frontend)

| RPC | Uso |
|-----|-----|
| `get_public_academies` | Cadastro (anon) |
| `complete_student_signup` | Auto-cadastro aluno |
| `approve_student` | Aprovação admin/staff |
| `update_student_graduation` | Alterar faixa/graus |
| `record_attendance_by_token` | Presença via QR (aluno) |
| `manage_staff_member` | Gerenciar admin/professor (admin-only) |
| `can_access_student` / `can_access_billing` | Helpers RLS |
| `is_admin_of_academy` / `is_admin_only` | Helpers permissão |
| `get_my_academy_id` | Contexto da academia |

### Migrations

16 arquivos em `supabase/migrations/`. A migration **obrigatória** de hardening:

`20260627120000_production_finalization.sql`

- Remove trigger de escalação por telefone
- Cria `classes`, `whatsapp_messages`, `otp_rate_limits`
- Reforça RLS (financeiro admin-only, OTP sem acesso client)
- Adiciona RPCs `record_attendance_by_token`, `manage_staff_member`, `is_admin_only`
- Índices de performance

**Setup manual alternativo:** FB_BLOCO1 → FB_BLOCO5 + migration final + FB_BLOCO6 (DEV).

---

## Edge Functions

Módulo compartilhado em `supabase/functions/_shared/`:

| Módulo | Responsabilidade |
|--------|------------------|
| `cors.ts` | CORS com `ALLOWED_ORIGINS` |
| `env.ts` | Leitura segura de secrets |
| `phone.ts` | Normalização WhatsApp, email sintético |
| `supabase.ts` | Clients service role e user JWT |
| `whatsapp.ts` | Envio Evolution + fila `whatsapp_messages` |

### Functions

| Function | Auth | Descrição |
|----------|------|-----------|
| `reset-password` | Público + rate limit | Gera OTP no banco, envia WhatsApp, valida e redefine senha |
| `seed-admin-users` | `x-seed-secret` + `ALLOW_DEV_SEED=true` | Seed staff via `STAFF_SEED_JSON` |
| `generate-monthly-billings` | `x-cron-secret` ou JWT admin | Dia 12: cria cobranças Asaas + enfileira WhatsApp |
| `send-billing-whatsapp` | JWT admin | Reenvio manual de cobrança |
| `send-whatsapp` | JWT admin | Envio livre (Configurações) |
| `record-attendance` | JWT aluno/staff | Proxy para RPC `record_attendance_by_token` |
| `process-whatsapp-queue` | `x-cron-secret` | Processa fila pendente (retry até `max_attempts`) |
| `asaas-webhook` | Header `asaas-access-token` | Confirma pagamentos, atualiza status, envia recibo WhatsApp |

**Tratamento de erro:** todas retornam JSON `{ error: string }` com status HTTP adequado.
**CORS:** OPTIONS + headers em todas. Produção exige `ALLOWED_ORIGINS`.
**Logs:** `console.error` nos catch — visíveis no Supabase Dashboard → Edge Functions → Logs.

---

## Permissões (RBAC)

### Matriz de acesso

| Recurso / Rota | Admin | Professor | Aluno |
|----------------|:-----:|:---------:|:-----:|
| `/dashboard`, `/alunos`, `/turmas` | ✓ | ✓ | ✗ |
| `/presencas`, `/graduacao`, `/ranking`, `/relatorios` | ✓ | ✓ | ✗ |
| `/financeiro`, `/professores`, `/configuracoes` | ✓ | ✗ | ✗ |
| `/minha-presenca`, `/minha-graduacao`, `/meu-ranking` | ✗* | ✗* | ✓ |
| `/meu-financeiro`, `/meu-perfil` | ✗* | ✗* | ✓ |

\* Staff com role admin/professor é redirecionado para `/dashboard` nas rotas de aluno.

### Implementação

- **Frontend:** `ProtectedRoute` com `access="admin" | "staff" | "aluno"` + `AuthContext`
- **Backend:** RLS policies usando `has_role`, `is_admin_of_academy`, `is_admin_only`, `can_access_student`, `can_access_billing`
- **Financeiro:** policies admin-only via `is_admin_only`
- **Aluno:** acesso apenas aos próprios registros via `profile_user_id = auth.uid()`

---

## Fluxo financeiro

```
1. CADASTRO ALUNO
   complete_student_signup → students (pendente_aprovacao)
   approve_student → status ativo + plan_id

2. MENSALIDADE / PLANO
   Admin define plano em Alunos ou turma vinculada a plano

3. COBRANÇA (dia 12 — cron)
   generate-monthly-billings
   → Cria billing no banco (status: gerado)
   → Cria payment no Asaas (PIX/boleto)
   → Atualiza asaas_payment_id, pix_qr_code, boleto_url
   → Enfileira WhatsApp (se auto habilitado)

4. ENVIO WHATSAPP
   process-whatsapp-queue (cron 5 min) ou send-billing-whatsapp (manual)
   → Evolution API → status enviado_whatsapp

5. PAGAMENTO
   Asaas webhook → asaas-webhook
   → billing.status = pago, paid_at
   → WhatsApp recibo/confirmação

6. VISUALIZAÇÃO
   Admin: /financeiro (dashboard, inadimplência, histórico)
   Aluno: /meu-financeiro (próprias cobranças, PIX, boleto)

7. INADIMPLÊNCIA
   status vencido (webhook PAYMENT_OVERDUE ou lógica de due_date)
   Dashboard exibe métricas reais via useQueries
```

---

## Fluxo WhatsApp

```
ENVIO
  send-whatsapp (admin manual)
  send-billing-whatsapp (reenvio cobrança)
  generate-monthly-billings (auto)
  reset-password (OTP)
  asaas-webhook (recibo pago)
       ↓
  queueWhatsApp() → INSERT whatsapp_messages (status: pending)
       ↓
  process-whatsapp-queue (cron)
       ↓
  Evolution API sendText
       ↓
  UPDATE status: sent | failed (+ error_message, attempts++)

REENVIO
  Admin em /financeiro ou /configuracoes
  → Nova entrada na fila ou retry de failed (attempts < max_attempts)

HISTÓRICO / LOGS
  /configuracoes → tabela whatsapp_messages (últimas mensagens)
  Supabase Edge Functions Logs (erros de API)

FALHAS
  status failed + error_message
  Retry automático até max_attempts (padrão 3)
```

---

## Fluxo de presença

```
PROFESSOR (/presencas)
  1. Inicia sessão → INSERT attendance_sessions (token UUID, expires 10 min)
  2. Exibe QR Code com token
  3. Monitora check-ins em tempo real

ALUNO (/minha-presenca)
  1. Escaneia QR com html5-qrcode
  2. POST record-attendance Edge Function (JWT)
  3. RPC record_attendance_by_token:
     - Valida sessão ativa e não expirada
     - Valida aluno ativo na mesma academia
     - Impede duplicata no mesmo dia
     - INSERT attendances

SEGURANÇA
  Token de sessão NÃO é legível via SELECT (RLS)
  Única via validação: RPC server-side
```

---

## Dashboard

O `/dashboard` (staff/admin) exibe métricas reais via TanStack Query:

- Total de alunos ativos
- Presenças do mês
- Receita / inadimplência (admin)
- Gráficos Recharts com dados do Supabase
- Ranking de frequência
- Alunos pendentes de aprovação

Sem mock data. Queries em `src/hooks/useQueries.ts`.

---

## Deploy

### Pré-requisitos

- Projeto Supabase criado
- Conta Vercel
- Conta Asaas (produção ou sandbox)
- Instância Evolution API conectada ao WhatsApp da academia
- Agendador externo (cron-job.org, GitHub Actions)

### Passos resumidos

1. `supabase link --project-ref SEU-PROJECT-REF`
2. `supabase db push` (aplica 16 migrations)
3. `supabase functions deploy` (8 functions)
4. `supabase secrets set` (ver variáveis abaixo)
5. Vercel: import repo, `npm run build`, output `dist/`
6. Configurar variáveis VITE_* na Vercel
7. Webhook Asaas → `/functions/v1/asaas-webhook`
8. Crons: billing (dia 12) + fila WhatsApp (5 min)
9. Executar `MANUAL_TEST_PLAN.md`

**Guia detalhado:** [DEPLOY_CHECKLIST.md](./DEPLOY_CHECKLIST.md)

---

## Variáveis de ambiente

### Frontend (.env / Vercel) — obrigatórias

| Variável | Descrição |
|----------|-----------|
| `VITE_SUPABASE_URL` | URL do projeto Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | anon public key |
| `VITE_SUPABASE_PROJECT_ID` | project ref |

### Edge Functions (Supabase Secrets) — produção

| Secret | Obrigatório | Descrição |
|--------|:-----------:|-----------|
| `SUPABASE_URL` | Auto | Injetado pelo Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto | Injetado pelo Supabase |
| `SUPABASE_ANON_KEY` | Sim | Validação JWT |
| `ALLOWED_ORIGINS` | Sim | CORS — URL da Vercel |
| `BILLING_CRON_SECRET` | Sim | Header `x-cron-secret` |
| `ASAAS_API_KEY` | Sim | API Asaas |
| `ASAAS_WEBHOOK_TOKEN` | Sim | Validação webhook |
| `EVOLUTION_API_URL` | Sim | WhatsApp |
| `EVOLUTION_API_KEY` | Sim | WhatsApp |
| `EVOLUTION_INSTANCE_NAME` | Sim | WhatsApp |
| `ALLOW_DEV_SEED` | Sim | **`false` em produção** |
| `SEED_DEV_SECRET` | DEV | Protege seed |
| `STAFF_SEED_JSON` | DEV | Array JSON de staff |
| `DEV_DEFAULT_PASSWORD` | DEV | Senha seed |

**Referência completa:** [.env.example](./.env.example)

---

## Credenciais de desenvolvimento

> **Somente ambiente DEV.** Nunca usar em produção. Rotacionar antes do go-live.

| Nome | WhatsApp | Senha | Papéis |
|------|----------|-------|--------|
| Ramon | 31987540515 | faithbrothers2026 | admin + professor |
| Herbert | 31998565661 | faithbrothers2026 | admin + professor |
| Warlen | 31997586456 | faithbrothers2026 | admin + professor |
| André | 31981044156 | faithbrothers2026 | admin + professor |
| Lanes | 31987438874 | faithbrothers2026 | admin + professor |
| Aluno Teste | 31999999999 | 123456 | aluno |

Criadas por `supabase/FB_BLOCO6_USUARIOS.sql` ou `seed-admin-users` com `STAFF_SEED_JSON`.

Login: WhatsApp (só dígitos) + senha → email sintético `{whatsapp}@wa.faithbrothers.app`.

---

## Checklist de produção

### Build e qualidade (validado na entrega)

- [x] `npm install` — OK
- [x] `npm test` — 4 testes passando
- [x] `npm run lint` — 0 erros, 0 warnings
- [x] `npm run build` — compilação OK (`dist/`)
- [x] Frontend sem mock data
- [x] `types.ts` sincronizado com migration final
- [x] FB_BLOCO5 inclui RPCs de presença e staff

### Deploy operacional (executar no go-live)

- [ ] `supabase db push` aplicado
- [ ] 8 Edge Functions deployadas
- [ ] Secrets configurados (`ALLOW_DEV_SEED=false`)
- [ ] `ALLOWED_ORIGINS` = URL produção
- [ ] Vercel com VITE_* configuradas
- [ ] Webhook Asaas ativo e testado
- [ ] Cron billing (dia 12) configurado
- [ ] Cron fila WhatsApp (5 min) configurado
- [ ] Senhas DEV rotacionadas
- [ ] `MANUAL_TEST_PLAN.md` executado integralmente
- [ ] Auth URLs no Supabase (Site URL + Redirect)

### Funcionalidades

- [ ] Build funcionando
- [ ] Testes funcionando
- [ ] Projeto compila
- [ ] Projeto executa localmente (`npm run dev`)
- [ ] Projeto executa em produção (Vercel)
- [ ] Banco consistente (RLS + policies)
- [ ] Edge Functions consistentes
- [ ] Segurança consistente
- [ ] RBAC consistente
- [ ] Dashboard funcionando
- [ ] Financeiro funcionando
- [ ] WhatsApp funcionando
- [ ] Presença funcionando
- [ ] QR Code funcionando
- [ ] Graduação funcionando
- [ ] Alunos funcionando
- [ ] Professores funcionando
- [ ] Administradores funcionando

---

## Limitações conhecidas

| Limitação | Detalhe | Mitigação |
|-----------|---------|-----------|
| Cron interno (`pg_cron`) | Pode falhar no free tier Supabase | Cron externo (documentado) |
| Chunk JS > 500 kB | Bundle principal grande (Recharts) | Lazy loading já aplicado; code-split futuro |
| Single academy focus | Seed e UI otimizados para Faith Brothers | Schema multi-tenant pronto para expansão |
| Evolution API dependency | WhatsApp depende de instância externa | Monitorar logs + fila com retry |
| Asaas sandbox vs prod | Chaves diferentes por ambiente | Secrets separados por ambiente |
| Tipos TypeScript | Manuais em `types.ts` | Regenerar com `supabase gen types` após schema changes |
| Professor-only test | Staff seed tem admin+professor | Criar usuário só professor via `manage_staff_member` para teste |

---

## Melhorias futuras (fora do escopo v1.0)

- Code-splitting adicional (Recharts, html5-qrcode)
- Notificações push / e-mail além de WhatsApp
- App mobile nativo (React Native)
- Multi-academia com super-admin global
- Relatórios exportáveis (PDF/Excel)
- Integração PIX direta sem Asaas (alternativa)
- Testes E2E automatizados (Playwright já em devDependencies)
- Painel de auditoria de ações admin
- Backup automatizado documentado

---

## Validação final da entrega

| Etapa | Resultado |
|-------|-----------|
| Revisão TypeScript / ESLint | ✓ Corrigido — 0 erros |
| Build final | ✓ `npm run build` exit 0 |
| Testes | ✓ 4/4 passando |
| Supabase migrations / RLS / RPCs | ✓ Revisado e sincronizado |
| Edge Functions (8) | ✓ Revisadas — auth, CORS, errors |
| Frontend sem mock | ✓ Confirmado |
| RBAC | ✓ Frontend + RLS alinhados |
| Documentação | ✓ README, LOCAL_SETUP, DEPLOY, MANUAL_TEST, .env.example, config.toml |

---

## Versão final

**Faith Brothers Control v1.0.0**
Entrega: 27/06/2026
Repositório pronto para implantação após execução do checklist operacional de produção.

---

© Faith Brothers Academy — Todos os direitos reservados.
