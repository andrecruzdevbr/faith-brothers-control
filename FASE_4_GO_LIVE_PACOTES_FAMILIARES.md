# FASE 4 — GO-LIVE Pacotes antecipados + Plano familiar

**Projeto:** Faith Brothers Control  
**Data:** 2026-08-07  
**Ambiente:** produção `wojqjxtaqjasnfhbotxi` + Vercel `faith-brothers-control.vercel.app`  
**Status:** migrations aplicadas · flags ativadas na academia Faith Brothers · **sem** confirmação de pagamento real · **sem** WhatsApp real · **sem** cobrança Asaas

---

## 1. Commit de checkpoint

| Item | Valor |
|------|--------|
| Checkpoint | `826635e` — `feat: add prepaid and family contract flows` |
| Pós-apply | `9c649e8` — `feat: regenerate types and deploy prepaid contract WhatsApp notify path` |
| Push | `eee618b..9c649e8` → `origin/main` |

**Commitados no checkpoint:** migrations prepaid/family, UI Cadastro/Alunos/Perfil/Financeiro, helpers/testes, `register-student`, cron skip, plano.

**Deixados de fora:** `.env`/secrets, `GO_LIVE_*.md`/`AUDITORIA_*.md`, scripts `go-live-cleanup-EXECUTE` e `wa-*`, `whatsapp-pair/`, edições de migrations já aplicadas.

---

## 2. Backup criado

- Schema: `backup_prepaid_20260807`
- Script: `scripts/backup-prepaid-20260807.sql`
- Contagens pré-apply: students **3**, billings **1**, plans **3**, profiles **14**, academy_billing_settings **1**, student_billing_profiles **3**
- Backup bateu com live (`bk_students=3`, `bk_billings=1`, `bk_plans=3`)

---

## 3. Migrations aplicadas

| Migration | Conteúdo |
|-----------|----------|
| `20260807010000_prepaid_contracts_and_family.sql` | flags, plans, family_*, contracts_*, months, payments, RLS, helpers |
| `20260807010001_prepaid_contract_rpcs.sql` | confirm/cancel/expire RPCs |
| `20260807020000_prepaid_phase3_registration.sql` | cadastro público + approve guard |
| `20260807030000_whatsapp_idempotency_key.sql` | `whatsapp_messages.idempotency_key` |

Migrations antigas **não** editadas. Somente aditivas.

---

## 4. Tabelas e RPCs validadas

Tabelas: `family_groups`, `family_members`, `student_contracts`, `contract_members`, `student_contract_months`, `contract_payments`.

RPCs: `confirm_individual_prepaid_payment`, `confirm_family_prepaid_payment`, `cancel_or_refund_prepaid_contract`, `prepaid_cron_skip_reason`, `complete_student_registration_atomic` (estendida), `get_public_active_plans` / `get_public_academies` com flags.

Planos seed: 3 mensais Asaas + 3 semestrais veterano + 1 avulso. Contagens alunos/billings preservadas pós-apply.

---

## 5. RLS validada

Políticas admin-all + select por academia/membro presentes nas 6 tabelas novas. Confirmação de pagamento só via RPC `is_admin_only`.

---

## 6. Edge Functions publicadas

| Function | Motivo |
|----------|--------|
| `register-student` | intent prepaid/familiar |
| `generate-monthly-billings` | skip cobertura / non-asaas |
| `notify-contract-approved` | fila WA idempotente `contract_approved:{contract_id}:payment_confirmed` (**send_immediately=false** no UI) |
| `process-whatsapp-queue` | alinhamento shared whatsapp |

---

## 7. Types regenerados

`src/integrations/supabase/types.ts` regenerado via `supabase gen types --linked` (PostHog trailer removido). Casts `as never` removidos nos componentes principais.

---

## 8. Testes finais

- Checkpoint: 139 testes (Fase 3)
- Pós-types: prepaid + plans **33 passed**; `npm run build` OK; lint **0 errors** (2 warnings pré-existentes)

---

## 9. Deploy Vercel

- Push `main` concluído
- `https://faith-brothers-control.vercel.app/` → **HTTP 200**

---

## 10. Flags ativadas

Somente academia **Faith Brothers BJJ** (`767b774a-2806-4a18-8d58-a0c95e359bc0`):

- `prepaid_contracts_enabled = true`
- `family_plans_enabled = true`

Não há outras academias no banco.

---

## 11. Smoke test

Executado de forma **controlada** (sem confirmar pagamento real):

| Check | Resultado |
|-------|-----------|
| Backup vs live counts | OK (3/3 alunos, 1/1 billing) |
| Flags Faith Brothers | true/true |
| Grupo familiar smoke `SMOKE001` | criado pendente e removido |
| Helpers cobertura 6 meses | disponíveis no banco |
| Cron skip sem cobertura | path implementado (sem gerar Asaas) |
| Confirmação pagamento real | **NÃO executada** (aguardando autorização) |
| WhatsApp real | **NÃO enviado** (notify enfileira com `send_immediately=false`) |
| Cadastro UI prepaid/familiar | código em produção (flags on) |

---

## 12. Riscos restantes

- Primeiro pagamento real ainda não exercitado end-to-end
- WhatsApp `contract_approved` ainda não foi processado com Evolution real
- CLI Supabase ocasionalmente falha por PostHog/timeout de conexão
- Catálogo público agora inclui pacotes (flags on) — monitorar cadastros

---

## 13. Rollback

1. Flags → `false` (desliga UI/planos machine no cadastro público)
2. Contratos ativos → `cancel_or_refund_prepaid_contract` se necessário
3. Restaurar snapshot `backup_prepaid_20260807.*` se corrupção de dados
4. Reverter Edge Functions para commit anterior se regressão
5. **Não** dropar colunas/tabelas em produção sem plano explícito

---

## 14. Conclusão objetiva

| Pergunta | Resposta |
|----------|----------|
| Produção preservada | **SIM** |
| Fluxo mensal antigo funcionando | **SIM** |
| Prepaid pronto | **SIM** (flags on; falta 1º pagamento autorizado) |
| Plano familiar pronto | **SIM** (flags on; falta 1º pagamento autorizado) |
| Pode confirmar o primeiro pagamento real | **NÃO** — aguardando autorização explícita |

---

## Próximo passo sugerido

Autorizar **um** smoke de confirmação admin em aluno/teste controlado, com `WHATSAPP_SEND_ENABLED` revisado e sem geração de boleto Asaas.
