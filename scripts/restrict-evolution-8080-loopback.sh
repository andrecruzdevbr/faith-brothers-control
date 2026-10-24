#!/usr/bin/env bash
# Faith Brothers — Etapa 3: publicar 8080 só em 127.0.0.1 (evolution-api).
# Não altera .env, Caddy, firewall, Postgres, Redis nem volumes.
# manager HTTP é esperado e NÃO provoca rollback.

set -euo pipefail

DOMAIN="faithbrothers-wa.chickenkiller.com"
TARGET_URL="https://${DOMAIN}"
BACKEND="127.0.0.1:8080"
EVOLUTION_DIR="/opt/evolution-faithbrothers"
COMPOSE_FILE="${EVOLUTION_DIR}/docker-compose.yml"
ENV_FILE="${EVOLUTION_DIR}/.env"
CADDYFILE="/etc/caddy/Caddyfile"
STAGE1_BACKUP="/root/fb-https-backup-20261024215052"
SERVICE="evolution-api"
CONTAINER="evolution_faithbrothers_api"
INSTANCE="FaithBrothersAcademia"
WAIT_SECS=180
EXPECTED_VERSION="2.3.7"
TARGET_PORT_MAP="127.0.0.1:8080:8080"

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
STAGE3_BACKUP=""

container_server_url() {
  docker exec "${CONTAINER}" printenv SERVER_URL 2>/dev/null || true
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
except Exception as e:
    print("HTTP=0")
    print("ERROR=%s" % e.__class__.__name__)
    sys.exit(0)
print("HTTP=%s" % status)
try:
    data = json.loads(body)
except Exception:
    print("JSON=no")
    sys.exit(0)
print("JSON=yes")
print("VERSION=%s" % (data.get("version") or ""))
mgr = str(data.get("manager") or "")
print("MANAGER=%s" % mgr)
print("MANAGER_HTTP_EXPECTED=%s" % ("yes" if mgr.startswith("http://") else "no"))
PY
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
except Exception:
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
        hip = conf.get("HostIp")
        if hip in (None, ""):
            hip = "0.0.0.0"
        hp = conf.get("HostPort") or ""
        found.append("%s:%s->%s" % (hip, hp, key))
print("DOCKER_PUBLISH_8080=%s" % (";".join(found) if found else "none"))
joined = ";".join(found)
public = ("0.0.0.0:8080" in joined) or ("[::]:8080" in joined) or (joined.startswith(":::") or ";:::8080" in joined)
loop = "127.0.0.1:8080" in joined
if loop and not public:
    print("PORT_8080_BIND=loopback_only")
elif public:
    print("PORT_8080_BIND=public")
else:
    print("PORT_8080_BIND=see_DOCKER_PUBLISH_8080")
PY
}

patch_compose_port() {
  python3 - "$1" "$SERVICE" "$TARGET_PORT_MAP" <<'PY'
import os, re, sys
path, service, target = sys.argv[1], sys.argv[2], sys.argv[3]
raw = open(path, "rb").read()
nl = b"\r\n" if b"\r\n" in raw else b"\n"
text = raw.decode("utf-8")
lines = text.splitlines()

port_re = re.compile(
    r"^(\s*-\s*)(?P<q>[\"']?)(?P<map>"
    r"\$\{EVOLUTION_HOST_PORT:-8080\}:8080|"
    r"0\.0\.0\.0:8080:8080|"
    r"\[::\]:8080:8080|"
    r"8080:8080|"
    r"127\.0\.0\.1:8080:8080"
    r")(?P=q)\s*$"
)

def indent_of(s):
    return len(s) - len(s.lstrip(" "))

in_services = False
services_indent = None
in_target = False
svc_indent = None
changed = 0
already = 0
hits = 0
out = []
i = 0
while i < len(lines):
    line = lines[i]
    stripped = line.strip()
    ind = indent_of(line)
    if stripped == "services:":
        in_services = True
        services_indent = ind
        in_target = False
        out.append(line)
        i += 1
        continue
    if in_services and services_indent is not None and stripped.endswith(":") and not stripped.startswith("-") and ind == services_indent + 2:
        name = stripped[:-1]
        in_target = name == service
        svc_indent = ind
        out.append(line)
        i += 1
        continue
    if in_services and services_indent is not None and ind <= services_indent and stripped.endswith(":") and stripped != "services:":
        in_services = False
        in_target = False
    if in_target and svc_indent is not None and ind <= svc_indent and stripped.endswith(":") and not stripped.startswith("-"):
        in_target = False
    if in_target:
        m = port_re.match(line)
        if m:
            hits += 1
            prefix = m.group(1)
            current = m.group("map")
            if current == target:
                already += 1
                out.append(line)
            else:
                out.append('%s"%s"' % (prefix, target))
                changed += 1
            i += 1
            continue
    out.append(line)
    i += 1

if hits == 0:
    sys.stderr.write("PORT_LINE_NOT_FOUND\n")
    sys.exit(2)
if hits != 1:
    sys.stderr.write("PORT_LINE_AMBIGUOUS=%d\n" % hits)
    sys.exit(3)
if changed == 0 and already == 1:
    print("UNCHANGED")
    sys.exit(0)

new = ("\n".join(out) + ("\n" if text.endswith("\n") else "")).encode("utf-8")
if nl == b"\r\n":
    new = new.replace(b"\n", b"\r\n")
tmp = path + ".stage3.tmp"
fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
try:
    os.write(fd, new)
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

other_ids_file="$(mktemp)"
trap 'rm -f "${other_ids_file}" "${COMPOSE_FILE}.stage3.tmp"' EXIT

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
  warn "ROLLBACK: restaurando Compose da Etapa 3 e recriando ${SERVICE}"
  if [[ -z "${STAGE3_BACKUP}" || ! -f "${STAGE3_BACKUP}/docker-compose.yml" ]]; then
    err "Backup da Etapa 3 indisponivel; nao e possivel restaurar Compose"
    echo "ROLLBACK_DONE=no"
    return 1
  fi
  cp -a "${STAGE3_BACKUP}/docker-compose.yml" "${COMPOSE_FILE}"
  compose "${up_args[@]}" "${SERVICE}"
  wait_local_api || true
  echo "=== ROLLBACK_INSTANCE ==="
  instance_state || true
  echo "=== ROLLBACK_PORT ==="
  port_bind || true
  echo "ROLLBACK_DONE=yes"
  echo "ENV_RESTORED=no"
}

