#!/usr/bin/env bash
# Faith Brothers — Etapa 2 corrigida: SERVER_URL HTTPS (somente evolution-api).
# Sucesso = printenv SERVER_URL no container + HTTPS 200 + versão 2.3.7 + instância open.
# O campo manager HTTP é esperado (req.protocol/Host) e NÃO provoca rollback.
# Não fecha 8080. Não toca Postgres/Redis/Caddy. Não envia WhatsApp. Não executa Etapa 3.

set -euo pipefail

DOMAIN="faithbrothers-wa.chickenkiller.com"
TARGET_URL="https://${DOMAIN}"
CURRENT_URL="http://2.24.108.128:8080"
BACKEND="127.0.0.1:8080"
EVOLUTION_DIR="/opt/evolution-faithbrothers"
COMPOSE_FILE="${EVOLUTION_DIR}/docker-compose.yml"
ENV_FILE="${EVOLUTION_DIR}/.env"
CADDYFILE="/etc/caddy/Caddyfile"
BACKUP_DIR="/root/fb-https-backup-20261024215052"
SERVICE="evolution-api"
CONTAINER="evolution_faithbrothers_api"
INSTANCE="FaithBrothersAcademia"
WAIT_SECS=180

ok() { printf '[OK]    %s\n' "$*"; }
info() { printf '[INFO]  %s\n' "$*"; }
warn() { printf '[WARN]  %s\n' "$*"; }
err() { printf '[ERROR] %s\n' "$*"; }

if [[ "$(id -u)" -ne 0 ]]; then
  err "Execute como root."
  exit 1
fi

compose() {
  docker compose -f "${COMPOSE_FILE}" --project-directory "${EVOLUTION_DIR}" "$@"
}

up_args=(up -d --no-deps --force-recreate --pull never)
config_args=(--quiet)
EXPECTED_VERSION="2.3.7"

read_env_url() {
  python3 - "$1" <<'PY'
import re, sys
path = sys.argv[1]
text = open(path, encoding="utf-8", errors="ignore").read()
hits = []
for line in text.splitlines():
    m = re.match(r"^\s*SERVER_URL\s*=\s*(.*)$", line)
    if not m:
        continue
    raw = m.group(1).strip().strip("'").strip('"')
    hits.append(raw)
if len(hits) != 1:
    print("COUNT=%d" % len(hits))
    sys.exit(2)
print(hits[0])
PY
}

set_env_url() {
  python3 - "$1" "$2" "$3" <<'PY'
import os, re, sys
path, expected, target = sys.argv[1], sys.argv[2], sys.argv[3]
raw = open(path, "rb").read()
nl = b"\r\n" if b"\r\n" in raw else b"\n"
text = raw.decode("utf-8")
lines = text.splitlines()
idxs = [i for i, line in enumerate(lines) if re.match(r"^\s*SERVER_URL\s*=", line)]
if len(idxs) != 1:
    sys.stderr.write("SERVER_URL_LINE_COUNT=%d\n" % len(idxs))
    sys.exit(2)
line = lines[idxs[0]]
m = re.match(r"^(\s*SERVER_URL\s*=\s*)([\"']?)([^\"']*)([\"']?)\s*$", line)
if not m:
    sys.stderr.write("SERVER_URL_PARSE_FAIL\n")
    sys.exit(3)
prefix, q1, val, q2 = m.group(1), m.group(2), m.group(3), m.group(4)
if val not in (expected, target):
    sys.stderr.write("SERVER_URL_UNEXPECTED\n")
    sys.exit(4)
if val == target:
    print("UNCHANGED")
    sys.exit(0)
quote = q1 if q1 and q1 == q2 else ""
lines[idxs[0]] = "%s%s%s%s" % (prefix, quote, target, quote)
out = ("\n".join(lines) + ("\n" if text.endswith("\n") else "")).encode("utf-8")
if nl == b"\r\n":
    out = out.replace(b"\n", b"\r\n")
tmp = path + ".stage2.tmp"
fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
try:
    os.write(fd, out)
finally:
    os.close(fd)
os.chmod(tmp, os.stat(path).st_mode)
try:
    os.chown(tmp, os.stat(path).st_uid, os.stat(path).st_gid)
except Exception:
    pass
os.replace(tmp, path)
print("UPDATED")
PY
}

