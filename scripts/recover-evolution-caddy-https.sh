#!/usr/bin/env bash
# Recuperacao pos-install Caddy (SEM reinstalar, SEM ACME, SEM Docker restart).
# Idempotente: valida Caddy 2.11.7 parado e grava o Caddyfile.

set -euo pipefail

DOMAIN="faithbrothers-wa.chickenkiller.com"
BACKEND="127.0.0.1:8080"
EVOLUTION_DIR="/opt/evolution-faithbrothers"
INSTANCE="FaithBrothersAcademia"
CADDYFILE="/etc/caddy/Caddyfile"
EXPECT_VER="2.11.7"

ok() { printf '[OK]    %s\n' "$*"; }
info() { printf '[INFO]  %s\n' "$*"; }
warn() { printf '[WARN]  %s\n' "$*"; }
err() { printf '[ERROR] %s\n' "$*"; }

if [[ "$(id -u)" -ne 0 ]]; then
  err "Execute como root."
  exit 1
fi

stop_and_disable_caddy() {
  systemctl disable --now caddy >/dev/null 2>&1 || true
  systemctl stop caddy >/dev/null 2>&1 || true
}

active="$(systemctl is-active caddy 2>/dev/null || true)"
enabled="$(systemctl is-enabled caddy 2>/dev/null || true)"
ver="$(dpkg-query -W -f='${Version}' caddy 2>/dev/null || true)"

if [[ -z "${ver}" ]]; then
  err "Caddy nao esta instalado; este script nao reinstala."
  exit 1
fi
case "${ver}" in
  "${EXPECT_VER}"|"${EXPECT_VER}"-*) ;;
  *)
    err "Versao Caddy inesperada: ${ver} (esperado ${EXPECT_VER})"
    exit 1
    ;;
esac
ok "Caddy ${ver} instalado"

if [[ "${active}" != "inactive" && "${active}" != "dead" && "${active}" != "failed" ]]; then
  warn "Caddy estava ${active}; forcando stop/disable"
fi
stop_and_disable_caddy
active="$(systemctl is-active caddy 2>/dev/null || true)"
enabled="$(systemctl is-enabled caddy 2>/dev/null || true)"
if [[ "${active}" != "inactive" && "${active}" != "dead" && "${active}" != "failed" ]]; then
  err "Caddy nao ficou inactive (active=${active})"
  exit 1
fi
if [[ "${enabled}" != "disabled" && "${enabled}" != "masked" ]]; then
  err "Caddy nao ficou disabled (enabled=${enabled})"
  exit 1
fi
ok "Caddy inactive/disabled"

for p in 80 443; do
  if ss -lnt 2>/dev/null | awk -v p=":${p}" '$4 ~ p"$" { found=1 } END { exit found?0:1 }'; then
    who="$(ss -lntp 2>/dev/null | awk -v p=":${p}" '$4 ~ p"$" { print; exit }' || true)"
    if printf '%s' "${who}" | grep -qi caddy; then
      err "Porta ${p} ainda no Caddy apos disable"
      exit 1
    fi
    err "Porta ${p} em uso por outro servico"
    printf '%s\n' "${who}"
    exit 1
  fi
  ok "Porta ${p} livre"
done

body="$(curl -fsS --max-time 8 "http://${BACKEND}/" 2>/dev/null || true)"
if ! printf '%s' "${body}" | grep -qE 'Welcome to the Evolution API|"status"[[:space:]]*:[[:space:]]*200'; then
  err "Evolution nao respondeu em http://${BACKEND}"
  exit 1
fi
ok "Evolution em http://${BACKEND}"

if ! command -v docker >/dev/null 2>&1; then
  err "docker nao encontrado"
  exit 1
fi
ps="$(docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null || true)"
printf '%s\n' "${ps}"
if printf '%s' "${ps}" | grep -qiE 'unhealthy|restarting'; then
  err "Container unhealthy/restarting"
  exit 1
