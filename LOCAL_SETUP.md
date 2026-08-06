# LOCAL_SETUP.md — Faith Brothers BJJ

Guia completo para rodar o projeto localmente no Cursor IDE (ou qualquer outro
editor) a partir deste ZIP, exatamente no estado em que o código se encontra
hoje.

> **Importante:** este projeto usa Supabase como backend (Postgres + Auth +
> Edge Functions). Não existe um "servidor backend" separado para rodar —
> o backend é o próprio projeto Supabase, e as Edge Functions ficam em
> `supabase/functions/`. O frontend é uma SPA React que conversa direto com
> o Supabase via REST/RPC.

---

## 1. Requisitos

| Ferramenta | Versão recomendada | Obrigatório |
|---|---|---|
| Node.js | 20.x ou 22.x (testado em 22.22.2) | Sim |
| npm | 10.x+ (vem com o Node) | Sim |
| Conta Supabase | Projeto criado (free tier funciona) | Sim |
| Supabase CLI | mais recente | Só para deploy de Edge Functions |
| Git | qualquer versão recente | Recomendado |

Este projeto **não** tem `engines` fixado no `package.json`, mas foi
desenvolvido e testado com Node 22. Evite Node 16 ou anterior — algumas
dependências (Vite 5, Vitest) exigem Node 18+.

---

## 2. Versão do Node

```bash
node --version
# deve retornar v18.x, v20.x ou v22.x
```

Se você usa `nvm`:

```bash
nvm install 22
nvm use 22
```

---

## 3. Como instalar

Extraia o ZIP e entre na pasta do projeto:

```bash
cd faith-brothers
npm install
```

Isso instala todas as dependências listadas em `package.json`
(React, Vite, Tailwind, shadcn/ui, Supabase JS client, react-hook-form,
zod, recharts, etc.).

---

## 4. Como configurar o `.env`

Copie o arquivo de exemplo:

```bash
cp .env.example .env
```

Edite o `.env` com as credenciais do **seu** projeto Supabase:

```bash
VITE_SUPABASE_URL="https://SEU-PROJETO.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="SEU_ANON_KEY_PUBLICO"
VITE_SUPABASE_PROJECT_ID="SEU_PROJECT_REF"
```

Onde encontrar cada valor no painel do Supabase:
- `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` →
  **Project Settings → API → Project URL** e **anon public key**
- `VITE_SUPABASE_PROJECT_ID` → é o subdomínio da URL (ex: `abcxyzproj`)

**Nunca** coloque a `service_role key` neste arquivo — ela só deve existir
como *secret* nas Edge Functions (veja seção 6).

---

## 5. Como executar o frontend

```bash
npm run dev
```

O terminal mostrará algo como:

```
VITE v5.4.19  ready in 400 ms
➜  Local:   http://localhost:8080/
```

Abra essa URL no navegador. Se a porta 8080 estiver ocupada, o Vite sobe
automaticamente em outra porta livre (ex: 8081) — confira a saída do terminal.

---

## 6. Como executar o "backend" (Supabase)

Não há um processo de backend para iniciar localmente — o backend é o seu
projeto Supabase na nuvem. O que você precisa fazer é:

### 6.1. Aplicar o schema do banco

No painel do Supabase, abra **SQL Editor** e execute, **nesta ordem exata**,
os arquivos da pasta `supabase/`:

1. `FB_BLOCO1_ENUMS.sql`
2. `FB_BLOCO2_TABELAS.sql`
3. `FB_BLOCO3_FUNCOES.sql`
4. `FB_BLOCO4_RLS.sql`
5. `FB_BLOCO5_RPCS.sql`
6. `migrations/20260627120000_production_finalization.sql` *(hardening de segurança — obrigatório)*
7. `FB_BLOCO6_USUARIOS.sql` *(somente DEV)*

Cada arquivo tem uma consulta de verificação no final — confirme que ela
retorna resultado sem erro antes de seguir para o próximo bloco.

### 6.2. Publicar as Edge Functions (opcional para rodar o frontend básico,
obrigatório para presença/WhatsApp/cobranças funcionarem)

```bash
npm install -g supabase
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase functions deploy record-attendance
supabase functions deploy reset-password
supabase functions deploy send-whatsapp
supabase functions deploy send-billing-whatsapp
supabase functions deploy generate-monthly-billings
supabase functions deploy asaas-webhook
supabase functions deploy seed-admin-users
```

### 6.3. Configurar os Secrets das Edge Functions

No painel: **Edge Functions → Manage secrets** (ou via CLI
`supabase secrets set NOME=valor`). Os secrets que o código atualmente
referencia são:

