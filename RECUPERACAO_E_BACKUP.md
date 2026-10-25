# Recuperação e backup — Faith Brothers Control V1.0

Git e tag **não** substituem backup do banco.

## Manifesto de recuperação

| Item | Referência |
|------|------------|
| Repositório | https://github.com/andrecruzdevbr/faith-brothers-control |
| Branch | `main` |
| Tag | `v1.0.0` |
| Código de produto (PRs #1–#3) | `ddb3626694501413543265cb0d5e5b32166a8f6f` |
| App | https://faith-brothers-control.vercel.app |
| Vercel (SHA `ddb3626`) | success, 2026-10-25T01:22:00Z, deployment `5SBTF5Nc81R5eYkaqAWwXgoUQjZF` |
| Supabase Production | `wojqjxtaqjasnfhbotxi` (região `us-west-2`) |
| Supabase Staging | `apbksfaztfkxshxffpik` |
| Evolution | `https://faithbrothers-wa.chickenkiller.com` (2.3.7) |

Confirmar o SHA da tag após o merge desta documentação:

```text
git fetch origin --tags
git rev-parse v1.0.0
```

## Código versionado

Todo o código aprovado dos PRs #1, #2 e #3 está em `origin/main`. A tag anotada `v1.0.0` marca o fechamento documental dessa linha.

Branches remotas de entrega **preservadas** (não apagadas neste fechamento): `release/v1.0-whatsapp`, `fix/billing-cron-auth-check-no-charge`, `fix/whatsapp-queue-cron-offset`, além de `chore/*` e `infra/*` com histórico de HTTPS.

Há alterações locais não commitadas (scripts e markdowns de go-live). **Não** fazem parte de v1.0. Fonte da verdade: GitHub `main` + tag.

## Edge Functions a restaurar (se necessário)

Redeploy a partir do checkout da tag, projeto `wojqjxtaqjasnfhbotxi`, `--use-api`, sem `--prune`:

- `generate-monthly-billings` v92
- `send-billing-whatsapp` v87
- `process-whatsapp-queue` v88
- `send-whatsapp` v81
- `send-birthday-whatsapp` v27

As demais funções listadas em `ENTREGA_V1.0.md` não foram republicadas no release WhatsApp; restaurar só se o incidente for delas.

## Frontend

Rollback Vercel Production para o deployment do SHA desejado (`ddb3626` ou o commit da tag). Não precisa rebuild se o deployment ainda existir.

## Banco de dados — o que foi verificado

Comando oficial:

```text
supabase backups list --project-ref wojqjxtaqjasnfhbotxi
```

Resultado deste fechamento:

| Campo | Valor observado |
|-------|-----------------|
| `walg_enabled` | `true` (mecanismo de backup físico WAL-G presente) |
| `pitr_enabled` | `false` (PITR **não** disponível) |
| `backups` | `null` |
| `physical_backup_data` | objeto vazio |
| `region` | `us-west-2` |

Não foi gerado dump lógico. Não foram exportados dados de alunos. Não foi executado `backups restore`.

**Limitação:** não há snapshot listado com timestamp neste comando, e PITR está desligado. Não afirmar que existe um ponto de restauração recuperável até alguém com acesso ao Dashboard Supabase confirmar backups diários do plano e, se necessário, habilitar PITR (isso é mudança de configuração — fora deste fechamento).

Restauração PITR, se um dia for ligada:

```text
supabase backups restore --help
```

Exige timestamp, autorização e aceita interrupção de serviço. Não usar sem ordem explícita.

## Secrets e configuração (sem valores)

Não versionar valores. Conferir no Dashboard que existem, entre outros:

- `WHATSAPP_SEND_ENABLED`
- `WHATSAPP_ALLOWED_RECIPIENTS`
- `WHATSAPP_EVOLUTION_INSTANCE` / base URL / API key
- `BILLING_CRON_SECRET`
- `ASAAS_API_KEY` / webhook
- chaves Supabase de service role (somente no projeto, nunca no Git)

GitHub Actions: `SUPABASE_FUNCTIONS_BASE_URL` (Production) e `BILLING_CRON_SECRET`.

## Rollback operacional (sem destruir dados)

1. `WHATSAPP_SEND_ENABLED=false`
2. Disable Billing, Birthday e, se preciso, Queue
3. SPA: deployment Vercel anterior
4. Functions: deploy da tag
5. Não force-push, não `db reset`, não mexer em Caddy/Docker/VPS
