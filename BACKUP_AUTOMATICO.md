# Backup automático criptografado — Faith Brothers Control

**Estado:** código publicado; **job desativado** até os secrets existirem.  
**Não** usa GitHub Artifacts nem o repositório. Tag `v1.0.0` não é destino de dump.

## O que já está no Git

- Workflow: `.github/workflows/database-backup.yml` (`17 3 * * *` UTC + `workflow_dispatch`)
- Script: `scripts/backup-production-encrypted.sh`
- Produção fixa: `wojqjxtaqjasnfhbotxi`. Staging `apbksfaztfkxshxffpik` é recusado.
- Fluxo: `pg_dump` (Postgres 17, custom, SSL, somente leitura) → `age` → rclone S3 → apaga temporários (`shred`).
- Retenção: apaga objetos `.age` com mais de 14 dias no prefixo.

O GitHub deste repositório **não** tem destino de armazenamento nem senha do banco (secrets atuais: só `BILLING_CRON_SECRET` e `SUPABASE_FUNCTIONS_BASE_URL`). Por isso o workflow deve permanecer `disabled_manually` até a configuração abaixo.

## Configuração que falta (gratuita, fora do GitHub)

### 1. Chave age (fica fora do bucket)

Na máquina do operador, **uma vez**:

```bash
age-keygen -o age-backup-private.txt
```

- A linha `age1...` (pública) → GitHub secret `BACKUP_AGE_RECIPIENT`
- O arquivo privado → cofre/offline. **Não** sobe no bucket nem no Git.

### 2. Bucket S3-compatível gratuito

Cloudflare R2 (plano gratuito, sem egress para download razoável) ou Backblaze B2 com API S3.

Criar:

- bucket privado (ex.: `faith-brothers-db-backups`)
- access key **somente** desse bucket (não usar chave pública de API do app)

### 3. Senha do banco Production

Dashboard Supabase → Project Settings → Database → senha do role `postgres`.  
Colar só em GitHub secret `BACKUP_DB_PASSWORD`. Não commitar.

Pooler session (padrão do script):

- host `aws-0-us-west-2.pooler.supabase.com`
- user `postgres.wojqjxtaqjasnfhbotxi`
- port `5432`
- database `postgres`
- `sslmode=require`

### 4. GitHub Actions secrets

| Secret | Obrigatório |
|--------|-------------|
| `BACKUP_DB_PASSWORD` | sim |
| `BACKUP_AGE_RECIPIENT` | sim (`age1...`) |
| `BACKUP_S3_ENDPOINT` | sim (`https://<accountid>.r2.cloudflarestorage.com`) |
| `BACKUP_S3_BUCKET` | sim |
| `BACKUP_S3_ACCESS_KEY_ID` | sim |
| `BACKUP_S3_SECRET_ACCESS_KEY` | sim |
| `BACKUP_DB_HOST` / `PORT` / `USER` | não (há default Production) |
| `BACKUP_S3_PROVIDER` | não (default `Cloudflare`; `Other` para B2) |
| `BACKUP_RETENTION_DAYS` | não (default 14) |

Depois: **Enable** o workflow `Database encrypted backup` e um `workflow_dispatch` de prova. O log deve mostrar `backup_ok object=... encrypted_bytes=...` sem senha.

## Restore (manual, nunca neste workflow)

```bash
age -d -i age-backup-private.txt backup.dump.age > backup.dump
pg_restore --dbname=... --no-owner backup.dump
```

Restore em Production exige autorização explícita e downtime. Não automatizar.

## Falha segura

Sem qualquer secret obrigatório o script sai com `backup_error: secret ausente: NOME` **antes** do dump.
