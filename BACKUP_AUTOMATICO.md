# Backup automático criptografado — Faith Brothers Control

**Estado:** cron diário **habilitado** (`public` + `auth`). Destino Google Drive. Tag `v1.0.0` não é destino de dump.

## Agenda

| Item | Valor |
|------|--------|
| Workflow | `Database encrypted backup` |
| Cron | `17 3 * * *` UTC |
| Brasília | **00:17** (`America/Sao_Paulo`, sem horário de verão) |
| Manual | `workflow_dispatch` com `mode=backup` (dump) ou `mode=connect` (só login) |
| Concorrência | grupo `database-encrypted-backup`, sem cancelar o job em curso |

Último backup **manual validado** (não apagar até haver outro sucesso e 14 dias):

- Run: https://github.com/andrecruzdevbr/faith-brothers-control/actions/runs/40398622032
- Arquivo: `faith-brothers-prod-20261026T204649Z.dump.age` (367 161 bytes)
- Validação final (2026-10-26): dump age v1 íntegro; restore isolado PostgreSQL 17.11 **aprovado** — 23/23 `public`, 27 `auth` (inclui `users`, `identities`, `sessions`, `refresh_tokens`), 9/9 FKs de `public` → `auth.users`. Restore em Production **não** executado.

## Escopo

O `pg_dump` copia os schemas **`public` e `auth`**. Não inclui `vault`, `cron` nem `storage`. `public` não tem sequences; `auth` inclui `refresh_tokens_id_seq`.

Role de leitura: `fb_backup` (Session Pooler, usuário `fb_backup.wojqjxtaqjasnfhbotxi`), membro de `pg_read_all_data` **com herança**, `BYPASSRLS` e `default_transaction_read_only=on`. O dump **não** usa `--role`.

Conexão: secret `BACKUP_DB_HOST` = Session Pooler `aws-1-us-west-2.pooler.supabase.com`, porta `5432`, database `postgres`, `sslmode=require`. `aws-0` é recusado.

## Fluxo

`pg_dump` Postgres 17 (SSL, sessão read-only, `--schema=public --schema=auth`) → `age` → rclone Drive (`FaithBrothers_Backups`, escopo `drive.file`) → `shred` dos temporários.

Falha em dump, criptografia ou upload **encerra o job**. A retenção só corre depois de um upload bem-sucedido.

## Retenção (14 dias)

Após um upload ok, apaga **somente** `faith-brothers-prod-*.dump.age` com mais de 14 dias **dentro de** `FaithBrothers_Backups` (`--max-depth 1`). Não apaga o objeto recém-enviado. Não toca em outras pastas (incluindo o envelope da chave).

Se o dump/upload falhar, a limpeza **não** executa — o último `.dump.age` válido permanece.

## Secrets (GitHub Actions, nunca no Git)

`BACKUP_DB_PASSWORD`, `BACKUP_DB_USER`, `BACKUP_DB_HOST`, `BACKUP_AGE_RECIPIENT`, `BACKUP_DRIVE_TOKEN`.

A chave **privada** age fica no arquivo local do operador. Segunda cópia: arquivo **7z AES-256** na pasta Drive `FaithBrothers_KeyEnvelope` (não é o dump; não está em `FaithBrothers_Backups`). A privada **não** é secret do GitHub.

S3/R2 permanece em `BACKUP_DEST=s3`.

## Monitoramento (gratuito)

Falhas aparecem no histórico do workflow (conclusion `failure`), sem PII nos logs.

Como conferir a última execução **bem-sucedida**:

1. https://github.com/andrecruzdevbr/faith-brothers-control/actions/workflows/database-backup.yml
2. Ou: `gh run list --workflow "Database encrypted backup" --limit 10`

E-mail automático de falha depende de **Settings → Notifications → Actions** na conta GitHub. Este repositório **não** configura Slack, PagerDuty nem add-on pago. Não afirmar que o e-mail está ligado sem conferir essa opção da conta.

## Restore isolado (nunca neste workflow)

```bash
age -d -i age-backup-private.txt backup.dump.age > backup.dump
pg_restore --list backup.dump
pg_restore --no-owner --no-acl --dbname=... backup.dump
```

Usar PostgreSQL 17 **fora** de Production. O destino isolado precisa das roles hospedadas (`anon`, `authenticated`, `service_role`, `supabase_auth_admin`) e das extensões `pgcrypto`, `citext`, `uuid-ossp`. Restore em Production exige autorização explícita. Não automatizar.
