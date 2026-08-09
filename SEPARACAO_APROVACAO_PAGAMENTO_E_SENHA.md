# Separação: aprovação cadastral × pagamento + olhinho de senha

Data: 2026-08-09  
Escopo: **implementação local** (migration criada; **produção ainda NÃO alterada** nesta etapa).

## Auditoria — Gabriel Cruz (antes de qualquer alteração)

| Campo | Valor |
|-------|--------|
| student_id | `96bd42eb-ab0c-4f4b-9c43-1ce9734718be` |
| status | `pendente_aprovacao` |
| audience | `new_student` |
| plan_id | `dcc0e271-38ff-4f25-a9c4-444615da3a3e` |
| plan | Plano Anual 5 dias por semana |
| plan_kind | `anual` |
| billing_mode | `machine_prepaid` |
| duration_months | 12 |
| package_total_amount | 2750 |
| payment_method | `cartao_credito` (6x) |
| payment_review_status | `aguardando_conferencia` |
| contracts | nenhum |
| billings | nenhum |
| meses liberados | **0** |
| WhatsApp | somente `registration:…:received` (sent) |

**Preservado:** cadastro não apagado; pagamento **não** confirmado automaticamente.

## Problema corrigido

Antes, cartão/prepaid na tela ADM mostrava só **“Pagamento aprovado”**, misturando:

1. aprovação dos dados do aluno;
2. confirmação financeira / liberação de meses.

## Fluxo após a correção

```
CADASTRO → pendente_aprovacao
ADM “Aprovar cadastro” → approved_at/approved_by + WA registration_approved
  prepaid/cartão → continua unpaid, 0 meses, status lógico “Aprovado — aguardando pagamento”
  mensal/Asaas → ativo (cron preservado)
  veterano → aguardando definição de plano
ADM “Pagamento aprovado” (só após cadastral + maquininha)
  → contrato pago, meses (anual=12), aluno ativo, WA contract_approved
```

## Migration (nova, aditiva)

`supabase/migrations/20260809160000_separate_registration_and_payment_approval.sql`

- Colunas `students.approved_at` / `students.approved_by`
- `approve_student` deixa de bloquear `aguardando_conferencia`
- Prepaid/família: aprovação cadastral **não** ativa e **não** libera meses
- `confirm_*_prepaid_payment` exige `approved_at` (cadastral primeiro)
- Idempotência de re-clique em “Aprovar cadastro”

## UI / WhatsApp / senha

- `Alunos.tsx`: botões sequenciais conforme estado
- `PrepaidApprovalDialog`: remove `registration_approved` no pagamento (só confirmação financeira)
- `notify-registration-event`: `message_type=registration_approved` + texto sem “acesso já liberado”
- `PasswordInput` em Login, Cadastro, Família, Recuperar senha, Meu Perfil

## Restrições desta etapa

- Produção **não** alterada (sem `db push`)
- Gabriel **não** teve pagamento confirmado
- Sem cobrança Asaas / sem WhatsApp real no smoke automatizado

## Checklist local

| Item | Status |
|------|--------|
| botão Aprovar cadastro | SIM |
| aprovação separada do pagamento | SIM |
| cartão unpaid após cadastral | SIM |
| pagamento só ADM | SIM |
| anual 12 meses só após pagamento | SIM |
| mensal Asaas preservado | SIM |
| veterano / familiar | SIM |
| WA registration_approved + idempotência | SIM |
| Gabriel preservado / pronto p/ teste manual | SIM |
| olhinho senha | SIM |
| testes/build/lint | **PASS** — 202 testes; build OK; lint 0 errors (2 warnings pré-existentes) |
| migration necessária | SIM (pendente apply) |
| produção alterada | **NÃO** |