http_welcome() {
  python3 - "$1" <<'PY'
import json, sys, urllib.request, ssl
url = sys.argv[1]
ctx = ssl.create_default_context()
try:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=12, context=ctx) as resp:
        body = resp.read(4000).decode("utf-8", "ignore")
        status = resp.status
        server = resp.headers.get("Server") or ""
except Exception as e:
    print("HTTP=0")
    print("ERROR=%s" % e.__class__.__name__)
    sys.exit(0)
print("HTTP=%s" % status)
if server:
    print("SERVER=%s" % server)
try:
    data = json.loads(body)
except Exception:
    print("JSON=no")
    sys.exit(0)
print("JSON=yes")
print("VERSION=%s" % (data.get("version") or ""))
mgr = str(data.get("manager") or "")
print("MANAGER=%s" % mgr)
print("MANAGER_HTTPS=%s" % ("yes" if mgr.startswith("https://") else "no"))
print("MANAGER_HTTP_EXPECTED=%s" % ("yes" if mgr.startswith("http://") else "no"))
PY
}

container_server_url() {
  docker exec "${CONTAINER}" printenv SERVER_URL 2>/dev/null || true
}

instance_state() {
  python3 - "$ENV_FILE" "$BACKEND" "$INSTANCE" <<'PY'
import json, re, sys, urllib.request
env_path, backend, instance = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(env_path, encoding="utf-8", errors="ignore").read()
key = None
source = None
for name in ("AUTHENTICATION_API_KEY", "EVOLUTION_API_KEY", "API_KEY", "WHATSAPP_EVOLUTION_API_KEY"):
    m = re.search(r"(?m)^\s*" + re.escape(name) + r"\s*=\s*(.*)$", text)
    if not m:
        continue
    raw = m.group(1).strip().strip("'").strip('"')
    if raw:
        key, source = raw, name
        break
if not key:
    print("INSTANCE_STATE=unavailable_no_key")
    print("INSTANCE_CONNECTED=no")
    sys.exit(0)
print("API_KEY_SOURCE=%s" % source)
req = urllib.request.Request(
    "http://%s/instance/connectionState/%s" % (backend, instance),
    headers={"apikey": key, "Accept": "application/json"},
)
key = None
try:
    with urllib.request.urlopen(req, timeout=12) as resp:
        body = resp.read(4000).decode("utf-8", "ignore")
        status = resp.status
except Exception as e:
    print("INSTANCE_HTTP=0")
    print("INSTANCE_STATE=error")
    print("INSTANCE_CONNECTED=no")
    sys.exit(0)
print("INSTANCE_HTTP=%s" % status)
state = "unavailable"
if status == 200:
    try:
        data = json.loads(body)
        inst = data.get("instance") if isinstance(data, dict) else {}
        if not isinstance(inst, dict):
            inst = {}
        state = str(inst.get("state") or data.get("state") or "unknown")
    except Exception:
        state = "unparseable"
print("INSTANCE_NAME=%s" % instance)
print("INSTANCE_STATE=%s" % state)
print("INSTANCE_CONNECTED=%s" % ("yes" if state.lower() == "open" else "no"))
PY
}

port_bind() {
  python3 - "$CONTAINER" <<'PY'
import json, subprocess, sys
name = sys.argv[1]
p = subprocess.run(["docker", "inspect", name], capture_output=True, text=True)
if p.returncode != 0:
    print("PORT_8080_BIND=inspect_failed")
    sys.exit(0)
data = json.loads(p.stdout)[0]
ports = (data.get("NetworkSettings") or {}).get("Ports") or {}
found = []
for key, confs in ports.items():
    if not str(key).startswith("8080"):
        continue
    if not confs:
        found.append("%s->(unpublished)" % key)
        continue
    for conf in confs:
        hip = conf.get("HostIp") or "0.0.0.0"
        hp = conf.get("HostPort") or ""
        found.append("%s:%s->%s" % (hip, hp, key))
print("DOCKER_PUBLISH_8080=%s" % (";".join(found) if found else "none"))
joined = ";".join(found)
if "127.0.0.1:8080" in joined and "0.0.0.0:8080" not in joined:
    print("PORT_8080_BIND=loopback_only")
elif "0.0.0.0:8080" in joined:
    print("PORT_8080_BIND=public_0.0.0.0")
else:
    print("PORT_8080_BIND=see_DOCKER_PUBLISH_8080")
PY
}

