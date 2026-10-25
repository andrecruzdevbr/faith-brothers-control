# Operação Production — Faith Brothers Control V1.0

Projeto: `wojqjxtaqjasnfhbotxi`  
App: https://faith-brothers-control.vercel.app  
Este arquivo é o runbook. Não altera Production por existir.

## Estado que deve ser preservado

| Controle | Valor exigido agora |
|----------|---------------------|
| `WHATSAPP_SEND_ENABLED` | `true` |
| Allowlist | somente homologação (mascarado `5531*****4156`) |
| Billing cron | `disabled_manually` |
| Birthday cron | `disabled_manually` |
| WhatsApp Queue cron | `active` |
| Cron da fila na `main` | `2,7,12,17,22,27,32,37,42,47,52,57 * * * *` |

Não alterar esses estados sem autorização nova por escrito.

## O que a operação pode fazer

- Consultas somente leitura (PostgREST GET, `functions list`, health HTTP).
- Acompanhar runs do GitHub filtrando `event=schedule`.
- Publicar documentação e tags Git.
- Rollback de **envio**: secret SEND para `false` e/ou Disable nos workflows.

## O que a operação não faz

- Habilitar Billing ou Birthday.
- Remover ou ampliar a allowlist.
- Enviar WhatsApp de teste.
- Criar cobrança Asaas / chamar `generate-monthly-billings`.
- Aprovar alunos.
- Inserir mensagens na fila.
- Migrations, `db reset`, mudança de secret além do rollback de SEND.
- Docker, Caddy, firewall, DNS, VPS.
- `functions deploy --prune`.
- `workflow_dispatch` da fila (não existe no YAML e não deve ser adicionado para “provar” o cron).

## Health checks não destrutivos

```text
GET https://faith-brothers-control.vercel.app/          → 200
GET https://wojqjxtaqjasnfhbotxi.supabase.co/rest/v1/  → 401 sem chave (esperado)
GET https://apbksfaztfkxshxffpik.supabase.co/rest/v1/  → 401 (staging separado)
GET https://faithbrothers-wa.chickenkiller.com/        → 200, version 2.3.7
```

Fila: contar `whatsapp_messages` com status `pending`/`failed` e `attempts < 3`. Não processar.

## Fila WhatsApp

Workflow ativo. Agenda deslocada do minuto zero. Se não houver `event=schedule`, tratar como **pendência externa do GitHub**. Não mudar o cron de novo. Não criar segundo agendador. Não disparar na mão.

A Edge Function `process-whatsapp-queue` recusa envio fora da allowlist e não envia se a fila estiver vazia.

## Billing (desligado)

YAML na `main`: `auth_check` só imprime presença de secret e BASE_URL Production e sai 0. Não dá curl em generate.

Habilitar o workflow **arma** generate no dia 12 11:00 UTC e overdue no dia 19. Isso cria cobrança real. Não fazer.

## Birthday (desligado)

YAML recusa staging e exige Production. Função publicada: `send-birthday-whatsapp` v27. Habilitar dispara todo dia 11:00 UTC. Não fazer.

## Deploy de function (quando houver autorização futura)

```text
node supabase.js functions deploy <nome> --project-ref wojqjxtaqjasnfhbotxi --use-api --yes
```

Sem `--prune`. Conferir `functions list` depois. O CLI pode sair 1 por timeout PostHog depois de `"Deployed Functions."` — a prova é a listagem, não o exit code.

## Incidentes

1. Envio indesejado: `WHATSAPP_SEND_ENABLED=false`; Disable Queue/Billing/Birthday.
2. Cobrança indesejada: Disable Billing imediatamente; não chamar generate.
3. Function ruim: redeploy da tag `v1.0.0` / commit conhecido; não `--prune`.
4. SPA ruim: rollback do deployment Vercel para o SHA anterior estável.
