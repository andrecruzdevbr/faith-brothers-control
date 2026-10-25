# Backup automático criptografado — Faith Brothers Control

**Estado:** código publicado; **job desativado** até autenticação Drive, chave age recuperável e senha do banco existirem.  
**Não** usa GitHub Artifacts nem o repositório. Tag `v1.0.0` não é destino de dump.

## O que já está no Git

- Workflow: `.github/workflows/database-backup.yml` (`17 3 * * *` UTC + `workflow_dispatch`)
- Script: `scripts/backup-production-encrypted.sh`
- Produção fixa: `wojqjxtaqjasnfhbotxi`. Staging `apbksfaztfkxshxffpik` é recusado.
- Fluxo: `pg_dump` (Postgres 17, custom, SSL, somente leitura) → `age` → rclone → apaga temporários (`shred`).
- Destino padrão: Google Drive, pasta `FaithBrothers_Backups`, escopo `drive.file` (só arquivos deste app).
- Destino legado S3/R2: `BACKUP_DEST=s3` + secrets `BACKUP_S3_*` (código preservado).
- Retenção: apaga objetos `.age` com mais de 14 dias no prefixo/pasta.

## Destino atual: Google Drive (conta gratuita)

Sem cartão. Cota típica 15 GB compartilhada com Gmail/Fotos.

Secrets:

| Secret | Obrigatório |
|--------|-------------|
| `BACKUP_DB_PASSWORD` | sim |
| `BACKUP_AGE_RECIPIENT` | sim (`age1...`) |
| `BACKUP_DRIVE_TOKEN` | sim (JSON OAuth rclone; nunca no Git) |
| `BACKUP_DEST` | não (vazio = `drive`) |
| `BACKUP_S3_*` | só se `BACKUP_DEST=s3` |

A chave **privada** age fica no cofre/offline do proprietário. **Não** vai para o Drive nem para o GitHub.

## Restore (manual, nunca neste workflow)

```bash
age -d -i age-backup-private.txt backup.dump.age > backup.dump
pg_restore --dbname=... --no-owner backup.dump
```

Restore em Production exige autorização explícita e downtime. Não automatizar.

## Falha segura

Sem secret obrigatório o script sai com `backup_error: secret ausente: NOME` **antes** do dump.
