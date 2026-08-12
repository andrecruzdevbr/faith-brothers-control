# GO-LIVE — Mensal boleto/cartão + Family sem e-mail

**Data:** 2026-08-11 (America/Sao_Paulo)  
**Migration:** `20260813120000_monthly_card_boleto_choice.sql`  
**Edge Functions publicadas:** NENHUMA (sem diff em `supabase/functions`)

---

## Pré-check

- `20260813120000` estava só em Local
- Dry-run: **somente** essa migration
- Aditiva: `CREATE OR REPLACE` em 2 RPCs; sem DML em plans/preços/dados

## Apply

```
npx supabase db push
```

Aplicada. Migration list: Local = Remote para `20260813120000`.

## Validação produção (RPC)

### `prepaid_cron_skip_reason`
- Skip `aguardando_conferencia` → `skipped_awaiting_machine_payment`
- Skip cartão/pix/dinheiro → `skipped_machine_payment_method`
- Preserva skips de cobertura prepaid/family

### `set_veteran_billing_period` (mensal)
- Aceita **boleto** → `ativo` + Asaas (`nao_aplicavel`)
- Aceita **cartao_credito** → `aguardando_conferencia` (sem ativar cobrança Asaas)
- T/S/A prepaid intactos

### Catálogo
- `new_student` ativos: 16
- `veterano` ativos: 6

## Frontend

- Mensal iniciante: só Boleto | Cartão
- Veterano mensal ADM: Boleto | Cartão
- Family: sem campo e-mail; auth WhatsApp → `{fone}@wa.faithbrothers.app`

## Testes finais

- `npm test` / `npm run build` / `npm run lint` — ver resultado na entrega

## Deploy

- Commit: `a1842d7` — `feat: add monthly payment choice and simplify family signup`
- Push: `origin/main` (`main = origin/main`)
- Vercel Production Ready (~2m, HTTP **200** em `/`, `/cadastro`, `/login`, `/alunos`)
- Bundle: mensal boleto+cartão **SIM**; cadastro sem label e-mail; alunos com refs Boleto

## Smoke (sem efeito financeiro)

- Sem boleto real / cobrança Asaas / confirmação cartão / WhatsApp
- UI: Boleto|Cartão no mensal; Family sem `email@exemplo.com`
- RPC produção: cartão → skip Asaas + `aguardando_conferencia`

## Checklist

| Item | Resultado |
|------|-----------|
| migration aplicada | SIM |
| Local = Remote | SIM |
| Edge Functions | NENHUMA |
| cartão sem Asaas | PASS |
| Family sem e-mail | SIM |
| produção preservada (sem wipe) | SIM |
| pode testar manualmente | SIM |
