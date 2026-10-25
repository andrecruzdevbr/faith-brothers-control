#!/usr/bin/env bash
# Backup lógico somente leitura de Production, criptografado com age.
# Destino padrão: Google Drive (rclone, escopo drive.file).
# Destino legado: S3-compatível (BACKUP_DEST=s3). Não imprime senhas nem PII.
set -euo pipefail
umask 077

PRODUCTION_REF="wojqjxtaqjasnfhbotxi"
STAGING_REF="apbksfaztfkxshxffpik"
EXPECTED_DB="postgres"
# Session Pooler copiado do painel/CLI de Production. aws-0 NÃO é seguro:
# o índice do cluster não se infere da região (docs Supabase).
DEFAULT_HOST="aws-1-us-west-2.pooler.supabase.com"
DEFAULT_PORT="5432"
DEFAULT_USER="postgres.${PRODUCTION_REF}"
POOLER_HOST_RE='^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$'
POOLER_USER_RE="^[A-Za-z_][A-Za-z0-9_]*\\.${PRODUCTION_REF}$"
DEFAULT_RETENTION_DAYS="14"
DEFAULT_DRIVE_FOLDER="FaithBrothers_Backups"

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
  if [[ "$CONNECT_ONLY" == "1" ]]; then
    require_secret BACKUP_DB_HOST
  else
    require_secret BACKUP_AGE_RECIPIENT
  fi

  if [[ -z "${BACKUP_DEST:-}" ]]; then
    BACKUP_DEST="drive"
  fi
  BACKUP_DB_HOST="${BACKUP_DB_HOST:-$DEFAULT_HOST}"
  BACKUP_DB_PORT="${BACKUP_DB_PORT:-$DEFAULT_PORT}"
  BACKUP_DB_USER="${BACKUP_DB_USER:-$DEFAULT_USER}"
  BACKUP_DB_NAME="${BACKUP_DB_NAME:-$EXPECTED_DB}"
  BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-$DEFAULT_RETENTION_DAYS}"
  BACKUP_OBJECT_PREFIX="${BACKUP_OBJECT_PREFIX:-faith-brothers-prod}"
  BACKUP_DRIVE_FOLDER="${BACKUP_DRIVE_FOLDER:-$DEFAULT_DRIVE_FOLDER}"
  BACKUP_S3_REGION="${BACKUP_S3_REGION:-auto}"
  BACKUP_S3_PROVIDER="${BACKUP_S3_PROVIDER:-Cloudflare}"

  [[ "$BACKUP_DB_NAME" == "$EXPECTED_DB" ]] || fail "database name recusado"
  [[ "$BACKUP_DB_PORT" =~ ^[0-9]+$ ]] || fail "BACKUP_DB_PORT invalido"
  [[ "$BACKUP_RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]] || fail "BACKUP_RETENTION_DAYS invalido"
  [[ "$BACKUP_DRIVE_FOLDER" == "FaithBrothers_Backups" ]] || fail "pasta Drive recusada"
  [[ "$BACKUP_DB_HOST" =~ $POOLER_HOST_RE ]] || fail "BACKUP_DB_HOST nao e Session Pooler"
  [[ "$BACKUP_DB_HOST" != "aws-0-us-west-2.pooler.supabase.com" ]] || fail "BACKUP_DB_HOST aws-0 recusado para este projeto"
  [[ ! "$BACKUP_DB_USER" =~ [[:space:]] ]] || fail "BACKUP_DB_USER contem espaco"
  [[ "$BACKUP_DB_USER" =~ $POOLER_USER_RE ]] || fail "BACKUP_DB_USER deve ser role.projectref"

  refuse_staging "$BACKUP_DB_HOST $BACKUP_DB_USER $BACKUP_OBJECT_PREFIX $BACKUP_DRIVE_FOLDER"
  require_production "$BACKUP_DB_USER"

  if [[ "$BACKUP_DB_HOST" == "aws-1-us-west-2.pooler.supabase.com" ]]; then
    POOLER_CLUSTER="aws-1"
  else
    POOLER_CLUSTER="other"
  fi

  if [[ "$CONNECT_ONLY" != "1" ]]; then
    printf '%s' "$BACKUP_AGE_RECIPIENT" | grep -q '^age1' || fail "BACKUP_AGE_RECIPIENT deve ser chave publica age1..."

    if [[ "$BACKUP_DEST" == "drive" ]]; then
      require_secret BACKUP_DRIVE_TOKEN
    elif [[ "$BACKUP_DEST" == "s3" ]]; then
      require_secret BACKUP_S3_ENDPOINT
      require_secret BACKUP_S3_BUCKET
      require_secret BACKUP_S3_ACCESS_KEY_ID
      require_secret BACKUP_S3_SECRET_ACCESS_KEY
      refuse_staging "$BACKUP_S3_ENDPOINT $BACKUP_S3_BUCKET"
      if printf '%s' "$BACKUP_S3_ENDPOINT $BACKUP_S3_BUCKET" | grep -qiE 'github\.com|githubusercontent\.com|ghcr\.io'; then
        fail "destino GitHub recusado"
      fi
    else
      fail "BACKUP_DEST recusado"
    fi

    command -v age >/dev/null || fail "age nao instalado"
    command -v rclone >/dev/null || fail "rclone nao instalado"
  fi

  command -v docker >/dev/null || fail "docker nao instalado"

  log "preflight_ok project=${PRODUCTION_REF} pooler_cluster=${POOLER_CLUSTER} host_secret=set encrypt=age dest=${BACKUP_DEST} retention_days=${BACKUP_RETENTION_DAYS}"
}

configure_rclone() {
  export RCLONE_CONFIG="${WORKDIR}/rclone.conf"
  : > "$RCLONE_CONFIG"

  if [[ "$BACKUP_DEST" == "drive" ]]; then
    export RCLONE_CONFIG_BACKUP_TYPE=drive
    export RCLONE_CONFIG_BACKUP_SCOPE=drive.file
    export RCLONE_CONFIG_BACKUP_TOKEN="$BACKUP_DRIVE_TOKEN"
    if [[ -n "${BACKUP_DRIVE_CLIENT_ID:-}" ]]; then
      export RCLONE_CONFIG_BACKUP_CLIENT_ID="$BACKUP_DRIVE_CLIENT_ID"
      export RCLONE_CONFIG_BACKUP_CLIENT_SECRET="${BACKUP_DRIVE_CLIENT_SECRET:-}"
    fi
    DEST="backup:${BACKUP_DRIVE_FOLDER}"
    return
  fi

  export RCLONE_CONFIG_BACKUP_TYPE=s3
  export RCLONE_CONFIG_BACKUP_PROVIDER="$BACKUP_S3_PROVIDER"
  export RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
  export RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
  export RCLONE_CONFIG_BACKUP_ENDPOINT="$BACKUP_S3_ENDPOINT"
  export RCLONE_CONFIG_BACKUP_REGION="$BACKUP_S3_REGION"
  export RCLONE_CONFIG_BACKUP_NO_CHECK_BUCKET=true
  DEST="backup:${BACKUP_S3_BUCKET}/${BACKUP_OBJECT_PREFIX}"
}

upload_encrypted() {
  local extra=()
  if [[ "$BACKUP_DEST" == "drive" ]]; then
    rclone mkdir "$DEST" --quiet
  else
    extra+=(--s3-no-check-bucket)
  fi

  rclone copyto "$ENC_PATH" "${DEST}/${OBJECT_NAME}" "${extra[@]}" --quiet
  rclone delete "$DEST" --min-age "${BACKUP_RETENTION_DAYS}d" --include "*.age" --quiet || true
}

CONNECT_ONLY=0
if [[ "${1:-}" == "--connect-only" ]]; then
  CONNECT_ONLY=1
elif [[ "${1:-}" == "--preflight" ]]; then
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

log "connect_start pooler_cluster=${POOLER_CLUSTER} port=${BACKUP_DB_PORT} db=${BACKUP_DB_NAME} sslmode=require read_only=true schema=public"

PSQL_OUT="$(docker run --rm \
  --user "$RUNNER_USER" \
  --entrypoint psql \
  --env-file "$PGENV" \
  postgres:17-alpine \
  --host="$BACKUP_DB_HOST" \
  --port="$BACKUP_DB_PORT" \
  --username="$BACKUP_DB_USER" \
  --dbname="$BACKUP_DB_NAME" \
  --no-password \
  --set=ON_ERROR_STOP=1 \
  --tuples-only \
  --no-align \
  -c "select current_user || ' ' || current_database() || ' ' || current_setting('transaction_read_only');")"

PSQL_OUT="$(printf '%s' "$PSQL_OUT" | tr -d '\r' | awk 'NF { print; exit }')"
log "connect_ok schema=public sslmode=require session=${PSQL_OUT}"

if [[ "$CONNECT_ONLY" == "1" ]]; then
  [[ "$POOLER_CLUSTER" == "aws-1" ]] || fail "BACKUP_DB_HOST nao aponta ao Session Pooler aws-1"
  log "connect_only_ok no_dump=true pooler_cluster=${POOLER_CLUSTER}"
  exit 0
fi

log "dump_start format=custom sslmode=require read_only=true schema=public"

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
  --schema=public \
  --format=custom \
  --file=/out/backup.dump

shred -u "$PGENV" 2>/dev/null || rm -f "$PGENV"

[[ -s "$DUMP_PATH" ]] || fail "dump vazio"
DUMP_BYTES="$(wc -c < "$DUMP_PATH" | tr -d ' ')"

age -r "$BACKUP_AGE_RECIPIENT" -o "$ENC_PATH" "$DUMP_PATH"
shred -u "$DUMP_PATH" 2>/dev/null || rm -f "$DUMP_PATH"

[[ -s "$ENC_PATH" ]] || fail "arquivo criptografado vazio"
[[ "$OBJECT_NAME" == *.age ]] || fail "objeto deve terminar em .age"
header="$(dd if="$ENC_PATH" bs=21 count=1 2>/dev/null || true)"
[[ "$header" == "age-encryption.org/v1" ]] || fail "saida nao e age v1"
ENC_BYTES="$(wc -c < "$ENC_PATH" | tr -d ' ')"

configure_rclone
log "upload_start dest=${BACKUP_DEST} object=${OBJECT_NAME} encrypted_bytes=${ENC_BYTES} dump_bytes=${DUMP_BYTES}"
upload_encrypted

log "backup_ok dest=${BACKUP_DEST} object=${OBJECT_NAME} encrypted_bytes=${ENC_BYTES} dump_bytes=${DUMP_BYTES} retention_days=${BACKUP_RETENTION_DAYS}"