fi
ok "Containers Docker sem unhealthy/restarting"

inst_out="INSTANCE_STATE=unavailable"
inst_ok="no"
if command -v python3 >/dev/null 2>&1 && [[ -f "${EVOLUTION_DIR}/.env" ]]; then
  set +e
  key="$(python3 - "${EVOLUTION_DIR}/.env" <<'PY' 2>/dev/null
import re, sys
try:
    text = open(sys.argv[1], encoding="utf-8", errors="ignore").read()
except Exception:
    sys.exit(2)
for name in ("AUTHENTICATION_API_KEY", "EVOLUTION_API_KEY", "API_KEY", "WHATSAPP_EVOLUTION_API_KEY"):
    m = re.search(r"(?m)^\s*" + re.escape(name) + r"\s*=\s*(.*)$", text)
    if not m:
        continue
    raw = m.group(1).strip().strip("'").strip('"')
    if raw:
        sys.stdout.write(raw)
        sys.exit(0)
sys.exit(3)
PY
)"
  key_rc=$?
  set -e
  if [[ "${key_rc}" -eq 0 && -n "${key}" ]]; then
    tmp="$(mktemp)"
    chmod 600 "${tmp}"
    set +e
    code="$(curl -s --max-time 10 -H "apikey: ${key}" -o "${tmp}" -w '%{http_code}' \
      "http://${BACKEND}/instance/connectionState/${INSTANCE}")"
    set -e
    unset key
    if [[ "${code}" == "200" ]]; then
      inst_out="$(python3 - "${tmp}" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1], encoding="utf-8"))
    inst = data.get("instance") if isinstance(data, dict) else {}
    if not isinstance(inst, dict):
        inst = {}
    state = str(inst.get("state") or data.get("state") or "unknown")
    print("INSTANCE_STATE=" + state)
    print("INSTANCE_CONNECTED=" + ("yes" if state.lower() == "open" else "no"))
except Exception:
    print("INSTANCE_STATE=unavailable")
    print("INSTANCE_CONNECTED=no")
PY
)"
    else
      inst_out="INSTANCE_STATE=http_${code:-000}"$'\n'"INSTANCE_CONNECTED=no"
    fi
    rm -f "${tmp}"
  else
    unset key
  fi
fi
printf '%s\n' "${inst_out}"
if printf '%s' "${inst_out}" | grep -q 'INSTANCE_CONNECTED=yes'; then
  inst_ok="yes"
fi

if [[ -f "${CADDYFILE}" ]]; then
  cp -a "${CADDYFILE}" "${CADDYFILE}.bak.$(date +%Y%m%d%H%M%S)"
fi
cat > "${CADDYFILE}" <<EOF
${DOMAIN} {
	encode gzip
	reverse_proxy ${BACKEND}
}
EOF
caddy validate --config "${CADDYFILE}" --adapter caddyfile
ok "Caddyfile validado (servico parado): ${DOMAIN} -> ${BACKEND}"

stop_and_disable_caddy
active="$(systemctl is-active caddy 2>/dev/null || true)"
enabled="$(systemctl is-enabled caddy 2>/dev/null || true)"

echo
echo "=== RESULTADO ==="
echo "CADDY_VERSION=${ver}"
echo "CADDY_ACTIVE=${active}"
echo "CADDY_ENABLED=${enabled}"
echo "CADDYFILE=${CADDYFILE}"
echo "ACME_ATTEMPTED=no"
echo "HTTPS_OK=no"
echo "EVOLUTION_8080=yes"
echo "INSTANCE_OK=${inst_ok}"
printf '%s\n' "${inst_out}"
echo "DOCKER_UNCHANGED=yes"
echo "CADDY_REINSTALLED=no"
echo "WHATSAPP_SENT=no"
echo "PENDING=HOSTINGER_FIREWALL_TCP_80_443"
echo "${ps}"
