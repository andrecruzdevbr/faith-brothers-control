# GO-LIVE — Catálogo oficial do Plano Familiar

**Data:** 2026-08-11  
**Projeto Supabase:** `wojqjxtaqjasnfhbotxi`  
**Frontend:** `https://faith-brothers-control.vercel.app`  
**Branch:** `main`

---

## Pré-check

| Check | Resultado |
|-------|-----------|
| `20260814120000` só Local (antes do apply) | SIM |
| Dry-run só essa migration | SIM |
| Matriz 12 preços conferida na migration | SIM |
| Sem alteração new_student / veterano | SIM |
| Sem DELETE destrutivo / wipe | SIM |

## Apply

```text
npx supabase db push --linked
→ 20260814120000_official_family_catalog.sql
```

| Check | Resultado |
|-------|-----------|
| Migration aplicada | SIM |
| Local = Remote `20260814120000` | SIM |

## Validação no banco (produção)

| Audience | Ativos | Soma preços (ref.) |
|----------|-------:|--------------------|
| familia | **12** | 6220 |
| new_student | **16** | 17505 |
| veterano | **6** | 3040 |

Matriz familiar confirmada:

| Modelo | 1d | 2d | 3d | 5d |
|--------|---:|---:|---:|---:|
| Familiar 1 | 320 | 380 | 420 | 450 |
| Familiar 2 | 420 | 510 | 570 | 630 |
| Familiar 3 | 480 | 600 | 680 | 760 |

RPC `register_family_wizard_atomic`:

| Regra | Resultado |
|-------|-----------|
| exige `audience=familia` | PASS |
| `_member_count <> _covered` | PASS |
| retorna `package_total_amount` | PASS |

## Edge Functions

| Function | Ação |
|----------|------|
| `register-student` | **PUBLICADA** ACTIVE **v66** |
| Demais | NÃO redeployadas |

WhatsApp real: **não enviado**.

## Frontend

Push `main` → Vercel:

- Modelo 1/2/3 → frequência 1/2/3/5 → resumo + preço do banco
- “Alterar plano”

## Testes finais

| Comando | Resultado |
|---------|-----------|
| `npm test` | 268 PASS |
| `npm run build` | OK |
| `npm run lint` | 0 errors |

## Commit

`feat: add official family plan catalog`
