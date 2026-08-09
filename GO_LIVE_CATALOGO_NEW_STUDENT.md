# GO-LIVE — Catálogo oficial NEW_STUDENT

Data: 2026-08-09  
Projeto: `wojqjxtaqjasnfhbotxi` / `faith-brothers-control`

## Pré-check

- Migration revisada: aditiva, `ON CONFLICT (academy_id, name) DO UPDATE`
- Não duplica mensais 2/3/5 (upsert pelos nomes existentes)
- Não cria preço veteran; seeds veteran → `active=false`
- Não altera audience `familia`
- Dry-run: inicialmente listou `09120000` + `09140000`
  - `09120000` estava supersedida e **fora do escopo** autorizado
  - Arquivada em `scripts/archive-20260809120000_veteran_plan_no_new_student_prices.sql`
  - Dry-run final: **somente** `20260809140000_official_new_student_catalog.sql`

## Apply

```text
npx supabase db push
→ Applying migration 20260809140000_official_new_student_catalog.sql... OK
```

### Validação pós-apply (produção)

| Modalidade | Dias | Valor | OK |
|------------|------|-------|----|
| Mensal | 1/2/3/5 | 180/210/230/250 | SIM |
| Trimestral | 1/2/3/5 | 480/540/630/690 | SIM |
| Semestral | 1/2/3/5 | 990/1155/1260/1350 | SIM |
| Anual | 1/2/3/5 | 1980/2310/2500/2750 | SIM |

- `new_student` ativos (kinds oficiais): **16**
- `veterano` ativos: **0**
- `veterano` inativos (seeds): **7**
- `veterano` com preços mensais new_student: **0**
- planos `familia`: **0** / não tocados

## Edge Functions publicadas

Somente as alteradas nesta feature:

- `register-student`
- `notify-registration-event`

(compartilham `_shared/whatsapp.ts` + `_shared/whatsapp-messages.ts`)

## Frontend / GitHub / Vercel

- Commit: `feat: add official new student plan catalog`
- Push: `main`
- Smoke /cadastro: HTTP 200; catálogo via RPC (sem cobrança / sem WA real)

## Restrições respeitadas

- Sem cobrança Asaas real
- Sem WhatsApp real
- Sem secrets
- Sem preço veteran inventado
- Sem editar migration antiga já aplicada
