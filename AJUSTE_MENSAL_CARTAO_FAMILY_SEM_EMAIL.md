# Ajuste: mensal boleto/cartão + Family sem e-mail

**Status:** GO-LIVE aplicado (migration remota + código).  
**Produção (RPCs):** atualizada em 2026-08-11 via `20260813120000`.  
**Relatório de go-live:** `GO_LIVE_MENSAL_CARTAO_FAMILY_SEM_EMAIL.md`

**Go-live anterior (local only) supersedido.**

---

## Escopo

1. Plano **mensal** (iniciante e veterano): escolha explícita **Boleto** XOR **Cartão de crédito / maquininha**.
2. Cartão: nunca Asaas boleto; `aguardando_conferencia`; só ADM confirma; cobertura após confirmação.
3. Family V2: remover e-mail da UI; login WhatsApp/telefone + senha (e-mail sintético interno preservado).

---

## Auditoria (antes)

| Área | Achado |
|------|--------|
| New student mensal | Backend já aceitava boleto + machine; UI oferecia 5 métodos |
| Veteran mensal | `set_veteran_billing_period` forçava boleto e ativava |
| Cron Asaas | Não checava método cartão após `ativo` |
| Family | Auth já era WhatsApp→`{fone}@wa.faithbrothers.app`; UI pedia e-mail de cobrança |

---

## Implementação

### Frontend / lib

- `paymentMethodsForNewStudentPlan` → mensal só `boleto` \| `cartao_credito`
- `paymentMethodsForVeteranMonthly` + labels claras
- `VeteranPeriodDialog`: escolha boleto/cartão no mensal
- `student-plan-situation`: mostra forma de pagamento também enquanto aguarda confirmação
- `shouldSkipAsaasForPrepaidMonth`: skip cartão / aguardando conferência
- `FamilyRegistrationWizard`: remove campo/validação/envio de e-mail (`financial_responsible_email: null`)

### Migration (NÃO aplicada)

`supabase/migrations/20260813120000_monthly_card_boleto_choice.sql`

- `prepaid_cron_skip_reason`: skip machine method + aguardando conferência
- `set_veteran_billing_period`: mensal boleto (Asaas/`ativo`) XOR cartão (`aguardando_conferencia`)

### Preservado

- Preços new_student e veteran
- T/S/A prepaid
- `registration_approved` ≠ `payment_confirmed`
- Login/recuperação por WhatsApp + senha
- PasswordInput (olhinho)

---

## Testes

Arquivo: `src/test/monthly-card-family-no-email.test.ts`  

- `npm test` → 29 files / 246 tests passed  
- `npm run build` → OK  
- `npm run lint` → 0 errors (3 warnings pré-existentes)

---

## Checklist

| Item | Resultado |
|------|-----------|
| iniciante mensal Boleto/Cartão | SIM |
| veterano mensal Boleto/Cartão | SIM (UI + migration local) |
| cartão não gera boleto | PASS (helper + RPC skip) |
| Family sem e-mail | SIM |
| produção alterada | NÃO |
