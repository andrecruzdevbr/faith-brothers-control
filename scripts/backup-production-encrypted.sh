#!/usr/bin/env bash
# Backup lógico somente leitura de Production, criptografado com age, enviado
# para armazenamento S3-compatível. Não imprime senhas nem dados pessoais.
set -euo pipefail
umask 077

PRODUCTION_REF="wojqjxtaqjasnfhbotxi"
STAGING_REF="apbksfaztfkxshxffpik"
EXPECTED_DB="postgres"
DEFAULT_HOST="aws-0-us-west-2.pooler.supabase.com"
DEFAULT_PORT="5432"
DEFAULT_USER="postgres.${PRODUCTION_REF}"
DEFAULT_RETENTION_DAYS="14"

log() { printf '%s\n' "$*"; }
fail() { printf 'backup_error: %s\n' "$*" >&2; exit 1; }

require_secret() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    fail "secret ausente: ${name}"
  fi
}

refuse_staging() {
  local blob="$1"
  if printf '%s' "$blob" | grep -q "$STAGING_REF"; then
    fail "recusando staging ${STAGING_REF}"
  fi
}

require_production() {
  local blob="$1"
  if ! printf '%s' "$blob" | grep -q "$PRODUCTION_REF"; then
    fail "destino/host nao aponta a Production ${PRODUCTION_REF}"
  fi
}