**Supabase (obrigatórios para qualquer função funcionar):**
```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ALLOWED_ORIGINS          # ex.: http://localhost:8080 (dev) ou URL da Vercel (prod)
```

**WhatsApp (Evolution API) — usado em `send-whatsapp`, `send-billing-whatsapp`, `process-whatsapp-queue`, `reset-password`, `whatsapp-status`:**
```
WHATSAPP_PROVIDER=evolution
WHATSAPP_SEND_ENABLED=false
WHATSAPP_EVOLUTION_BASE_URL=http://host.docker.internal:8085
WHATSAPP_EVOLUTION_PUBLIC_URL=http://localhost:8085
WHATSAPP_EVOLUTION_API_KEY=<chave-local>
WHATSAPP_EVOLUTION_INSTANCE=FaithBrothersAcademia
```

Modo seguro: com `WHATSAPP_SEND_ENABLED=false` o sistema enfileira mensagens e consulta status, mas **não envia** WhatsApp real via Evolution.

Instâncias Evolution:
- **`FaithBrothersAcademia`** — instância oficial de produção do Faith Brothers (usar esta).
- `faithbrothers-teste` — instância antiga (não usar).
- `faithbrothers-teste-2` — instância temporária de diagnóstico (não usar).
- **`agroraiz-teste`** — pertence ao AgroRaiz; **não mexer**.

URLs:
- Edge Functions em Docker → use `WHATSAPP_EVOLUTION_BASE_URL=http://host.docker.internal:8085`
- Cloud / secrets Supabase → VPS `http://2.24.108.128:8080` (`WHATSAPP_EVOLUTION_BASE_URL` / `PUBLIC_URL`)
- Navegador / QR local → use `http://localhost:8085`
- Conectar QR da instância Faith Brothers:
  `GET http://localhost:8085/instance/connect/FaithBrothersAcademia`
- Status: Edge Function `whatsapp-status` (admin) ou
  `GET .../instance/connectionState/FaithBrothersAcademia`

Scripts:
- Check VPS: `powershell -ExecutionPolicy Bypass -File .\scripts\check-whatsapp-evolution-vps.ps1`
- Deploy functions: `powershell -ExecutionPolicy Bypass -File .\scripts\deploy-whatsapp-functions.ps1`
  (o script **para** se o projeto Supabase estiver `INACTIVE`)

**Não apague nem altere a instância `agroraiz-teste` (outro projeto).**
**Não use `docker compose down -v` nem apague volumes da Evolution.**
**Não configure Supabase Cloud com `host.docker.internal`.**
**Mantenha `WHATSAPP_SEND_ENABLED=false` até validar status + envio controlado.**

