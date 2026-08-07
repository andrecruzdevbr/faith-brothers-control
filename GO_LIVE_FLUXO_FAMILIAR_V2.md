# GO LIVE — Fluxo Familiar V2

**Data:** 2026-08-07 (BRT)  
**Projeto:** `wojqjxtaqjasnfhbotxi` (`faith-brothers-prod`)  
**Frontend:** `https://faith-brothers-control.vercel.app`  
**Commit:** `feat: finalize family registration flow v2`

---

## Checklist de respostas

| Item | Status |
|------|--------|
| Migration aplicada | **SIM** |
| Edge publicada | **SIM** (`register-student`) |
| GitHub atualizado | **SIM** (`66e17ed` → `origin/main`) |
| Vercel atualizado | **SIM** (HTTP 200; bundle `index-REx5heb2.js`) |
| Fluxo individual preservado | **SIM** |
| Responsável não praticante tratado corretamente | **SIM** |
| Cada praticante conta como aluno | **SIM** |
| Fluxo familiar disponível em produção | **SIM** (`family_plans_enabled=true` + migration + edge + UI) |
| Pode testar primeiro cadastro familiar real | **SIM** (sem confirmar pagamento) |
| Pode confirmar primeiro pagamento familiar real | **NÃO ainda** — só após smoke controlado A/B e liberação explícita |

---

## 1. Pré-check

- Migration `20260808010000_family_wizard_v2.sql` revisada integralmente.
- Aditiva: `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `COMMENT ON`.
- Não edita migrations já aplicadas.
- Sem `DELETE`/`TRUNCATE` de dados de negócio.
- `DROP FUNCTION IF EXISTS` apenas da assinatura antiga de `register_family_wizard_atomic` (ainda inexistente no remote — NOTICE esperado).
- Compatível com alunos existentes, individual, prepaid individual, Asaas/mensalidade (não alterados).
- RPCs: `SECURITY DEFINER` + `SET search_path = public`.
- Grants: search/register wizard → `service_role` only.
- Idempotência de confirmação familiar: contrato ativo+pago existente retorna o mesmo id.

---

## 2. Backup

- Schema: `backup_family_v2_20260807`
- Script: `scripts/family-v2-backup-logical.sql` (sem dump PII versionado)

### Contagens pré-apply

| Métrica | N |
|---------|---|
| students | 3 |
| students_ativo | 3 |
| students_pendente | 0 |
| family_groups | 0 |
| family_members | 0 |
| student_contracts | 0 |
| contract_payments | 0 |
| student_contract_months | 0 |
| student_billing_profiles | 3 |
| billings | 1 |
| plans | 7 |

---

## 3. Dry-run

```
Would push these migrations:
 • 20260808010000_family_wizard_v2.sql
```

Somente esta migration.

---

## 4. Apply

- `npx supabase db push --linked` — OK
- Local/remote alinhados em `20260808010000`
- Colunas `family_members.notes` e `requested_weekly_frequency` presentes
- RPCs presentes: `register_family_wizard_atomic`, `search_academy_students_for_family`, `confirm_family_prepaid_payment`
- Contagens pós-apply idênticas (nenhuma família/aluno/contrato criado automaticamente)

---

## 5. Types / qualidade

- Types regenerados do projeto remoto
- `npm test` (family-wizard): 7/7 OK
- `npm run build`: OK
- `npm run lint`: 0 errors (2 warnings pré-existentes em `RecuperarSenha.tsx`)

---

## 6. Edge

- Publicada: `register-student` → `wojqjxtaqjasnfhbotxi`
- Cobre: `responsible_trains`, `belt`, `degrees`, members[], vínculo existente, individual intacto

---

## 7. Deploy frontend

- Push: `e25216f..66e17ed` → `main`
- `https://faith-brothers-control.vercel.app` → HTTP **200**
- `/cadastro` → HTTP **200**
- Asset live: `/assets/index-REx5heb2.js` (alinhado ao build local desta entrega)
- Feature flag: `family_plans_enabled = true`, `prepaid_contracts_enabled = true`

## 8. Smoke (sem pagamento real / sem WhatsApp real / sem confirmação admin)

Validação estrutural em produção:

- 3 alunos ativos preservados; 0 family_groups; 0 contratos pagos
- RPCs `SECURITY DEFINER` + `search_path=public` OK
- Colunas `notes` / `requested_weekly_frequency` OK
- Unit tests cenários A/B (helpers): OK
- **Não** executado cadastro real neste go-live (evita criar auth users e enfileirar WhatsApp)

**Cenários A/B de cadastro real** liberados para o primeiro teste controlado em produção **sem** clicar em “Pagamento aprovado e família liberada” até nova autorização.

| Cenário | Esperado |
|---------|----------|
| A — responsável NÃO treina + 2 filhos | 2 students pendentes; 1 family_group; responsável sem student |
| B — responsável TREINA + 2 filhos | 3 students pendentes; 1 family_group; dados esportivos próprios |

---

## Restrições respeitadas

- Sem cobrança Asaas gerada neste go-live
- Sem WhatsApp real disparado neste go-live
- Sem confirmação de pagamento familiar
- Sem apagar dados
- Sem alterar secrets
- Sem editar migration antiga
