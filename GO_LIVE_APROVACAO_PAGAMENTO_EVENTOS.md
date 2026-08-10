# GO-LIVE — registration_approved + payment_confirmed

**Data:** 2026-08-10  
**Projeto:** `wojqjxtaqjasnfhbotxi`  
**Escopo:** dois eventos WhatsApp independentes + UI do aluno

## Auditoria — edges alteradas

| Edge | Papel nesta feature | Mudou? | Ação |
|------|---------------------|--------|------|
| `notify-registration-event` | Aprovação cadastral → `registration_approved` | SIM | Já publicada ACTIVE **v4** |
| `notify-contract-approved` | Pagamento ADM → `payment_confirmation` / event `payment_confirmed` | SIM | Já publicada ACTIVE **v2** |
| `register-student` | Cadastro ADM (`admin_created`) também dispara só `registration_approved` | SIM | Já publicada ACTIVE **v64** |
| `process-whatsapp-queue` | Fila genérica | **NÃO** (sem diff nesta feature) | **Não republicar** |

Shared alterados (embutidos no deploy das edges acima):

- `_shared/whatsapp-messages.ts` (copy + chaves + assinatura)
- `_shared/whatsapp.ts` (`registration_approved` type)
- `_shared/registration-whatsapp.ts` (dispatch ADM)

Frontend (já em `main` / Vercel):

- `Alunos.tsx` → `approve_student` + `notify-registration-event`
- `PrepaidApprovalDialog.tsx` → RPC `confirm_*_prepaid_payment` + `notify-contract-approved`
- `StudentContractOverview.tsx` + `student-plan-situation.ts` (app pós-aprovação / pós-pagamento)

## Eventos (independentes)

| Evento | Trigger | message_type | Idempotency key | Libera meses? |
|--------|---------|--------------|-----------------|---------------|
| A | Aprovar cadastro / cadastro ADM | `registration_approved` | `registration:{studentId}:approved` | NÃO |
| B | Pagamento aprovado (RPC) | `payment_confirmation` | `contract_approved:{contractId}:payment_confirmed` | SIM |

A **não** compartilha chave com B e **não** marca pagamento pago.

Assinatura em ambos:

```
Faith Brothers, TMJ! 👊
Osss! 🥋🤼
```

## Pré-check desta sessão

- `npm test` → **228 PASS**
- `npm run build` → **OK**
- `npm run lint` → **0 errors** (3 warnings antigos)
- `process-whatsapp-queue`: sem alteração → **não redeploy**
- Edges necessárias: **já ACTIVE** (go-live anterior do Novo Aluno ADM nesta mesma branch)
- Código: **já em** `origin/main` (`566bd19` + docs)

## Produção (validação sem WA real / sem pagamento real)

- `/alunos` → HTTP **200**
- Assets: `index-D2yx1AzS.js`, `Alunos-CcgpCgWk.js`, `StudentContractOverview-Dd02rjtz.js`
- Bundle app contém: “Aguardando confirma…”, “Nenhum ainda”, “Meses liberados”, “Cadastro:”
- Pagamento **não** executado no smoke
- WhatsApp real **não** enviado no smoke

### Por código (pós Pagamento aprovado — não executado)

1. RPC `confirm_individual_prepaid_payment` / `confirm_family_prepaid_payment`
2. Em seguida `notify-contract-approved` com `send_immediately: true`
3. Edge usa `messageType: payment_confirmation` + key `…:payment_confirmed`
4. Meses só após RPC (coverage `pago`)

## Git

- Feature já versionada: `566bd19` (`feat: enable admin student registration`) — inclui os dois eventos
- Commit histórico relacionado: `43dbea5` (`feat: separate registration approval from payment confirmation`)
- Este relatório: commit docs nesta sessão
- `main` = `origin/main`

## Checklist

| Item | Resultado |
|------|-----------|
| notify-registration-event publicada | SIM (ACTIVE v4) |
| notify-contract-approved publicada | SIM (ACTIVE v2) |
| outras edges publicadas | `register-student` v64 (dependência ADM/approval path); `process-whatsapp-queue` **não** |
| registration_approved em produção | SIM |
| payment_confirmed em produção | SIM |
| eventos separados | SIM |
| app após aprovação | OK |
| meses antes do pagamento = 0 | SIM |
| idempotência | PASS |
| GitHub atualizado | SIM |
| Vercel atualizado | SIM |
| produção preservada | SIM |
| pode testar aprovação manual real | SIM |