echo "=== STAGE3_BEGIN ==="
echo "SERVICE=${SERVICE}"
echo "CONTAINER=${CONTAINER}"
echo "TARGET_PORT_MAP=${TARGET_PORT_MAP}"
echo "ENV_FILE_TOUCHED=no"

if [[ ! -f "${COMPOSE_FILE}" || ! -f "${ENV_FILE}" ]]; then
  err "Compose ou .env ausente"
  exit 1
fi
if [[ ! -d "${STAGE1_BACKUP}" ]]; then
  warn "Backup da Etapa 1 nao encontrado; Etapa 3 criara backup proprio do Compose"
fi
if ! grep -q "reverse_proxy ${BACKEND}" "${CADDYFILE}"; then
  err "Caddyfile nao encaminha para ${BACKEND}"
  exit 1
fi
ok "Caddyfile reverse_proxy ${BACKEND} (nao sera modificado)"
caddy_active="$(systemctl is-active caddy 2>/dev/null || true)"
echo "CADDY_ACTIVE=${caddy_active}"
if [[ "${caddy_active}" != "active" ]]; then
  err "Caddy nao esta active"
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "${CONTAINER}"; then
  err "Container ${CONTAINER} nao esta em execucao"
  exit 1
fi
svc_now="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "${CONTAINER}" 2>/dev/null || true)"
if [[ "${svc_now}" != "${SERVICE}" ]]; then
  err "Servico Compose inesperado: ${svc_now:-unknown}"
  exit 1
fi

echo "=== PRE_CONTAINER_SERVER_URL ==="
pre_url="$(container_server_url)"
echo "CONTAINER_SERVER_URL=${pre_url}"
if [[ "${pre_url}" != "${TARGET_URL}" ]]; then
  err "SERVER_URL do container nao e HTTPS; abortando Etapa 3"
  exit 1
fi
ok "SERVER_URL HTTPS no container"

echo "=== PRE_HTTPS ==="
pre_https="$(http_welcome "https://${DOMAIN}/")"
printf '%s\n' "${pre_https}"
if ! printf '%s' "${pre_https}" | grep -q 'HTTP=200' || ! printf '%s' "${pre_https}" | grep -q "VERSION=${EXPECTED_VERSION}"; then
  err "HTTPS/versao nao saudaveis; abortando sem alterar"
  exit 1
fi

echo "=== PRE_INSTANCE ==="
pre_inst="$(instance_state)"
printf '%s\n' "${pre_inst}"
if ! printf '%s' "${pre_inst}" | grep -q 'INSTANCE_CONNECTED=yes'; then
  err "Instancia nao esta open; abortando sem alterar"
  exit 1
fi
ok "Instancia ${INSTANCE} open"

