# GO-LIVE V1.0 — Faith Brothers Control

**Data (UTC):** 2026-10-25  
**Tag:** `v1.0.0` → `05e63fc57f1122467366a58ff0cf6e5945cc2a21` (não alterada)  
**Repositório:** https://github.com/andrecruzdevbr/faith-brothers-control  
**App:** https://faith-brothers-control.vercel.app  
**Production:** `wojqjxtaqjasnfhbotxi`  
**Staging:** `apbksfaztfkxshxffpik`

Classificação: **GO-LIVE TÉCNICO PARCIAL**. Fila automática comprovada. WhatsApp de alunos, Billing e Birthday preparados e **não ativados**. Backup de banco **não confirmado** com snapshot recuperável.

Nenhuma cobrança, nenhum WhatsApp a aluno, nenhum aluno alterado nesta operação.

---

## 1. WhatsApp Queue — RESOLVIDO

Não foi criado segundo agendador. Cron na `main`:

`2,7,12,17,22,27,32,37,42,47,52,57 * * * *`

Workflow **active**. GitHub passou a disparar `event=schedule` após o offset do cron e o re-enable (atraso de horas é típico do agendador).

| Run | Evento | Conclusão | Horário UTC | SHA | Resposta da function |
|-----|--------|-----------|-------------|-----|----------------------|
| [40170683244](https://github.com/andrecruzdevbr/faith-brothers-control/actions/runs/40170683244) | schedule | success | 2026-10-25T06:52:49Z | `05e63fc` | `{"success":true,"mode":"batch","processed":0}` |
| [40191735244](https://github.com/andrecruzdevbr/faith-brothers-control/actions/runs/40191735244) | schedule | success | 2026-10-25T12:07:20Z | `05e63fc` | `{"success":true,"mode":"batch","processed":0}` |

Os dois jobs chamaram Production `process-whatsapp-queue` (não staging). `processed:0` porque a fila não tem itens elegíveis. O GitHub continua podendo atrasar ou pular alguns intervalos de 5 minutos; isso não anula as execuções comprovadas.

## 2. WhatsApp dos alunos — AGUARDANDO AUTORIZAÇÃO

Validado sem envio:

- Evolution HTTPS 200, versão 2.3.7, instância `FaithBrothersAcademia` (digest).
- `WHATSAPP_SEND_ENABLED=true`.
- Allowlist: 1 número de homologação `5531*****4156`.
- Fila: total 5 (`sent`), pending/failed/processing **0**, elegíveis **0**. Nenhuma mensagem antiga seria enviada no próximo cron.
- Gate: SEND → allowlist → POST Evolution. Allowlist vazia bloqueia todos; **ausência** da secret libera todos.
- Fila: `attempts < 3` em `pending`/`failed`; OTP expirado não reenvia.

`connectionState` da instância não foi consultado (exigiria API key em claro). A prova operacional é o cron + Evolution 200 + canário histórico já enviado.

**Retirada controlada da allowlist (não executada):**

1. Autorização explícita.
2. Reconfirmar fila elegível = 0.
3. **Apagar** o secret `WHATSAPP_ALLOWED_RECIPIENTS` (não deixar vazio).
4. Manter SEND como estiver autorizado.
5. Observar o cron da fila.

## 3. Billing — PRONTO (desligado)

Não habilitado.

| Item | Evidência |
|------|-----------|
| Asaas | `ASAAS_BASE_URL` = live `https://api.asaas.com/v3` (digest). `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN` presentes. |
| Emissão | settings `boleto_issue_day=12` (default 12) |
| Vencimento | `boleto_due_day=15` |
| Lembrete | cron `0 11 19 * *` UTC → `send-billing-whatsapp` overdue |
| Generate | cron `0 11 12 * *` UTC |
| Idempotência | `billing:{id}:issued` / `billing:{id}:overdue_reminder` |
| `auth_check` | não chama Edge Function, não gera cobrança |
| Function | `generate-monthly-billings` v92, `send-billing-whatsapp` v87 |
| `send_whatsapp_automatically` | **true** (WA de boleto sairia se a allowlist permitir) |
| Competência agora | 2026-11-01 (após o dia 15 de outubro) |
| Alunos `ativo` | **0** |
| Cobranças existentes | **0** |
| Impacto se generate rodasse agora | **0** boletos Asaas |

Habilitar o workflow **arma** 12 e 19 de cada mês em Production real. Não fazer sem autorização. Um aluno `pendente_aprovacao` não entra na geração.

## 4. Birthday — PRONTO (desligado)

Não habilitado.

| Item | Evidência |
|------|-----------|
| Function | `send-birthday-whatsapp` v27 (2026-10-25T00:49:05Z) |
| Calendário | `todayInSaoPaulo` (America/Sao_Paulo) |
| Elegibilidade | só `status=ativo` |
| Idempotência | `birthday:{studentId}:{year}`; `sent`/`queued` não reenviam; `failed` (allowlist) pode retentar |
| Allowlist | bloqueio grava `failed` + `skipped_allowlist`, não queima o ano como entregue |
| Hoje (2026-10-25) | 0 aniversariantes |
| Amanhã | 0 |
| `birthday_messages` 2026 | 0 |

Habilitar dispara todo dia 11:00 UTC. Com allowlist atual, não-homologação falha e pode ser retentada. Não habilitar sem autorização.

## 5. Backup — NÃO CONFIRMADO

`supabase backups list --project-ref wojqjxtaqjasnfhbotxi`:

| Campo | Valor |
|-------|--------|
| `walg_enabled` | true |
| `pitr_enabled` | false |
| `backups` | null |
| `physical_backup_data` | vazio |
| região | us-west-2 |

Nenhum dump. Nenhum restore. Sem timestamp de snapshot. WAL-G ligado **não** basta para afirmar ponto recuperável.

**Autorização necessária:** no Dashboard Supabase Production, conferir Database → Backups; se o plano permitir, ligar PITR (custo/configuração). Depois disso, `supabase backups list` deve listar pontos. Não versionar dump de alunos.

## 6. Validação operacional

| Check | Resultado |
|-------|-----------|
| SPA | HTTP 200 |
| Tag `v1.0.0` | preservada em `05e63fc` |
| Supabase Production | REST 401 sem chave (up) |
| Staging | separado, 401 |
| Evolution | 200 / 2.3.7 |
| Functions v1.0 | publicadas (fila v88, birthday v27, generate v92) |
| Cobranças criadas nesta operação | 0 |
| Mensagens criadas nesta operação | 0 |
| Billing / Birthday workflows | `disabled_manually` |
| Queue | `active` + schedule comprovado |

Correções de código nesta rodada: **nenhuma**. Cron da fila já estava correto; o GitHub é que passou a honrar o `schedule`.

## Autorizações que faltam para ativação completa

1. **Apagar** `WHATSAPP_ALLOWED_RECIPIENTS` (ou substituir por lista real). Não deixar o valor vazio.
2. **Enable** Billing cron — gera boleto Asaas **live** no dia 12 e lembrete no dia 19; hoje o impacto seria 0 alunos ativos.
3. **Enable** Birthday cron — diário 11:00 UTC.
4. **Confirmar/habilitar backup recuperável** (Dashboard / PITR).

Não misturar 2 e 3 na mesma janela.

## Rollback

1. `WHATSAPP_SEND_ENABLED=false`
2. Disable Queue, Billing e Birthday
3. Recolocar allowlist de homologação se tiver sido removida
4. SPA: deployment Vercel da tag `v1.0.0`
5. Functions: redeploy da tag, `--use-api`, sem `--prune`
6. Sem force-push, sem `db reset`, sem mexer em VPS
