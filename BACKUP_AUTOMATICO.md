# Backup automático criptografado — Faith Brothers Control

**Estado:** destino Google Drive no código; dump **parcial** (`public` apenas); cron **não** autorizado.  
O job só executa em `workflow_dispatch`. Tag `v1.0.0` não é destino de dump.

## Escopo (parcial)

O `pg_dump` copia **somente o schema `public`**: tabelas, dados, sequences, funções e tipos desse schema.

**Não inclui** Supabase Auth (`auth.users` e demais objetos de `auth`), Storage, cron, vault nem outros schemas internos.

Um restore deste arquivo **não** recria logins. Não é backup completo do Faith Brothers Control.

Role de leitura: `fb_backup` (pooler session, usuário `fb_backup.wojqjxtaqjasnfhbotxi`). Sem `pg_read_all_data`.

## Fluxo

`pg_dump` Postgres 17 (SSL, sessão read-only, `--schema=public`) → `age` → rclone Drive (`FaithBrothers_Backups`, `drive.file`) → `shred` dos temporários.

Retenção: apaga `.age` com mais de 14 dias nessa pasta.

Secrets (GitHub Actions, nunca no Git): `BACKUP_DB_PASSWORD`, `BACKUP_DB_USER`, `BACKUP_AGE_RECIPIENT`, `BACKUP_DRIVE_TOKEN`.

S3/R2 permanece em `BACKUP_DEST=s3`.

## Restore isolado (nunca neste workflow)

```bash
age -d -i age-backup-private.txt backup.dump.age > backup.dump
pg_restore --no-owner --no-acl --dbname=... backup.dump
```

Restore em Production exige autorização explícita. Não automatizar.
