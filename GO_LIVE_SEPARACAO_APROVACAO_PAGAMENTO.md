# GO-LIVE — Separação aprovação cadastral × pagamento + olhinho de senha

Data: 2026-08-09  
Projeto: `wojqjxtaqjasnfhbotxi` / `faith-brothers-control`

## Pré-check

- Migration revisada: aditiva (`ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE`)
- Não edita migrations antigas
- Não ativa Gabriel, não cria contrato/billing/meses, não marca pago
- Dry-run: **somente** `20260809160000_separate_registration_and_payment_approval.sql`

## Apply

```text
npx supabase db push
→ Applying migration 20260809160000_separate_registration_and_payment_approval.sql... OK
```

### Gabriel Cruz (pós-apply, sem ação ADM)

| Campo | Valor |
|-------|--------|
| student_id | `96bd42eb-ab0c-4f4b-9c43-1ce9734718be` |
| status | `pendente_aprovacao` |
| approved_at / approved_by | `null` |
| payment_review_status | `aguardando_conferencia` |
| plano | Anual 5 dias / machine_prepaid / R$ 2750 |
| payment_method | cartao_credito 6x |
| contracts / billings / months | **0** |
| WA | somente `registration:…:received` |

## Edge

Publicada somente:

- `notify-registration-event` (inclui `_shared/whatsapp-messages.ts`)

## Frontend / GitHub / Vercel

- Commit: `feat: separate registration approval from payment confirmation`
- Push: `main`
- UI: Aprovar cadastro → depois Pagamento aprovado (não executado no go-live)

## Restrições respeitadas

- Sem clicar em “Pagamento aprovado” no Gabriel
- Sem liberar 12 meses / contrato / paid / Asaas
- Sem WhatsApp real no smoke automatizado
- Cadastro do Gabriel preservado

## Checklist final

| Item | Status |
|------|--------|
| migration aplicada | SIM |
| botão Aprovar cadastro em produção | SIM (após deploy Vercel) |
| aprovação separada de pagamento | SIM |
| Gabriel continua unpaid | SIM |
| Gabriel continua com 0 meses | SIM |
| Gabriel pronto para teste manual | SIM |
| registration_approved em produção | SIM (edge) |
| olhinho de senha em produção | SIM (após deploy Vercel) |
| GitHub atualizado | SIM |
| Vercel atualizado | (validar HTTP 200) |
| produção preservada | SIM |