other_ids_file="$(mktemp)"
trap 'rm -f "${other_ids_file}" "${ENV_FILE}.stage2.tmp"' EXIT

snapshot_others() {
  docker ps --format '{{.ID}} {{.Names}}' | awk -v skip="${CONTAINER}" '$2 != skip { print $1, $2 }' | sort > "${other_ids_file}"
}

assert_others_unchanged() {
  local now
  now="$(mktemp)"
  docker ps --format '{{.ID}} {{.Names}}' | awk -v skip="${CONTAINER}" '$2 != skip { print $1, $2 }' | sort > "${now}"
  if ! cmp -s "${other_ids_file}" "${now}"; then
    rm -f "${now}"
    err "Outros containers mudaram (Postgres/Redis nao deveriam ter sido recriados)."
    echo "BEFORE:"
    cat "${other_ids_file}"
    echo "AFTER:"
    docker ps --format '{{.ID}} {{.Names}}'
    return 1
  fi
  rm -f "${now}"
  ok "Postgres/Redis/outros containers inalterados"
  return 0
}

wait_local_api() {
  local i
  for i in $(seq 1 $((WAIT_SECS / 5))); do
    if curl -fsS --max-time 5 "http://${BACKEND}/" 2>/dev/null | grep -qE 'Welcome to the Evolution API|"status"[[:space:]]*:[[:space:]]*200'; then
      ok "API local saudavel em http://${BACKEND}"
      return 0
    fi
    sleep 5
  done
  err "API local nao ficou saudavel em ${WAIT_SECS}s"
  return 1
}

rollback_recreate() {
  warn "ROLLBACK: restaurando .env do backup e recriando ${SERVICE}"
  cp -a "${BACKUP_DIR}/.env" "${ENV_FILE}"
  chmod --reference="${BACKUP_DIR}/.env" "${ENV_FILE}" 2>/dev/null || chmod 600 "${ENV_FILE}"
  compose "${up_args[@]}" "${SERVICE}"
  wait_local_api || true
  echo "=== ROLLBACK_INSTANCE ==="
  instance_state || true
  echo "=== ROLLBACK_LOCAL ==="
  http_welcome "http://${BACKEND}/" || true
  echo "ROLLBACK_DONE=yes"
}

echo "=== STAGE2_BEGIN ==="
echo "SERVICE=${SERVICE}"
echo "CONTAINER=${CONTAINER}"
echo "TARGET_URL=${TARGET_URL}"
echo "BACKUP_DIR=${BACKUP_DIR}"

# --- Preflight ---
if [[ ! -d "${BACKUP_DIR}" || ! -f "${BACKUP_DIR}/.env" || ! -f "${BACKUP_DIR}/docker-compose.yml" ]]; then
  err "Backup da Etapa 1 ausente ou incompleto: ${BACKUP_DIR}"
  exit 1
fi
ok "Backup Etapa 1 presente"

if [[ ! -f "${COMPOSE_FILE}" || ! -f "${ENV_FILE}" ]]; then
  err "Compose ou .env ausente em ${EVOLUTION_DIR}"
  exit 1
fi

backup_url="$(read_env_url "${BACKUP_DIR}/.env" || true)"
if [[ "${backup_url}" != "${CURRENT_URL}" ]]; then
  err "SERVER_URL do backup nao e o rollback esperado"
  echo "BACKUP_SERVER_URL_KIND=unexpected"
  exit 1
fi
ok "Backup SERVER_URL=${CURRENT_URL}"

current_url="$(read_env_url "${ENV_FILE}" || true)"
echo "ENV_SERVER_URL=${current_url}"
if [[ "${current_url}" != "${CURRENT_URL}" && "${current_url}" != "${TARGET_URL}" ]]; then
  err "SERVER_URL atual nao corresponde ao auditado nem ao alvo"
  exit 1
