# NOVO ALUNO PELO ADM

## Objetivo

Habilitar **+ Novo Aluno** em `/alunos` para administrador, reutilizando as mesmas regras do cadastro público (`register-student`, catálogo NEW_STUDENT, Family V2, WhatsApp, aprovação cadastral ≠ pagamento).

## Causa do botão desabilitado

O botão em `src/pages/Alunos.tsx` estava com `disabled` **hardcoded** (stub de UI). Não havia feature flag, permissão ou endpoint incompleto bloqueando — apenas o atributo `disabled` no JSX.

## O que foi implementado

### Frontend

- Botão **+ Novo Aluno** habilitado somente se `canCreateStudentViaAdmin(roles)` → role **admin**.
  - `academy_limited`, `professor` e `aluno`: botão **não aparece**.
- Modal `AdminNewStudentDialog`:
  - escolha Iniciante / Veterano (exclusiva);
  - Individual | Familiar (se `family_plans_enabled` na academia);
  - Iniciante: accordion `NewStudentPlanAccordion` + pagamento (mesmas libs de `Cadastro.tsx`);
  - Veterano: frequência 1/2/3/5, **sem** preço/catálogo/pagamento;
  - sem senha no formulário ADM (servidor gera senha aleatória; aluno usa “Esqueci minha senha”);
  - após sucesso: invalida queries `students` / `student-financial-map` / `student-plan-situation`.
- Family V2: `FamilyRegistrationWizard` com `adminCreated` + `lockedAcademyId` (mesmo edge `register-student`).
- App do aluno: `StudentContractOverview` + `student-plan-situation` (cadastro vs financeiro separados).

### Backend (`register-student`)

- Flag `admin_created: true`:
  - exige `requireAdmin` (RPC `has_role` = `admin`);
  - valida `academy_id` do profile do ADM;
  - gera senha segura se não enviada;
  - após RPC de cadastro: `applyAdminCadastralApproval` (`approved_at` / `approved_by`);
    - prepaid/cartão: **não** marca pago; mantém `aguardando_conferencia`;
    - veterano: `billing_period_status = aguardando_escolha`;
    - mensal boleto: status `ativo` (mesmo padrão de `approve_student` para mensal);
  - WhatsApp: **uma** mensagem `registration_approved` via `dispatchAdminCreatedRegistrationWhatsApp` (idempotente, `sendImmediately: true`) — sem duplicar `registration` + `registration_approved`.

### Dois eventos independentes

| Evento | Trigger | message_type / chave | Efeito |
|--------|---------|----------------------|--------|
| A — Cadastro aprovado | ADM cria (`admin_created`) ou **Aprovar cadastro** | `registration_approved` / `registration:{studentId}:approved` | Cadastro OK; pagamento NÃO confirmado |
| B — Pagamento confirmado | **Pagamento aprovado** | `payment_confirmation` / `contract_approved:{contractId}:payment_confirmed` | Libera meses; WA distinta |

A e B **não** compartilham chave. Aprovar cadastro duas vezes não duplica A; confirmar pagamento duas vezes não duplica B. A não consome B.

### Segurança / RBAC

| Papel | Pode usar Novo Aluno |
|-------|----------------------|
| admin | SIM |
| academy_limited | NÃO |
| professor | NÃO |
| aluno | NÃO |

Backend rejeita `admin_created` sem token admin (401/403). Preço/audience/billing_mode continuam validados no RPC existente. Nenhuma senha em texto puro no WA.

## Arquivos principais

- `src/pages/Alunos.tsx`
- `src/components/AdminNewStudentDialog.tsx`
- `src/lib/admin-new-student.ts`
- `src/components/family/FamilyRegistrationWizard.tsx`
- `src/lib/student-plan-situation.ts`
- `src/components/StudentContractOverview.tsx`
- `src/pages/MeuFinanceiro.tsx`
- `supabase/functions/register-student/index.ts`
- `supabase/functions/notify-registration-event/index.ts`
- `supabase/functions/notify-contract-approved/index.ts`
- `supabase/functions/_shared/registration-whatsapp.ts`
- `supabase/functions/_shared/whatsapp-messages.ts`
- `src/test/admin-new-student.test.ts`
- `src/test/post-approval-plan-whatsapp.test.ts`

## Testes finais (pré-deploy)

- `npm test` → **228 PASS**
- `npm run build` → **OK**
- `npm run lint` → **0 errors** (3 warnings pré-existentes)

## Migration

**Não necessária.**

---

## GO-LIVE (2026-08-10)

**Projeto:** `wojqjxtaqjasnfhbotxi`  
**Escopo:** somente feature Novo Aluno pelo ADM (+ edges WA dos dois eventos).

### Edges publicadas

| Função | Status | Versão |
|--------|--------|--------|
| `register-student` | ACTIVE | 64 |
| `notify-registration-event` | ACTIVE | 4 |
| `notify-contract-approved` | ACTIVE | 2 |

(Edges sem alteração nesta feature **não** foram republicadas.)

### Git / Vercel

- Commit: `feat: enable admin student registration`
- Push: `origin/main`
- Frontend: aguardar Vercel; validar `/alunos` HTTP 200 e botão **+ Novo Aluno** para admin

### Smoke (sem criar aluno real / sem WA real)

- Abrir modal Iniciante: accordion + preços DB + pagamento; cartão sujeito a confirmação posterior
- Abrir Veterano: frequência sem preço/plano/pagamento
- Familiar: Family V2 quando `family_plans_enabled`

### Checklist go-live

| Item | Resultado |
|------|-----------|
| edge register-student publicada | SIM (v64 ACTIVE) |
| botão Novo Aluno em produção | (após Vercel) |
| ADM cria Iniciante | SIM (código + edge) |
| ADM cria Veterano | SIM |
| Family V2 disponível | SIM (quando flag academia) |
| RBAC produção | PASS (admin only + requireAdmin) |
| registration_approved preservado | SIM |
| payment_confirmed independente | SIM |
| cartão continua dependendo de confirmação ADM | SIM |
| GitHub atualizado | (após push) |
| Vercel atualizado | (após deploy) |
| testes finais | 228 PASS / build OK / lint 0 errors |
| produção preservada | SIM (sem migration; sem criar aluno smoke) |
| pode testar cadastro pelo ADM manualmente | SIM (após Vercel) |
