# GO-LIVE — Responsável único no Plano Familiar

**Data:** 2026-08-11  
**Projeto Supabase:** `wojqjxtaqjasnfhbotxi`  
**Frontend:** `https://faith-brothers-control.vercel.app`  
**Branch:** `main`

---

## Pré-check

| Check | Resultado |
|-------|-----------|
| `20260813140000` só Local (antes do apply) | SIM |
| Dry-run só essa migration | SIM |
| Sem DELETE / wipe / alteração de preços | SIM |
| Individual / auth / cobrança holder preservados | SIM (revisão código) |

## Apply

```text
npx supabase db push --linked
→ 20260813140000_family_dependent_guardian_from_holder.sql
```

| Check | Resultado |
|-------|-----------|
| Migration aplicada | SIM |
| Local = Remote `20260813140000` | SIM |

## Validação RPC (produção)

Query em `register_family_wizard_atomic`:

| Regra | Resultado |
|-------|-----------|
| Ignora `guardian_name` do cliente nos dependentes | PASS |
| Menor: `_member_guardian := _full_name_trimmed` (holder) | PASS |
| Binding `pending_family_group_id = _family_id` interno | PASS |

## Edge Functions

| Function | Ação | Motivo |
|----------|------|--------|
| `register-student` | **PUBLICADA** ACTIVE **v65** | Diff: injeta guardian do holder para menores Family |
| Demais | NÃO redeployadas | Sem diff nesta entrega |

Deploy:

```text
npx supabase functions deploy register-student --project-ref wojqjxtaqjasnfhbotxi
→ Deployed Functions. project_ref=wojqjxtaqjasnfhbotxi
→ register-student ACTIVE version 65
```

WhatsApp real: **não enviado** neste go-live.

## Frontend

Alteração publicada via push `main` → Vercel:

- Sem “Responsável legal” nos dependentes
- Sem CPF/e-mail repetidos no dependente
- Única definição do responsável principal no wizard Family

## Testes finais (pré-commit)

| Comando | Resultado |
|---------|-----------|
| `npm test` | 248 PASS |
| `npm run build` | OK |
| `npm run lint` | 0 errors |

## Smoke (sem cadastro real)

Simulação UI (sem finalizar / sem cobrança / sem WA):

- André = responsável principal  
- Filho A / Filho B = dependentes de André (associação automática; sem redigitar nome)

## Fluxos preservados

Iniciante, Veterano, mensal Boleto/Cartão, T/S/A, aprovação, confirmação financeira,
login WhatsApp, recuperação de senha, financeiro Family — intactos nesta entrega
(sem alteração de catálogo/preços/auth).

## Commit

`fix: simplify family dependent registration`