fi

if ! grep -q "reverse_proxy ${BACKEND}" "${CADDYFILE}"; then
  err "Caddyfile nao encaminha para ${BACKEND}"
  exit 1
fi
ok "Caddyfile reverse_proxy ${BACKEND}"

caddy_active="$(systemctl is-active caddy 2>/dev/null || true)"
echo "CADDY_ACTIVE=${caddy_active}"
if [[ "${caddy_active}" != "active" ]]; then
  err "Caddy nao esta active"
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "${CONTAINER}"; then
  err "Container ${CONTAINER} nao esta em execucao"
  docker ps --format '{{.Names}}'
  exit 1
fi
ok "Container ${CONTAINER} em execucao"

svc_now="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "${CONTAINER}" 2>/dev/null || true)"
if [[ "${svc_now}" != "${SERVICE}" ]]; then
  err "Servico Compose inesperado: ${svc_now:-unknown} (esperado ${SERVICE})"
  exit 1
fi
ok "Compose service=${SERVICE}"

echo "=== PRE_INSTANCE ==="
pre_inst="$(instance_state)"
printf '%s\n' "${pre_inst}"
if ! printf '%s' "${pre_inst}" | grep -q 'INSTANCE_CONNECTED=yes'; then
  err "Instancia nao esta open; abortando sem alterar"
  exit 1
fi
ok "Instancia ${INSTANCE} open antes da mudanca"

echo "=== PRE_PORT ==="
port_bind

snapshot_others
ok "Snapshot de containers auxiliares gravado"

echo "=== PRE_CONTAINER_SERVER_URL ==="
pre_container_url="$(container_server_url)"
echo "CONTAINER_SERVER_URL=${pre_container_url}"

# Idempotente: .env e container ja no alvo, HTTPS 200, versao e instancia ok.
# manager HTTP nao impede o skip.
if [[ "${current_url}" == "${TARGET_URL}" && "${pre_container_url}" == "${TARGET_URL}" ]]; then
  https_now="$(http_welcome "https://${DOMAIN}/" || true)"
  printf '%s\n' "${https_now}"
  if printf '%s' "${https_now}" | grep -q 'HTTP=200' \
    && printf '%s' "${https_now}" | grep -q "VERSION=${EXPECTED_VERSION}" \
    && printf '%s' "${pre_inst}" | grep -q 'INSTANCE_CONNECTED=yes'; then
    ok "SERVER_URL ja injetado no container. Sem recreate."
    echo "MANAGER_HTTP_EXPECTED=yes"
    echo "RECREATED=no"
    echo "ETAPA3=not_executed"
    echo "PORT_8080_CLOSED=no"
    echo "WHATSAPP_SENT=no"
    echo "=== STAGE2_END ==="
    exit 0
  fi
  warn "Alvo no .env, mas HTTPS/versao/instancia nao confirmados. Recriando API."
fi

# --- Validate compose without printing secrets ---
info "Validando Compose (--quiet, sem dump de secrets)"
compose_help="$(compose config --help 2>/dev/null || true)"
up_help="$(compose up --help 2>/dev/null || true)"
if printf '%s' "${compose_help}" | grep -q -- '--no-interpolate'; then
  config_args+=(--no-interpolate)
fi
if ! printf '%s' "${up_help}" | grep -q -- '--pull'; then
  err "docker compose up nao oferece --pull never; abortando sem alterar"
  exit 1
fi
compose config "${config_args[@]}"
ok "Compose valido (sem dump de secrets)"

# --- Mutate .env ---
info "Alterando somente SERVER_URL"
set_rc=0
set_out="$(set_env_url "${ENV_FILE}" "${CURRENT_URL}" "${TARGET_URL}")" || set_rc=$?
if [[ "${set_rc}" -ne 0 ]]; then
  err "Falha ao alterar SERVER_URL (rc=${set_rc})"
  exit 1
fi
echo "ENV_WRITE=${set_out}"
new_url="$(read_env_url "${ENV_FILE}")"
echo "ENV_SERVER_URL_AFTER=${new_url}"
if [[ "${new_url}" != "${TARGET_URL}" ]]; then
  err "SERVER_URL nao ficou no alvo; restaurando .env"
  cp -a "${BACKUP_DIR}/.env" "${ENV_FILE}"
  exit 1
