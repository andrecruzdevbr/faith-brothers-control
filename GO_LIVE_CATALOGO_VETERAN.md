# GO-LIVE — Catálogo oficial veteran

**Data:** 2026-08-11 (America/Sao_Paulo)  
**Escopo:** migration `20260812120000_official_veteran_monthly_catalog.sql` + frontend/lib de definição e exibição.

---

## Pré-check

- Dry-run: **somente** `20260812120000_official_veteran_monthly_catalog.sql`
- Migration não tocava `new_student` / `familia`
- Totais prepaid: 160×3=480 · 130×6=780 · 110×12=1320
- Mensal = `asaas_monthly` (boleto) · T/S/A = `machine_prepaid` (cartão/maquininha)

## Apply

```
npx supabase db push
```

Aplicada com sucesso.

## Validação pós-apply (produção)

### Veteran ativo (6 SKUs)

| Plano | Dias | Mensal | Total | Mode |
|-------|------|--------|-------|------|
| Mensal 2d | 2 | 130 | — | asaas_monthly |
| Mensal 3d | 3 | 150 | — | asaas_monthly |
| Mensal 5d | 5 | 180 | — | asaas_monthly |
| Trimestral | NULL | 160 | 480 | machine_prepaid |
| Semestral | NULL | 130 | 780 | machine_prepaid |
| Anual | NULL | 110 | 1320 | machine_prepaid |

- `totals_ok` = true nos 3 prepaid
- Fingerprint `new_student` **inalterado:** `9bc35fcc2d016cdb69cec3ef95546f2d`
- Planos `familia`: 0 (inalterado)

## Testes pós-apply

- `npm test` — PASS
- `npm run build` — OK
- `npm run lint` — 0 errors

## Deploy

- Commit: `feat: add official veteran plan catalog`
- Push: `origin/main`
- Vercel: aguardar HTTP 200

## Smoke (sem cobrança / sem WA real)

Validação estrutural no banco + código:

- ADM pode escolher Mensal / T / S / A após aprovação
- Mensal força boleto (`set_veteran_billing_period`)
- Prepaid fica `aguardando_conferencia` até confirmação ADM
- Meses só após `confirm_individual_prepaid_payment`
- **Não** gerou boleto real, **não** confirmou cartão, **não** enviou WhatsApp

## Restrições respeitadas

- Sem cobrança real
- Sem confirmação de pagamento real
- Sem WhatsApp real no smoke
- Sem editar migration antiga
- Sem apagar dados de alunos
