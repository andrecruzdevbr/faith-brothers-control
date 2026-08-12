# Ajuste Family V2 — responsável legal dos dependentes

**Status:** GO-LIVE concluído.  
**Produção alterada:** SIM (migration + edge `register-student` + frontend)  
**Go-live:** SIM — ver `GO_LIVE_FAMILY_RESPONSAVEL_LEGAL.md`

---

## Problema

No cadastro familiar, ao adicionar filhos/dependentes o formulário pedia novamente
“Nome do responsável legal”, embora o responsável principal já tivesse sido informado.

## Regra

O responsável principal (financeiro) do Family é automaticamente o responsável legal
dos dependentes menores daquele cadastro.

- Não solicitar o campo nos dependentes.
- Não repetir CPF / e-mail / dados financeiros.
- Backend deriva `students.guardian_name` do nome do holder (`_full_name`),
  ignorando valor digitado no cliente.

## Implementação

| Camada | Mudança |
|--------|---------|
| UI `FamilyRegistrationWizard` | Remove input; mostra informativo “Responsável legal: {holder}” |
| `family-wizard.ts` | Validação/payload usam `financialResponsibleName` |
| Edge `register-student` | Injeta `guardian_name = fullName` para menores |
| Migration aplicada | `20260813140000_family_dependent_guardian_from_holder.sql` força guardian no RPC |

## Segurança (backend)

- `family_groups` é criado dentro de `register_family_wizard_atomic` (`_family_id`).
- Dependentes recebem `pending_family_group_id = _family_id` — cliente não escolhe família de terceiros.
- `guardian_name` do cliente é ignorado no loop de membros; menores usam `_full_name_trimmed` do holder.
- Cobrança permanece no responsável principal (holder).

## Preservado

- Family V2 / cobrança no responsável / login WhatsApp
- Individual, new_student, veteran
- Registros Family existentes

## Testes finais

- `npm test` → 248 PASS  
- `npm run build` → OK  
- `npm run lint` → 0 errors (3 warnings pré-existentes)

## Checklist

| Item | Resultado |
|------|-----------|
| responsável uma vez | SIM |
| campo removido dos dependentes | SIM |
| CPF não repetido | SIM |
| e-mail continua removido | SIM |
| associação automática | SIM |
| backend valida | SIM (edge + RPC produção) |
| produção alterada | SIM |