fi
ok "SERVER_URL atualizado"

# --- Recreate only evolution-api ---
info "Recriando somente ${SERVICE} (${up_args[*]} ${SERVICE})"
set +e
compose "${up_args[@]}" "${SERVICE}"
up_rc=$?
set -e
if [[ "${up_rc}" -ne 0 ]]; then
  err "docker compose up falhou (rc=${up_rc})"
  rollback_recreate
  exit 1
fi
ok "up solicitado para ${SERVICE}"

if ! wait_local_api; then
  rollback_recreate
  exit 1
fi

if ! assert_others_unchanged; then
  rollback_recreate
  exit 1
fi

echo "=== POST_CONTAINER_SERVER_URL ==="
post_container_url="$(container_server_url)"
echo "CONTAINER_SERVER_URL=${post_container_url}"
if [[ "${post_container_url}" != "${TARGET_URL}" ]]; then
  err "Container nao recebeu SERVER_URL alvo (printenv divergente)"
  rollback_recreate
  exit 1
fi
ok "printenv SERVER_URL=${TARGET_URL}"

echo "=== POST_LOCAL ==="
http_welcome "http://${BACKEND}/"
echo "=== POST_HTTPS ==="
https_out="$(http_welcome "https://${DOMAIN}/" || true)"
printf '%s\n' "${https_out}"
if ! printf '%s' "${https_out}" | grep -q 'HTTP=200'; then
  err "HTTPS nao retornou 200"
  rollback_recreate
  exit 1
fi
if ! printf '%s' "${https_out}" | grep -q "VERSION=${EXPECTED_VERSION}"; then
  err "Versao Evolution inesperada (esperado ${EXPECTED_VERSION})"
  rollback_recreate
  exit 1
fi
ok "HTTPS 200 e versao ${EXPECTED_VERSION}"
if printf '%s' "${https_out}" | grep -q 'MANAGER_HTTPS=yes'; then
  info "manager anunciou HTTPS (inesperado, mas aceito)"
else
  info "manager HTTP e esperado (req.protocol/Host); sem rollback"
fi
echo "MANAGER_HTTP_EXPECTED=yes"

echo "=== POST_INSTANCE ==="
# A sessao pode levar alguns segundos para voltar a open
inst_ok=no
for i in 1 2 3 4 5 6; do
  inst_out="$(instance_state || true)"
  printf '%s\n' "${inst_out}"
  if printf '%s' "${inst_out}" | grep -q 'INSTANCE_CONNECTED=yes'; then
    inst_ok=yes
    break
  fi
  sleep 5
done
if [[ "${inst_ok}" != "yes" ]]; then
  err "Instancia nao voltou para open"
  rollback_recreate
  exit 1
fi
ok "Instancia ${INSTANCE} open"

echo "=== POST_PORT ==="
post_port="$(port_bind)"
printf '%s\n' "${post_port}"
if ! printf '%s' "${post_port}" | grep -q 'PORT_8080_BIND=public_0.0.0.0'; then
  err "Porta 8080 deixou de estar publicada publicamente"
  rollback_recreate
  exit 1
fi
echo "PORT_8080_CLOSED=no"

echo "=== GUARDS ==="
echo "RECREATED=${SERVICE}"
echo "POSTGRES_RESTARTED=no"
echo "REDIS_RESTARTED=no"
echo "VOLUMES_DELETED=no"
echo "WHATSAPP_SENT=no"
echo "CADDY_MODIFIED=no"
echo "ETAPA3=not_executed"
echo "ROLLBACK_EXECUTED=no"
echo "MANAGER_HTTP_EXPECTED=yes"
echo "=== STAGE2_END ==="
echo
echo "=== RESULTADO ==="
echo "CONTAINER_SERVER_URL=${TARGET_URL}"
echo "SERVICE=${SERVICE}"
echo "HTTPS_HTTP=200"
echo "VERSION=${EXPECTED_VERSION}"
echo "INSTANCE_OPEN=yes"
echo "PORT_8080_PRESERVED=yes"
echo "MANAGER_FIELD=http_expected"
