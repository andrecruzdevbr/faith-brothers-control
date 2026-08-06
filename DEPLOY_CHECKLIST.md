# Faith Brothers Control — Checklist de Deploy (Produção)

Guia operacional para deploy em **Supabase** (backend) + **Vercel** (frontend).

> **Pré-requisitos locais:** Node.js 18+, npm, [Supabase CLI](https://supabase.com/docs/guides/cli), conta Supabase, conta Vercel, conta Asaas, instância Evolution API.

---

## Comandos rápidos (referência)

```bash
# ── Repositório ──
npm install
npm test
npm run build
npm run preview          # opcional: testar dist/ localmente

# ── Supabase CLI ──
supabase login
supabase link --project-ref SEU-PROJECT-REF

# Banco (aplica todas as migrations em supabase/migrations/)
supabase db push

# Edge Functions (deploy de todas de uma vez)
supabase functions deploy

# Ou deploy individual:
supabase functions deploy reset-password
supabase functions deploy seed-admin-users
supabase functions deploy generate-monthly-billings
supabase functions deploy send-billing-whatsapp
supabase functions deploy asaas-webhook
supabase functions deploy record-attendance
supabase functions deploy send-whatsapp
supabase functions deploy process-whatsapp-queue

# Secrets (exemplos — substitua valores)
supabase secrets set ALLOWED_ORIGINS="https://seu-app.vercel.app"
supabase secrets set ALLOW_DEV_SEED=false
supabase secrets set BILLING_CRON_SECRET="cole-um-segredo-forte-aqui"
supabase secrets set ASAAS_API_KEY="sua-chave"
supabase secrets set ASAAS_WEBHOOK_TOKEN="seu-token-webhook"
supabase secrets set EVOLUTION_API_URL="https://sua-evolution-api"
supabase secrets set EVOLUTION_API_KEY="sua-chave"
supabase secrets set EVOLUTION_INSTANCE_NAME="FaithBrothersAcademia"
supabase secrets set SUPABASE_ANON_KEY="sua-anon-key"
# SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetados automaticamente pelo Supabase
```

---

## Passo 1 — Criar projeto Supabase

- [ ] Criar projeto em [supabase.com](https://supabase.com) (região próxima ao Brasil, se disponível).
- [ ] Anotar:
  - **Project URL** → `VITE_SUPABASE_URL` / `SUPABASE_URL`
  - **Project ref** → `VITE_SUPABASE_PROJECT_ID`
  - **anon public key** → `VITE_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_ANON_KEY`
  - **service_role key** → apenas secrets das Edge Functions (nunca no frontend).
- [ ] Atualizar `supabase/config.toml` → `project_id = "SEU-PROJECT-REF"` (ou confiar no `supabase link`).

---

## Passo 2 — Configurar banco de dados

### Caminho recomendado: `supabase db push`

Aplica **16 migrations** em ordem cronológica. A última (`20260627120000_production_finalization.sql`) remove o trigger de escalação por telefone, reforça RLS, cria tabelas `classes`, `whatsapp_messages`, `otp_rate_limits` e RPCs de segurança.

```bash
supabase login
supabase link --project-ref SEU-PROJECT-REF
supabase db push
```

### Caminho alternativo: SQL manual (SQL Editor)

Use **apenas se não usar `db push`**, em projeto vazio:

| Ordem | Arquivo |
|-------|---------|
| 1 | `supabase/FB_BLOCO1_ENUMS.sql` |
| 2 | `supabase/FB_BLOCO2_TABELAS.sql` |
| 3 | `supabase/FB_BLOCO3_FUNCOES.sql` |
| 4 | `supabase/FB_BLOCO4_RLS.sql` |
| 5 | `supabase/FB_BLOCO5_RPCS.sql` |
| 6 | `supabase/migrations/20260627120000_production_finalization.sql` |

> **Não execute FB_BLOCO e `db push` no mesmo banco** — escolha um caminho.

### Seed de usuários (produção)

- [ ] **Não execute** `FB_BLOCO6_USUARIOS.sql` em produção (contém senhas de desenvolvimento).
- [ ] Crie contas admin via:
  1. Cadastro normal + promoção via RPC `manage_staff_member` (por um super-admin criado manualmente no Auth), **ou**
  2. Seed temporário com `ALLOW_DEV_SEED=true` + `STAFF_SEED_JSON` (ver passo 5), depois **desabilitar imediatamente**.

### Verificação pós-SQL

```sql
-- Deve retornar 0 linhas (trigger removido)
SELECT proname FROM pg_proc WHERE proname = 'auto_assign_role_by_phone';

-- Deve listar policies em todas as tabelas principais
SELECT tablename, COUNT(*) FROM pg_policies WHERE schemaname = 'public' GROUP BY tablename;
```

---

## Passo 3 — Configurar Auth (Supabase)

- [ ] **Authentication → Providers → Email:** habilitado.
- [ ] **Confirm email:** pode desabilitar (login usa WhatsApp sintético `@wa.faithbrothers.app`).
- [ ] **Site URL:** URL da Vercel (ex. `https://faith-brothers.vercel.app`).
- [ ] **Redirect URLs:** adicionar URL de produção + `http://localhost:8080` (dev).
- [ ] **JWT expiry:** padrão (3600s) ou conforme política da academia.
- [ ] **Password policy:** mínimo 8 caracteres (app já valida no frontend e em `reset-password`).

---

## Passo 4 — Configurar secrets (Supabase Edge Functions)

| Secret | Obrigatório | Descrição |
|--------|-------------|-----------|
| `SUPABASE_URL` | Auto | Injetado pelo Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto | Injetado pelo Supabase |
| `SUPABASE_ANON_KEY` | **Sim** | Validação JWT nas functions |
| `ALLOWED_ORIGINS` | **Sim (prod)** | CORS — URL da Vercel |
| `BILLING_CRON_SECRET` | **Sim** | Header `x-cron-secret` nos crons |
| `ASAAS_API_KEY` | **Sim** | Geração de cobranças |
| `ASAAS_WEBHOOK_TOKEN` | **Sim** | Validação webhook |
| `EVOLUTION_API_URL` | **Sim** | WhatsApp |
| `EVOLUTION_API_KEY` | **Sim** | WhatsApp |
| `EVOLUTION_INSTANCE_NAME` | **Sim** | WhatsApp |
| `ALLOW_DEV_SEED` | **Sim** | Deve ser `false` em produção |
| `SEED_DEV_SECRET` | Não (prod) | Apenas se seed temporário |
| `STAFF_SEED_JSON` | Não (prod) | Apenas se seed temporário |
| `DEV_DEFAULT_PASSWORD` | Não | Evitar em produção |

```bash
supabase secrets set ALLOWED_ORIGINS="https://SEU-DOMINIO.vercel.app"
supabase secrets set ALLOW_DEV_SEED=false
supabase secrets set BILLING_CRON_SECRET="$(openssl rand -hex 32)"
# ... demais secrets
```

- [ ] Confirmar secrets: `supabase secrets list`

---

## Passo 5 — Deploy das Edge Functions

```bash
supabase functions deploy
```

| Function | JWT (`config.toml`) | Auth em produção |
|----------|---------------------|------------------|
| `reset-password` | `false` | Público + rate limit OTP |
| `seed-admin-users` | `false` | Bloqueado se `ALLOW_DEV_SEED=false` |
| `generate-monthly-billings` | `false` | `x-cron-secret` ou JWT admin |
| `send-billing-whatsapp` | `false` | JWT admin (validação manual) |
| `asaas-webhook` | `false` | Header `asaas-access-token` |
| `record-attendance` | default `true` | Bearer JWT aluno/staff |
| `send-whatsapp` | default `true` | Bearer JWT admin |
| `process-whatsapp-queue` | `false` | `x-cron-secret` |

Módulo compartilhado `_shared/` é importado automaticamente pelo CLI.

### Smoke test pós-deploy

```bash
# Deve retornar 403 (seed desabilitado em produção)
curl -X POST "https://SEU-PROJECT-REF.supabase.co/functions/v1/seed-admin-users" \
  -H "Content-Type: application/json"

# Deve retornar 401 (sem cron secret)
curl -X POST "https://SEU-PROJECT-REF.supabase.co/functions/v1/generate-monthly-billings"
```

---

## Passo 6 — Cron jobs (GitHub Actions + opcional externo)

O free tier do Supabase **não** executa `pg_cron` de forma confiável.
O agendamento **real** do projeto está em:

**`.github/workflows/billing-cron.yml`** (GitHub Actions)

| Quando (BRT) | Função | Body |
|---|---|---|
| Dia **10**, 08:00 | `generate-monthly-billings` | `{}` (usa `send_whatsapp_automatically`) |
| Dia **18**, 08:00 | `send-billing-whatsapp` | `{"scope":"overdue_reminder"}` |

Secrets do repositório GitHub (Settings → Secrets):

- `SUPABASE_FUNCTIONS_BASE_URL` = `https://wojqjxtaqjasnfhbotxi.supabase.co/functions/v1`
- `BILLING_CRON_SECRET` = mesmo valor do secret Supabase

Também é possível disparar manualmente: Actions → **Billing cron** → Run workflow.

### Alternativa (cron-job.org / similar)

```
POST https://SEU-PROJECT-REF.supabase.co/functions/v1/generate-monthly-billings
Header: x-cron-secret: <BILLING_CRON_SECRET>
Header: Content-Type: application/json
Body: {}
```

Dia 18 (atrasados):

```
POST .../send-billing-whatsapp
Header: x-cron-secret: <BILLING_CRON_SECRET>
Body: {"scope":"overdue_reminder"}
```

### Fila WhatsApp (a cada 5 minutos)

```
POST https://SEU-PROJECT-REF.supabase.co/functions/v1/process-whatsapp-queue
Header: x-cron-secret: <BILLING_CRON_SECRET>
```

- [ ] Confirmar secrets no GitHub Actions.
- [ ] Testar `workflow_dispatch` (generate) e verificar logs no Supabase → Edge Functions.

---

## Passo 7 — Webhook Asaas

- [ ] Painel Asaas → Integrações → Webhooks.
- [ ] URL: `https://SEU-PROJECT-REF.supabase.co/functions/v1/asaas-webhook`
- [ ] Header personalizado: `asaas-access-token: <ASAAS_WEBHOOK_TOKEN>`
- [ ] Eventos: `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`, `PAYMENT_OVERDUE`, `PAYMENT_DELETED`.
- [ ] Testar com cobrança sandbox e confirmar atualização em `billings.status`.

---

## Passo 8 — Configurar Vercel

- [ ] Importar repositório Git na [Vercel](https://vercel.com).
- [ ] **Framework Preset:** Vite.
- [ ] **Build Command:** `npm run build`
- [ ] **Output Directory:** `dist`
- [ ] **Install Command:** `npm install`

---

## Passo 9 — Variáveis na Vercel

| Variável | Ambiente | Valor |
|----------|----------|-------|
| `VITE_SUPABASE_URL` | Production | `https://SEU-PROJECT-REF.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Production | anon public key |
| `VITE_SUPABASE_PROJECT_ID` | Production | project ref |

- [ ] **Não** adicionar `SERVICE_ROLE_KEY`, `ASAAS_API_KEY` ou `EVOLUTION_API_KEY` na Vercel.
- [ ] Redeploy após configurar variáveis.

---

## Passo 10 — Testes pós-deploy

Execute o plano completo em **`MANUAL_TEST_PLAN.md`**.

Resumo:

- [ ] **12.** Login administrador (admin + professor).
- [ ] **13.** Login professor (sem acesso a `/financeiro`, `/configuracoes`, `/professores`).
- [ ] **14.** Login aluno (só rotas `/minha-*`).
- [ ] **15.** Financeiro: listagem, reenvio WhatsApp, webhook pagamento.
- [ ] **16.** WhatsApp: teste em Configurações + OTP recuperação senha.
- [ ] **17.** Presença QR: professor gera → aluno escaneia.
- [ ] **18.** Permissões: aluno não vê dados de outro aluno.

---

## Passo 11 — Checklist final antes de liberar

- [ ] `ALLOW_DEV_SEED=false` confirmado (`supabase secrets list`).
- [ ] `ALLOWED_ORIGINS` aponta para domínio de produção (não `*`).
- [ ] Senhas padrão de desenvolvimento **alteradas** para todos os staff.
- [ ] `service_role` nunca exposta no frontend ou repositório.
- [ ] Webhook Asaas ativo e testado.
- [ ] Crons configurados e com log de sucesso.
- [ ] RLS ativo (ver query no passo 2).
- [ ] Backup do projeto Supabase habilitado (plano pago) ou export periódico.
- [ ] Domínio customizado (opcional) configurado na Vercel + Supabase Auth URLs.

---

## Ordem das migrations (`supabase db push`)

```
20260316120224_723ea8cb...   # schema inicial
20260316120242_49c9e671...   # view financial
20260316122028_48d459f6...   # pg_cron (pode falhar no free — ignorar se erro)
20260316122122_769d18a1...   # pg_cron
20260316122739_48afe3eb...
20260316122829_071c7d9f...
20260317153855_7d82e897...
20260318151550_3cb72316...
20260318152450_1fa2533c...   # auto_assign trigger (removido na final)
20260318153148_551a2d1d...
20260320025225_8da08d88...
20260321035626_4d902200...
20260321035924_88d0fb9c...
20260527011506_25b00173...
20260527011525_10757e1c...
20260627120000_production_finalization.sql   # HARDENING — obrigatória
```

---

## Variáveis obrigatórias — resumo

### Frontend (.env / Vercel) — todas obrigatórias

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`

### Edge Functions — obrigatórias em produção

- `SUPABASE_ANON_KEY` (ou `SUPABASE_PUBLISHABLE_KEY`)
- `ALLOWED_ORIGINS`
- `BILLING_CRON_SECRET`
- `ASAAS_API_KEY`
- `ASAAS_WEBHOOK_TOKEN`
- `EVOLUTION_API_URL`
- `EVOLUTION_API_KEY`
- `EVOLUTION_INSTANCE_NAME`
- `ALLOW_DEV_SEED=false`

---

## Pendências conhecidas (não bloqueiam deploy, mas monitore)

| Item | Impacto |
|------|---------|
| `config.toml` usa placeholder `SEU-PROJECT-REF` | Atualizar via `supabase link --project-ref` |
| Migrations `pg_cron` podem falhar no free tier | Usar cron externo (passo 6) |
| Chunk JS > 500 kB | Performance — otimização futura (code-splitting) |
| Após alterações no schema | Rodar `supabase gen types typescript` para regenerar `types.ts` |

---

© Faith Brothers Academy — Deploy v1.0
