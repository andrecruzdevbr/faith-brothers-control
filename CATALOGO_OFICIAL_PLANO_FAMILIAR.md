# Catálogo oficial — Plano Familiar

**Status:** GO-LIVE concluído  
**Produção alterada:** SIM (migration + edge `register-student` + frontend)  
**Go-live:** SIM — ver `GO_LIVE_CATALOGO_PLANO_FAMILIAR.md`

---

## Auditoria do catálogo antigo

Antes desta entrega **não existiam** planos com `audience = 'familia'`.

O wizard familiar listava o catálogo público geral (`get_public_active_plans` sem `_audience`),
reutilizando planos **new_student** (mensal/T/S/A) — preços e nomes incorretos para o
produto Familiar.

| Item | Estado pré-go-live |
|------|--------------------|
| planos `audience=familia` | 0 |
| contratos usando planos familia | 0 |
| alunos com plan_id familia | 0 |
| o que o wizard mostrava | new_student (+ outros públicos se flag) |

New Student (16) e Veterano (6) **permanecem intactos** pós-apply.

---

## Contagem de praticantes (semântica)

`praticantes = (responsável treina ? 1 : 0) + integrantes`

| Conceito | Significado |
|----------|-------------|
| Plano Familiar N | cobre exatamente **N praticantes** |
| responsável não treina | não entra na contagem; só CPF/WhatsApp/login |
| `family_groups.estimated_member_count` | snapshot dos praticantes no cadastro |
| `family_members` | responsável (se treina) + integrantes |
| `contract_members` | cobertura do **único** contrato prepaid familiar |
| preço | `package_total_amount` do plano — **nunca × N** |

Exemplos:

- Familiar 1 + responsável treina → 0 integrantes extras
- Familiar 2 + responsável treina → 1 integrante
- Familiar 3 + responsável **não** treina → 3 integrantes

---

## Matriz oficial (12 combinações) — produção

| Modelo | 1 dia | 2 dias | 3 dias | 5 dias |
|--------|------:|-------:|-------:|-------:|
| Plano Familiar 1 | 320 | 380 | 420 | 450 |
| Plano Familiar 2 | 420 | 510 | 570 | 630 |
| Plano Familiar 3 | 480 | 600 | 680 | 760 |

SKU / nome:

`Plano Familiar {1|2|3} — {N} dia(s) por semana`  
`category = familia_{1|2|3}` · `audience = familia` · `billing_mode = machine_prepaid`  
`plan_kind = mensal` · `duration_months = 1` · `monthly_price = package_total_amount`

Pagamento (preservado): cartão crédito/débito, pix, dinheiro → aguarda ADM
(`confirm_family_prepaid_payment`). Nunca auto-pago.

---

## UX (duas etapas)

1. Escolher **Plano Familiar 1 / 2 / 3**
2. Escolher **1 / 2 / 3 / 5 dias**
3. Resumo com preço **vindo do banco** + “Alterar plano”

Preços **não** são hardcoded no React (`OFFICIAL_FAMILY_CATALOG` só para testes).

---

## Implementação

| Artefato | Conteúdo |
|----------|----------|
| Migration | `20260814120000_official_family_catalog.sql` (**aplicada**) |
| Helpers | `src/lib/plans.ts` |
| Contagem | `src/lib/family-wizard.ts` |
| UI | `FamilyRegistrationWizard` |
| Edge | `register-student` ACTIVE **v66** |
| RPC | `register_family_wizard_atomic` (covered count + audience) |
| Testes | `src/test/official-family-catalog.test.ts` |

---

## Preservado

- responsável único / CPF só no holder / sem e-mail nos dependentes
- 1 family_group · 1 contrato · 1 pagamento · N alunos
- New Student · Veterano · turmas · auth · aprovação cadastral

---

## Testes finais

- `npm test` → **268 PASS**
- `npm run build` → **OK**
- `npm run lint` → **0 errors** (3 warnings pré-existentes)