preflight() {
  require_secret BACKUP_DB_PASSWORD
  require_secret BACKUP_AGE_RECIPIENT
  require_secret BACKUP_S3_ENDPOINT
  require_secret BACKUP_S3_BUCKET
  require_secret BACKUP_S3_ACCESS_KEY_ID
  require_secret BACKUP_S3_SECRET_ACCESS_KEY

  BACKUP_DB_HOST="${BACKUP_DB_HOST:-$DEFAULT_HOST}"
  BACKUP_DB_PORT="${BACKUP_DB_PORT:-$DEFAULT_PORT}"
  BACKUP_DB_USER="${BACKUP_DB_USER:-$DEFAULT_USER}"
  BACKUP_DB_NAME="${BACKUP_DB_NAME:-$EXPECTED_DB}"
  BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-$DEFAULT_RETENTION_DAYS}"
  BACKUP_S3_REGION="${BACKUP_S3_REGION:-auto}"
  BACKUP_S3_PROVIDER="${BACKUP_S3_PROVIDER:-Cloudflare}"
  BACKUP_OBJECT_PREFIX="${BACKUP_OBJECT_PREFIX:-faith-brothers-prod}"

  [[ "$BACKUP_DB_NAME" == "$EXPECTED_DB" ]] || fail "database name recusado"
  [[ "$BACKUP_DB_PORT" =~ ^[0-9]+$ ]] || fail "BACKUP_DB_PORT invalido"
  [[ "$BACKUP_RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]] || fail "BACKUP_RETENTION_DAYS invalido"

  refuse_staging "$BACKUP_DB_HOST $BACKUP_DB_USER $BACKUP_S3_ENDPOINT $BACKUP_S3_BUCKET $BACKUP_OBJECT_PREFIX"
  require_production "$BACKUP_DB_USER"

  if printf '%s' "$BACKUP_S3_ENDPOINT $BACKUP_S3_BUCKET" | grep -qiE 'github\.com|githubusercontent\.com|ghcr\.io'; then
    fail "destino GitHub recusado"
  fi

  printf '%s' "$BACKUP_AGE_RECIPIENT" | grep -q '^age1' || fail "BACKUP_AGE_RECIPIENT deve ser chave publica age1..."

  command -v age >/dev/null || fail "age nao instalado"
  command -v rclone >/dev/null || fail "rclone nao instalado"
  command -v docker >/dev/null || fail "docker nao instalado"

  log "preflight_ok project=${PRODUCTION_REF} host_ok=true encrypt=age dest=s3c retention_days=${BACKUP_RETENTION_DAYS}"
}

if [[ "${1:-}" == "--preflight" ]]; then
  preflight
  exit 0
fi

preflight

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/fb-db-backup.XXXXXX")"
cleanup() {
  if [[ -n "${WORKDIR:-}" && -d "$WORKDIR" ]]; then
    find "$WORKDIR" -type f -exec shred -u {} \; 2>/dev/null || true
    rm -rf "$WORKDIR"
  fi
}
trap cleanup EXIT

DUMP_PATH="${WORKDIR}/backup.dump"
ENC_PATH="${WORKDIR}/backup.dump.age"
PGENV="${WORKDIR}/pg.env"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OBJECT_NAME="${BACKUP_OBJECT_PREFIX}-${STAMP}.dump.age"
RUNNER_USER="$(id -u):$(id -g)"

umask 077
printf 'PGPASSWORD=%s\n' "$BACKUP_DB_PASSWORD" > "$PGENV"
printf 'PGSSLMODE=require\n' >> "$PGENV"
printf 'PGOPTIONS=-c default_transaction_read_only=on\n' >> "$PGENV"

log "dump_start format=custom sslmode=require read_only=true"

docker run --rm \
  --user "$RUNNER_USER" \
  --entrypoint pg_dump \
  --env-file "$PGENV" \
  -v "${WORKDIR}:/out" \
  postgres:17-alpine \
  --host="$BACKUP_DB_HOST" \
  --port="$BACKUP_DB_PORT" \
  --username="$BACKUP_DB_USER" \
  --dbname="$BACKUP_DB_NAME" \
  --no-password \
  --no-owner \
  --no-acl \
  --format=custom \
  --file=/out/backup.dump

shred -u "$PGENV" 2>/dev/null || rm -f "$PGENV"

[[ -s "$DUMP_PATH" ]] || fail "dump vazio"
DUMP_BYTES="$(wc -c < "$DUMP_PATH" | tr -d ' ')"

age -r "$BACKUP_AGE_RECIPIENT" -o "$ENC_PATH" "$DUMP_PATH"
shred -u "$DUMP_PATH" 2>/dev/null || rm -f "$DUMP_PATH"

[[ -s "$ENC_PATH" ]] || fail "arquivo criptografado vazio"
header="$(dd if="$ENC_PATH" bs=21 count=1 2>/dev/null || true)"
[[ "$header" == "age-encryption.org/v1" ]] || fail "saida nao e age v1"
ENC_BYTES="$(wc -c < "$ENC_PATH" | tr -d ' ')"

export RCLONE_CONFIG="${WORKDIR}/rclone.conf"
: > "$RCLONE_CONFIG"
export RCLONE_CONFIG_BACKUP_TYPE=s3
export RCLONE_CONFIG_BACKUP_PROVIDER="$BACKUP_S3_PROVIDER"
export RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
export RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_BACKUP_ENDPOINT="$BACKUP_S3_ENDPOINT"
export RCLONE_CONFIG_BACKUP_REGION="$BACKUP_S3_REGION"
export RCLONE_CONFIG_BACKUP_NO_CHECK_BUCKET=true

DEST="backup:${BACKUP_S3_BUCKET}/${BACKUP_OBJECT_PREFIX}"
log "upload_start object=${OBJECT_NAME} encrypted_bytes=${ENC_BYTES} dump_bytes=${DUMP_BYTES}"

rclone copyto "$ENC_PATH" "${DEST}/${OBJECT_NAME}" --s3-no-check-bucket --quiet
rclone delete "$DEST" --min-age "${BACKUP_RETENTION_DAYS}d" --include "*.age" --quiet || true

log "backup_ok object=${OBJECT_NAME} encrypted_bytes=${ENC_BYTES} dump_bytes=${DUMP_BYTES} retention_days=${BACKUP_RETENTION_DAYS}"
