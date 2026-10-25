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

## Banco de dados — o que foi verificado (2026-10-25)

Projeto `faith-brothers-prod` / `wojqjxtaqjasnfhbotxi`: `ACTIVE_HEALTHY`, Postgres 17.6.1.127. O CLI **não informa o plano** (Free vs Pro).

```text
supabase backups list --project-ref wojqjxtaqjasnfhbotxi
```

| Campo | Valor |
|-------|--------|
| `walg_enabled` | `true` |
| `pitr_enabled` | `false` |
| `backups` | `null` |
| `physical_backup_data` | vazio |
| `region` | `us-west-2` |

**Backup recuperável (Supabase nativo): NÃO.** Sem `inserted_at`, sem PITR. `backups restore` só aceita `--timestamp` de PITR.

Há pipeline de backup criptografado (`BACKUP_AUTOMATICO.md`): cron **00:17 Brasília** (`17 3 * * *` UTC), `pg_dump` 17 do schema **`public` apenas** → `age` → Google Drive `FaithBrothers_Backups`, retenção 14 dias. **Parcial:** não inclui Auth. S3/R2 permanece em `BACKUP_DEST=s3`.

Último dump **manual validado:** `faith-brothers-prod-20261025T185214Z.dump.age` (run `40223268588`). Restore isolado em PostgreSQL 17.11 recuperou 23/23 tabelas; FKs de Auth não entram neste arquivo. Restore em Production **não** foi executado. **Não** é recuperação integral do Control.

### Recuperação, quando o plano permitir

- **Pro+ sem PITR:** Dashboard → Database → Backups → restore do snapshot diário (retenção 7/14/30 dias conforme plano). Downtime. Confirmar no Dashboard antes de declarar backup.
- **Com PITR (pago):** `supabase backups restore --project-ref wojqjxtaqjasnfhbotxi --timestamp <epoch>`. Projeto fica inacessível durante o restore.
- Git/tag **não** restauram o banco.

## Secrets e configuração (sem valores)

Não versionar valores. Conferir no Dashboard que existem, entre outros:

- `WHATSAPP_SEND_ENABLED`
- `WHATSAPP_ALLOWED_RECIPIENTS`
- `WHATSAPP_EVOLUTION_INSTANCE` / base URL / API key
- `BILLING_CRON_SECRET`
- `ASAAS_API_KEY` / webhook
- chaves Supabase de service role (somente no projeto, nunca no Git)

GitHub Actions (crons): `SUPABASE_FUNCTIONS_BASE_URL` (Production) e `BILLING_CRON_SECRET`.

Backup criptografado: `BACKUP_DB_PASSWORD`, `BACKUP_DB_USER`, `BACKUP_DB_HOST`, `BACKUP_AGE_RECIPIENT`, `BACKUP_DRIVE_TOKEN`. S3 legado: `BACKUP_S3_*`. Ver `BACKUP_AUTOMATICO.md`. Session Pooler: `aws-1-us-west-2.pooler.supabase.com:5432` (não `aws-0`). A chave privada age **não** é secret do GitHub; cópia em claro só local; envelope 7z em `FaithBrothers_KeyEnvelope`.

## Rollback operacional (sem destruir dados)

1. `WHATSAPP_SEND_ENABLED=false`
2. Disable Billing, Birthday e, se preciso, Queue
3. SPA: deployment Vercel anterior
4. Functions: deploy da tag
5. Não force-push, não `db reset`, não mexer em Caddy/Docker/VPS