echo "=== PRE_PORT ==="
pre_port="$(port_bind)"
printf '%s\n' "${pre_port}"

snapshot_others
ok "Snapshot de containers auxiliares gravado"

# Backup adicional do Compose atual
STAMP="$(date -u +%Y%m%d%H%M%S)"
STAGE3_BACKUP="/root/fb-https-backup-stage3-${STAMP}"
if [[ -e "${STAGE3_BACKUP}" ]]; then
  STAGE3_BACKUP="${STAGE3_BACKUP}-$$"
fi
mkdir -m 700 "${STAGE3_BACKUP}"
cp -a "${COMPOSE_FILE}" "${STAGE3_BACKUP}/docker-compose.yml"
chmod 600 "${STAGE3_BACKUP}/docker-compose.yml"
echo "STAGE3_BACKUP=${STAGE3_BACKUP}"
ok "Backup adicional do Compose gravado"

# Idempotente
if printf '%s' "${pre_port}" | grep -q 'PORT_8080_BIND=loopback_only'; then
  ok "8080 ja esta so em 127.0.0.1. Sem recreate."
  echo "RECREATED=no"
  echo "ETAPA3=already_loopback"
  echo "MANAGER_HTTP_EXPECTED=yes"
  echo "=== STAGE3_END ==="
  exit 0
fi

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

info "Alterando somente o mapeamento de porta de ${SERVICE}"
set_rc=0
set_out="$(patch_compose_port "${COMPOSE_FILE}")" || set_rc=$?
if [[ "${set_rc}" -ne 0 ]]; then
  err "Falha ao alterar porta no Compose (rc=${set_rc})"
  exit 1
fi
echo "COMPOSE_WRITE=${set_out}"
compose config "${config_args[@]}"
ok "Compose valido apos a alteracao"

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
post_url="$(container_server_url)"
echo "CONTAINER_SERVER_URL=${post_url}"
if [[ "${post_url}" != "${TARGET_URL}" ]]; then
  err "SERVER_URL do container mudou; rollback"
  rollback_recreate
  exit 1
fi
ok "SERVER_URL continua ${TARGET_URL}"

echo "=== POST_HTTPS ==="
post_https="$(http_welcome "https://${DOMAIN}/")"
printf '%s\n' "${post_https}"
if ! printf '%s' "${post_https}" | grep -q 'HTTP=200'; then
  err "HTTPS nao retornou 200"
  rollback_recreate
  exit 1
fi
if ! printf '%s' "${post_https}" | grep -q "VERSION=${EXPECTED_VERSION}"; then
  err "Versao inesperada"
  rollback_recreate
  exit 1
fi
ok "HTTPS 200 versao ${EXPECTED_VERSION}"
info "manager HTTP e esperado; sem rollback"
echo "MANAGER_HTTP_EXPECTED=yes"

echo "=== POST_INSTANCE ==="
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
  err "Instancia nao permaneceu open"
  rollback_recreate
  exit 1
fi
ok "Instancia ${INSTANCE} open"

echo "=== POST_PORT ==="
post_port="$(port_bind)"
printf '%s\n' "${post_port}"
if ! printf '%s' "${post_port}" | grep -q 'PORT_8080_BIND=loopback_only'; then
  err "Docker ainda publica 8080 fora de 127.0.0.1"
  rollback_recreate
  exit 1
fi
ok "8080 publicado apenas em 127.0.0.1"
echo "=== SS_8080 ==="
ss -lntp 2>/dev/null | grep -E ':8080|:443|:80 ' || true

echo "=== GUARDS ==="
echo "RECREATED=${SERVICE}"
echo "ENV_FILE_TOUCHED=no"
echo "CADDY_MODIFIED=no"
echo "FIREWALL_MODIFIED=no"
echo "POSTGRES_RESTARTED=no"
echo "REDIS_RESTARTED=no"
echo "VOLUMES_DELETED=no"
echo "WHATSAPP_SENT=no"
echo "ROLLBACK_EXECUTED=no"
echo "MANAGER_HTTP_EXPECTED=yes"
echo "EXTERNAL_8080_CHECK=pending_from_operator_network"
echo "=== STAGE3_END ==="
echo
echo "=== RESULTADO ==="
echo "PORT_8080_BIND=loopback_only"
echo "HTTPS_HTTP=200"
echo "VERSION=${EXPECTED_VERSION}"
echo "CONTAINER_SERVER_URL=${TARGET_URL}"
echo "INSTANCE_OPEN=yes"
echo "STAGE3_BACKUP=${STAGE3_BACKUP}"
echo "NOTE=Confirmar externamente que http://2.24.108.128:8080 nao responde e que HTTPS continua 200"