Fallback legado ainda aceito: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME`.

**PIX / Cobranças (Asaas) — usado em `generate-monthly-billings`, `asaas-webhook`:**
```
ASAAS_API_KEY
ASAAS_WEBHOOK_TOKEN
```

**Cron Jobs — header `x-cron-secret` em `generate-monthly-billings` e `process-whatsapp-queue`:**
```
BILLING_CRON_SECRET
```

**Seed de usuários administrativos (somente DEV) — `seed-admin-users`:**
```
ALLOW_DEV_SEED=true
SEED_DEV_SECRET=<segredo>
STAFF_SEED_JSON='[{"name":"Ramon","whatsapp":"31987540515","roles":["admin","professor"]}]'
DEV_DEFAULT_PASSWORD=faithbrothers2026
```
Em produção: `ALLOW_DEV_SEED=false` (padrão seguro).

### 6.4. Configurar o Cron Job (agendamento de cobranças mensais)

A Edge Function `generate-monthly-billings` é feita para ser chamada
periodicamente. Como `pg_cron` não está disponível em todos os planos do
Supabase, a forma mais simples é usar um agendador externo (ex: GitHub
Actions, cron-job.org) fazendo uma chamada HTTP POST mensal para:

```
https://SEU-PROJETO.supabase.co/functions/v1/generate-monthly-billings
Header: x-cron-secret: <valor de BILLING_CRON_SECRET>
```

---

## 7. Como popular o banco (dados de teste)

O `FB_BLOCO6_USUARIOS.sql` popula automaticamente:
- 1 academia ("Faith Brothers BJJ")
- 3 planos (Básico, Intermediário, Completo)
- 5 administradores (admin + professor) e 1 aluno de teste

Se quiser popular mais alunos de teste, use a tela **Cadastro** do próprio
app (fluxo de auto-cadastro) ou insira manualmente via SQL Editor seguindo
o padrão da tabela `students`.

---

## 8. Como criar o usuário administrador

O seed de desenvolvimento (`FB_BLOCO6_USUARIOS.sql`) cria:

| Papel | Nome | WhatsApp (login) | Senha |
|---|---|---|---|
| Admin + Professor | Ramon | `31987540515` | `faithbrothers2026` |
| Admin + Professor | Herbert | `31998565661` | `faithbrothers2026` |
| Admin + Professor | Warlen | `31997586456` | `faithbrothers2026` |
| Admin + Professor | André | `31981044156` | `faithbrothers2026` |
| Admin + Professor | Lanes | `31987438874` | `faithbrothers2026` |
| Aluno | Aluno Teste | `31999999999` | `123456` |

O login do app usa WhatsApp + senha (não email). Por trás dos panos, o Supabase Auth usa um e-mail sintético no formato `{whatsapp}@wa.faithbrothers.app` — tratado automaticamente por `src/lib/whatsapp-auth.ts`.

Para promover staff em produção, use a RPC `manage_staff_member` (admin-only) ou a Edge Function `seed-admin-users` com `STAFF_SEED_JSON` (somente com `ALLOW_DEV_SEED=true`).

**Antes de entregar ao cliente final:** troque todas as senhas de teste.

---

## 9. Como executar em modo desenvolvimento

```bash
npm run dev
```

Hot-reload está ativo por padrão (Vite). Qualquer alteração em `src/` é
refletida no navegador automaticamente, sem precisar reiniciar.

Para rodar os testes automatizados (Vitest):

```bash
npm run test          # executa uma vez
npm run test:watch    # modo watch
```

Para lint:

```bash
npm run lint
```

---

## 10. Como gerar build de produção

```bash
npm run build
```

O resultado vai para a pasta `dist/`. Para testar esse build localmente
antes de publicar:

```bash
npm run preview
```

Para publicar, basta hospedar o conteúdo de `dist/` em qualquer serviço de
arquivos estáticos (Vercel, Netlify, Cloudflare Pages, etc.), configurando
as mesmas variáveis de ambiente `VITE_SUPABASE_URL` e
`VITE_SUPABASE_PUBLISHABLE_KEY` no painel da plataforma escolhida.

---

## Estrutura do projeto (visão rápida)

```
faith-brothers/
├── src/
│   ├── pages/            → uma página por rota (Login, Dashboard, Alunos, ...)
│   ├── components/       → componentes compartilhados (AppSidebar, Layout, ...)
│   ├── components/ui/    → biblioteca shadcn/ui (Button, Input, Dialog, ...)
│   ├── contexts/         → AuthContext (estado de autenticação global)
│   ├── hooks/            → useQueries (TanStack Query), use-toast, use-mobile
│   ├── lib/              → api.ts, constants.ts, whatsapp-auth.ts
│   ├── integrations/supabase/  → client.ts e types.ts
│   ├── App.tsx           → rotas lazy-loaded + RBAC
│   └── main.tsx          → ponto de entrada
├── public/logo.svg       → logo da academia
├── supabase/
│   ├── functions/        → 8 Edge Functions + _shared/ (WhatsApp, CORS, auth)
│   ├── migrations/       → inclui 20260627120000_production_finalization.sql
│   ├── FB_BLOCO1-6_*.sql → setup manual idempotente
│   └── dev/staff-seed.example.json → modelo STAFF_SEED_JSON
```

## v1.0 — Checklist de deploy

Ver **[DEPLOY_CHECKLIST.md](../DEPLOY_CHECKLIST.md)** e **[MANUAL_TEST_PLAN.md](../MANUAL_TEST_PLAN.md)**.

1. Rodar FB_BLOCO1–5 + migration `20260627120000` + FB_BLOCO6 (DEV)
2. Deploy das 8 Edge Functions
3. Secrets: `ALLOWED_ORIGINS`, `BILLING_CRON_SECRET`, `ALLOW_DEV_SEED=false` em produção
4. Cron externo: `generate-monthly-billings` (dia 12) + `process-whatsapp-queue` (5 min)
5. Webhook Asaas → `asaas-webhook`
6. `npm run build` e publicar `dist/`

## RBAC

- **admin**: financeiro, configurações, professores + tudo do staff
- **professor**: alunos, turmas, presenças, graduação, ranking, relatórios, dashboard
- **aluno**: apenas dados próprios (RLS garante isolamento)

Staff seed DEV (senha `faithbrothers2026`): Ramon, Herbert, Warlen, André, Lanes — admin + professor.
