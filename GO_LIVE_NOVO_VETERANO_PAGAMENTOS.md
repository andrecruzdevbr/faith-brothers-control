# GO LIVE — Novo / Veterano + Pagamento + WhatsApp

**Data:** 2026-08-08/09 (BRT)  
**Projeto:** `wojqjxtaqjasnfhbotxi`  
**Frontend:** `https://faith-brothers-control.vercel.app`  
**Commit:** `feat: add new and veteran registration payment flows`

---

## Checklist

| Item | Status |
|------|--------|
| Migration aplicada | **SIM** (`20260808220000` + `20260808223000` grants + `20260808224000` boleto) |
| Edge `register-student` publicada | **SIM** |
| Edge `notify-registration-event` publicada | **SIM** |
| Edge `asaas-webhook` (idempotency) | **SIM** |
| Frontend publicado | *após Vercel* |
| GitHub atualizado | *após push* |
| Vercel atualizado | *após deploy* |
| Novo aluno vê planos `new_student` | **SIM** (RPC: 2/3/5 dias @ 210/230/250) |
| Novo aluno escolhe forma de pagamento | **SIM** (UI + RPC `boleto`/`cartao_*`) |
| Cartão exige confirmação ADM | **SIM** (`aguardando_conferencia`; anon sem EXECUTE confirm) |
| Veterano vê somente 2/3/5 dias | **SIM** (UI; sem catálogo de preços) |
| `veteran_plan_choice` preparado | **SIM** (`billing_period_status` + WA event + `set_veteran_billing_period`) |
| Mensal Asaas preservado | **SIM** |
| Prepaid preservado | **SIM** |
| Familiar preservado | **SIM** |
| Produção preservada | **SIM** |
| Pode liberar cadastro amanhã | **SIM** (com WA real conforme env) |

---

## Pré-check

- Migration principal aditiva: colunas novas, seed anual, RPCs REPLACE, tag `audience=new_student`.
- Não edita migrations antigas.
- Não apaga alunos/contratos/billings.
- Compatível com Asaas mensal, prepaid, familiar, turmas (23 slots intactos), dashboard.
- Follow-ups de segurança no mesmo go-live:
  - `20260808223000_revoke_anon_payment_rpc_grants.sql`
  - `20260808224000_allow_boleto_payment_method.sql` (corrige constraint que bloqueava `boleto`)

## Backup

- Schema: `backup_reg_rules_20260808`
- Contagens pré-apply: plans=7, students=11, contracts=1, billings=1, whatsapp=6, classes_active=23, pending=5

## Dry-run / Apply

1. `20260808220000_registration_payment_whatsapp_rules.sql` — OK  
2. `20260808223000_revoke_anon_payment_rpc_grants.sql` — OK  
3. `20260808224000_allow_boleto_payment_method.sql` — OK  

### Pós-apply preservação

| Métrica | Antes | Depois |
|---------|-------|--------|
| students | 11 | 11 (+ smoke depois) |
| contracts | 1 | 1 |
| billings | 1 | 1 |
| whatsapp | 6 | 6 |
| classes active | 23 | 23 |
| plans | 7 | 10 (+3 anual veterano) |

## Edges publicadas

- `register-student`
- `notify-registration-event` (nova)
- `asaas-webhook` (idempotency key em `payment_confirmation`)

## Smoke (sem cobrança / sem WA real / sem confirmar cartão)

Linhas `SMOKE REG %` inseridas via SQL controlado (não passam pelo Evolution):

| Cenário | Resultado esperado |
|---------|--------------------|
| A novo/boleto | `pendente_aprovacao`, method=`boleto`, review=`nao_aplicavel`, plano new_student |
| B novo/cartão | `aguardando_conferencia`, installments=3, **não** confirmar |
| C veterano 3d | `plan_id` null, `requested_training_days=3`, pendente |

Validado também:

- RPC `get_public_active_plans(_, 'new_student')` → 3 planos mensais
- anon **sem** EXECUTE em `confirm_*` / `set_veteran_billing_period` / registration atomic
- confirm RPC só `authenticated` + `service_role` (ADM checado dentro da função)

## Segurança

- Público não marca pagamento como pago.
- Novo aluno não escolhe plano veterano no filtro público `new_student`.
- Veterano no cadastro não recebe catálogo comercial.
- Cartão só libera via ADM (`confirm_individual_prepaid_payment` / familiar).

## WhatsApp (estrutura; sem envio real no smoke)

| Evento | Tipo / key |
|--------|------------|
| Cadastro recebido | `registration` / `registration:{id}:received` |
| Aprovado | `registration` / `registration:{id}:approved` |
| Veterano modalidade | `registration` / `registration:{id}:veteran_period_request` |
| Pagamento Asaas | `payment_confirmation` / `payment_confirmation:billing:{id}` |
| Pacote confirmado | `contract_approved` (existente) |

Familiar: financeiro permanece no responsável (`notify-contract-approved`).

## Restrições respeitadas

Sem cobrança real · Sem WhatsApp real no smoke · Sem confirmar cartão · Sem alterar secrets · Sem apagar dados · Sem editar migrations antigas.
