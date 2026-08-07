# Fluxo Familiar V2 — Faith Brothers

## Resumo

O responsável financeiro cria **toda a família em um único wizard**. Integrantes **não precisam ter conta prévia** e **não informam CPF**. O CPF de cobrança fica só no responsável / `family_groups`.

O fluxo **Individual** permanece inalterado.

## Fluxo de cadastro

1. **Escolha do plano** — Individual | Familiar (`Cadastro.tsx`)
2. **Responsável financeiro** — nome, WhatsApp, nascimento, email, CPF cobrança, academia, plano, dias de treino, forma de pagamento, parcelas (cartão), senha
3. **Integrantes** — cartão do responsável + lista; botões *Adicionar Integrante* e *Vincular aluno já existente*
4. **Resumo** — família, CPF mascarado, pagamento, parcelas, lista, valor total / por integrante → **Enviar Cadastro**

UI: `src/components/family/FamilyRegistrationWizard.tsx`  
Helpers: `src/lib/family-wizard.ts`

## Backend

| Peça | Papel |
|------|--------|
| Migration `20260808010000_family_wizard_v2.sql` | `notes` + `requested_weekly_frequency` em `family_members`; RPC `register_family_wizard_atomic`; busca `search_academy_students_for_family`; confirm familiar usa frequência do integrante |
| Edge `register-student` | `family_mode=wizard` + `members[]`; `action=search_students` |
| `confirm_family_prepaid_payment` | Continua: **1** `student_contracts` + **1** `contract_payments` + meses para todos |

### Modelo de cobrança

Campos de billing (documentados; colunas existentes):

- `financial_responsible_name` → billing_name
- `financial_responsible_tax_id` → billing_tax_id
- `financial_responsible_phone` → billing_phone
- `financial_responsible_email` → billing_email

Integrantes só referenciam `family_group_id` via `family_members` / `students.pending_family_group_id`. **Sem CPF nos integrantes.**

Integrantes novos podem ser criados **sem** `profile_user_id` (sem login até vínculo futuro). WhatsApp opcional (string vazia permitida pelo índice único parcial).

## Admin

`PrepaidApprovalDialog` mostra Família, Responsável, CPF cobrança, Integrantes, Plano, Parcelas, Valor e botão **Confirmar pagamento**.

## Perfil do integrante

`StudentContractOverview`: Plano Familiar, nome do responsável, CPF mascarado, meses pagos, período. Sem edição do responsável.

## Compatibilidade

Mantidos: prepaid individual, mensal Asaas, WhatsApp (fila), cron skip de meses cobertos, `student_contracts` / `student_contract_months` / `contract_payments`, modo legado create/join na RPC antiga (UI V2 usa só wizard).

## Validação local

- `npm test` — OK
- `npm run build` — OK
- `npm run lint` — OK

## Não feito nesta entrega (conforme pedido)

- Sem gerar cobrança Asaas no cadastro
- Sem envio WhatsApp imediato de confirmação de pagamento
- Sem push/deploy antes da sua aprovação
- Migration criada localmente — aplicar em produção só após aprovação
