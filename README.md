# Faith Brothers Hub — v1.0

Sistema de gestão da academia **Faith Brothers BJJ**: alunos, presenças QR, graduação, financeiro (Asaas + PIX/Boleto), WhatsApp (Evolution API) e dashboard administrativo.

**Stack:** React 18 + Vite + TypeScript + Tailwind/shadcn-ui + TanStack Query + Supabase (PostgreSQL + RLS + Edge Functions Deno).

---

## Funcionalidades

- Login por **WhatsApp + senha** (email sintético `@wa.faithbrothers.app`)
- Recuperação de senha via **OTP WhatsApp** (persistente no banco + rate limit)
- **RBAC** com três papéis: `admin`, `professor`, `aluno`
- Presença por **QR Code** (token oculto — validação server-side)
- Graduação, ranking, turmas, relatórios
- Financeiro completo: mensalidades, cobranças Asaas, webhook, histórico, recibos
- WhatsApp centralizado com **fila**, histórico e reenvio
- Dashboard com dados 100% reais

---

## Permissões (RBAC)

| Papel | Acesso |
|-------|--------|
| **admin** | Tudo: financeiro, configurações, professores, alunos, presenças |
| **professor** | Alunos, turmas, presenças, graduação, ranking, relatórios, dashboard |
| **aluno** | Apenas seus dados: presença, graduação, financeiro, perfil |

Administradores da academia (admin + professor): Ramon, Herbert, Warlen, André e Lanes — cadastrados via seed de desenvolvimento (`FB_BLOCO6` ou Edge Function com `STAFF_SEED_JSON`).

---

## Setup local

```bash
npm install
cp .env.example .env
# Preencha VITE_SUPABASE_* no .env
npm run dev
```

App em `http://localhost:8080`.

### Banco de dados (Supabase SQL Editor)

Execute em ordem:

1. `supabase/FB_BLOCO1_ENUMS.sql`
2. `supabase/FB_BLOCO2_TABELAS.sql`
3. `supabase/FB_BLOCO3_FUNCOES.sql`
4. `supabase/FB_BLOCO4_RLS.sql`
5. `supabase/FB_BLOCO5_RPCS.sql`
6. `supabase/migrations/20260627120000_production_finalization.sql`
7. `supabase/FB_BLOCO6_USUARIOS.sql` *(somente DEV)*

Ou use `supabase db push` com CLI.

### Edge Functions

Deploy das 8 functions em `supabase/functions/`:

| Function | Descrição |
|----------|-----------|
| `generate-monthly-billings` | Cron dia 12 — gera cobranças Asaas |
| `process-whatsapp-queue` | Processa fila de mensagens pendentes |
| `send-billing-whatsapp` | Reenvio manual de cobrança |
| `asaas-webhook` | Confirma pagamentos + WhatsApp |
| `record-attendance` | Presença via QR |
| `reset-password` | OTP persistente |
| `send-whatsapp` | Envio admin |
| `seed-admin-users` | Seed DEV (desabilitado em produção) |

### Secrets (Supabase Dashboard)

| Secret | Uso |
|--------|-----|
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions |
| `SUPABASE_ANON_KEY` | Validação JWT |
| `EVOLUTION_API_*` | WhatsApp |
| `ASAAS_API_KEY` | Cobranças |
| `ASAAS_WEBHOOK_TOKEN` | Webhook |
| `BILLING_CRON_SECRET` | Cron billing + fila WhatsApp |
| `ALLOWED_ORIGINS` | CORS (ex: `https://seu-dominio.com`) |
| `ALLOW_DEV_SEED` | `true` apenas em DEV |
| `SEED_DEV_SECRET` | Protege seed-admin-users |
| `STAFF_SEED_JSON` | JSON array de staff (ver `supabase/dev/staff-seed.example.json`) |

### Cron externo (free tier)

```bash
# Dia 12 — gerar cobranças
curl -X POST https://<projeto>.supabase.co/functions/v1/generate-monthly-billings \
  -H "x-cron-secret: <BILLING_CRON_SECRET>"

# A cada 5 min — fila WhatsApp
curl -X POST https://<projeto>.supabase.co/functions/v1/process-whatsapp-queue \
  -H "x-cron-secret: <BILLING_CRON_SECRET>"
```

---

## Scripts

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Desenvolvimento |
| `npm run build` | Build produção |
| `npm run lint` | ESLint |
| `npm test` | Vitest |

---

## Estrutura

```
src/
├── components/     # UI + Layout + guards
├── contexts/       # AuthContext (RBAC)
├── hooks/          # useQueries (TanStack Query)
├── lib/            # api, constants, whatsapp-auth
├── pages/          # Rotas (lazy loaded)
supabase/
├── functions/      # Edge Functions + _shared/
├── migrations/     # SQL versionado
└── FB_BLOCO*.sql   # Setup manual idempotente
```

---

## Usuários DEV (FB_BLOCO6)

Senha padrão staff: `faithbrothers2026`

| Nome | WhatsApp | Papéis |
|------|----------|--------|
| Ramon | 31987540515 | admin + professor |
| Herbert | 31998565661 | admin + professor |
| Warlen | 31997586456 | admin + professor |
| André | 31981044156 | admin + professor |
| Lanes | 31987438874 | admin + professor |
| Aluno Teste | 31999999999 | aluno (senha: 123456) |

---

## Deploy

Guia completo: **[DEPLOY_CHECKLIST.md](./DEPLOY_CHECKLIST.md)**
Testes manuais: **[MANUAL_TEST_PLAN.md](./MANUAL_TEST_PLAN.md)**
Entrega v1.0: **[FINAL_RELEASE.md](./FINAL_RELEASE.md)**

1. Aplicar migrations no Supabase
2. Deploy Edge Functions + configurar secrets
3. `npm run build` → servir `dist/` (Vercel, Netlify, etc.)
4. Configurar cron externo
5. Configurar webhook Asaas → `asaas-webhook`
6. **Produção:** `ALLOW_DEV_SEED=false`, rotacionar secrets

---

© Faith Brothers Academy — v1.0
