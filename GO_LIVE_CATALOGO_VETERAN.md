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

- Commit: `cc052fc` — `feat: add official veteran plan catalog`
- Push: `origin/main` (`93253f2..cc052fc`)
- Vercel Production: Ready (~17s) — HTTP **200**
- Bundle validado: `Total contratado`, `formatVeteranPrepaid`, `Cobertura`, frequência 2/3/5

## Smoke (sem cobrança / sem WA real)

Validação estrutural no banco + frontend live:

- 6 planos veteran ativos (3 mensal + 3 prepaid)
- RPCs `set_veteran_billing_period` e `confirm_individual_prepaid_payment` presentes
- Mensal = `asaas_monthly` (boleto); T/S/A = `machine_prepaid` + `aguardando_conferencia` até ADM
- Frontend live exibe total contratado / cobertura
- **Não** gerou boleto real, **não** confirmou cartão, **não** enviou WhatsApp

## Checklist final

| Item | Resultado |
|------|-----------|
| migration aplicada | SIM |
| mensal 2/3/5 boleto | SIM |
| T/S/A totais 480/780/1320 | SIM |
| frequência independente | SIM |
| new_student fingerprint | inalterado |
| GitHub / Vercel | SIM |
| pode testar veterano real | SIM |