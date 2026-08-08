# GO LIVE — Turmas e Horários

**Data:** 2026-08-08 (BRT)  
**Projeto:** `wojqjxtaqjasnfhbotxi` (`faith-brothers-prod`)  
**Frontend:** `https://faith-brothers-control.vercel.app`  
**Commit:** `feat: add official class schedules`

---

## Checklist

| Item | Status |
|------|--------|
| Migration aplicada | **SIM** (`20260808120000_official_class_schedules.sql`) |
| 23 slots em produção | **SIM** |
| Quarta 19:45 NOGI | **SIM** |
| Quinta 10:00 NOGI | **SIM** |
| Seg/Sex 19:45 GI | **SIM** |
| Ter/Sex 10:00 GI | **SIM** |
| RLS (`classes_select` + `classes_admin`) | **SIM** |
| RPC pública `get_public_class_schedules` | **SIM** (23) |
| GitHub atualizado | *após push* |
| Vercel atualizado | *após deploy* |

---

## Pré-check

- Migration aditiva: `ADD COLUMN IF NOT EXISTS`, constraints condicionais, índice parcial único.
- Soft-desativa legado (`day_of_week IS NULL`); não apaga turmas legítimas.
- Seed idempotente via `notes = 'official_v1'`.
- Permissões: admin/academy_limited CRUD em `classes`; aluno SELECT academia; anon via RPC ativos.
- Sem alteração financeira / Asaas / WhatsApp / secrets.

## Backup

- Schema: `backup_classes_20260808.classes`
- Contagem pré-apply: **0** linhas em `public.classes` (tabela vazia antes do seed)

## Dry-run

```
Would push these migrations:
 • 20260808120000_official_class_schedules.sql
```

## Apply

`npx supabase db push --linked` — OK

### Pós-apply

| Métrica | N |
|---------|---|
| official_active | 23 |
| qua_1945_nogi | 1 |
| qui_1000_nogi | 1 |
| seg_1945_gi | 1 |
| sex_1945_gi | 1 |
| ter_1000_gi | 1 |
| sex_1000_gi | 1 |
| rpc_public_count | 23 |

## Testes

- `npm test` — 19 files / 177 tests PASS  
- `npm run build` — PASS  
- `npm run lint` — 0 errors (2 warnings pré-existentes)

## Superfície

| Superfície | Path |
|------------|------|
| ADM / ADM restrito | `/turmas` |
| Cadastro | `/cadastro` (Individual + Familiar) |
| Aluno | `/minhas-turmas` |

---

## Restrições respeitadas

Sem cobrança · Sem WhatsApp · Sem alteração de secrets · Sem editar migrations antigas · Sem apagar dados de produção.
