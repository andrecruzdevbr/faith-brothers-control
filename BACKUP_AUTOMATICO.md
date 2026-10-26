# Backup automático criptografado — Faith Brothers Control

**Estado:** cron diário **habilitado** (schema `public` apenas). Destino Google Drive. Tag `v1.0.0` não é destino de dump.

## Agenda

| Item | Valor |
|------|--------|
| Workflow | `Database encrypted backup` |
| Cron | `17 3 * * *` UTC |
| Brasília | **00:17** (`America/Sao_Paulo`, sem horário de verão) |
| Manual | `workflow_dispatch` com `mode=backup` (dump) ou `mode=connect` (só login) |
| Concorrência | grupo `database-encrypted-backup`, sem cancelar o job em curso |

Último backup **manual validado** (não apagar até haver outro sucesso e 14 dias):

- Run: https://github.com/andrecruzdevbr/faith-brothers-control/actions/runs/40223268588
- Arquivo: `faith-brothers-prod-20261025T185214Z.dump.age` (260 412 bytes)
- Restore isolado: PostgreSQL 17.11, 23/23 tabelas, dados ok; FKs/`authenticated` do Auth ausentes

## Escopo (parcial)

O `pg_dump` copia **somente o schema `public`**: tabelas, dados, funções, tipos e índices desse schema. Este dump **não** contém sequences (`SEQUENCE`/`IDENTITY`).

**Não inclui** Supabase Auth (`auth.users` e demais objetos de `auth`), Storage, cron, vault nem outros schemas internos.

Um restore **não** recria logins nem as 9 FKs de `public` para `auth.users`. **Não** é backup completo do Faith Brothers Control.

Role de leitura: `fb_backup` (Session Pooler, usuário `fb_backup.wojqjxtaqjasnfhbotxi`). Sem `pg_read_all_data`.

## Auth — bloqueio da plataforma (pendente)

Objetos indispensáveis para recuperar identidades: `auth.users` (PKs usadas por `public.profiles` e FKs), `auth.identities`, e, se quiser sessões, `auth.sessions` / `auth.refresh_tokens`. MFA e SSO ficam nas demais tabelas de `auth`.

Conferido em Production (somente leitura): `fb_backup` tem `SELECT` em `auth.users` e **não** tem `USAGE` no schema `auth`. Sem `USAGE` o `pg_dump --schema=auth` não entra nas tabelas.

`GRANT USAGE ON SCHEMA auth TO fb_backup`, executado como `postgres`, **não altera nada** no projeto hospedado (`WARNING: no privileges were granted for "auth"`). O schema pertence a `supabase_admin`; `postgres` não tem `GRANT OPTION`. Docs: [Permission errors when granting custom roles access to the auth schema](https://supabase.com/kb/troubleshooting/permission-errors-when-granting-custom-roles-access-to-the-auth-schema).

`supabase db dump --linked --schema auth` não substitui o workflow: o padrão é `--schema-only` (sem linhas de `auth.users`) e a conexão CLI usa o host direto IPv6, inadequado para o runner IPv4 do GitHub Actions.

**Única ação recomendada (exige autorização explícita em Production):**

```sql
GRANT pg_read_all_data TO fb_backup;
```

É o padrão oficial de role de backup. A role já é `LOGIN`, `BYPASSRLS` e `default_transaction_read_only=on`. Depois disso o dump pode incluir `--schema=auth`. Efeito colateral documentado: `USAGE` também em `cron` e outros schemas. Não conceder `supabase_auth_admin` nem redefinir a senha `postgres`.

Até essa autorização, o cron diário de `public` permanece como está.

Conexão: secret `BACKUP_DB_HOST` = Session Pooler `aws-1-us-west-2.pooler.supabase.com`, porta `5432`, database `postgres`, `sslmode=require`. `aws-0` é recusado.

## Fluxo

`pg_dump` Postgres 17 (SSL, sessão read-only, `--schema=public`) → `age` → rclone Drive (`FaithBrothers_Backups`, escopo `drive.file`) → `shred` dos temporários.

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

Usar PostgreSQL 17 **fora** de Production. Restore em Production exige autorização explícita. Não automatizar.
