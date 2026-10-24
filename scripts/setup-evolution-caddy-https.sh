#!/usr/bin/env bash
# =============================================================================
# Faith Brothers - instalar Caddy e gravar Caddyfile (SEM pedir certificado)
#
# Esta etapa NAO inicia o Caddy no dominio e NAO chama Let's Encrypt.
# Segura com 80/443 bloqueadas na internet: o servico termina disabled.
#
# NAO FAZ: docker restart, alterar containers, Evolution, secrets Supabase,
#          firewall, DNS, crons, apt upgrade, UFW, envio WhatsApp, ACME.
# =============================================================================

set -euo pipefail
# NUNCA use set -x: vazaria headers/API keys.

DOMAIN="faithbrothers-wa.chickenkiller.com"
BACKEND="127.0.0.1:8080"
EVOLUTION_DIR="/opt/evolution-faithbrothers"
INSTANCE="FaithBrothersAcademia"
CADDYFILE="/etc/caddy/Caddyfile"
CADDY_KEYRING="/usr/share/keyrings/caddy-stable-archive-keyring.gpg"
CADDY_LIST="/etc/apt/sources.list.d/caddy-stable.list"
CADDY_SITE="dl.cloudsmith.io"
CADDY_PIN="/etc/apt/preferences.d/fb-caddy-official.pref"
POLICY_RC="/usr/sbin/policy-rc.d"
# Fingerprint primario oficial: https://cloudsmith.io/~caddy/repos/stable/pub-keys/
CADDY_GPG_FPR="65760C51EDEA2017CEA2CA15155B6D79CA56EA34"

CADDY_GUARD=0
CREATED_POLICY_RC=0
POLICY_RC_PREEXISTED=0
CREATED_PIN=0
VALIDATED_VERSION=""

ok() { printf '[OK]    %s\n' "$*"; }
info() { printf '[INFO]  %s\n' "$*"; }
warn() { printf '[WARN]  %s\n' "$*"; }
err() { printf '[ERROR] %s\n' "$*"; }

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    err "Execute como root no Web Console da Hostinger."
    exit 1
  fi
}

sanitize_text() {
  sed -E \
    -e 's/(apikey|api[_-]?key|authorization|bearer)["=: ]+[^[:space:]"]+/apikey=REDACTED/Ig' \
    -e 's/(AUTHENTICATION_API_KEY|EVOLUTION_API_KEY|WHATSAPP_EVOLUTION_API_KEY|API_KEY)=[^[:space:]]+/\1=REDACTED/g'
}

docker_status_line() {
  docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null | sanitize_text || true
}

stop_and_disable_caddy() {
  systemctl disable --now caddy >/dev/null 2>&1 || true
  systemctl stop caddy >/dev/null 2>&1 || true
}

caddy_active_state() {
  systemctl is-active caddy 2>/dev/null || true
}

caddy_enabled_state() {
  systemctl is-enabled caddy 2>/dev/null || true
}

caddy_is_inactive_disabled() {
  local active enabled
  active="$(caddy_active_state)"
  enabled="$(caddy_enabled_state)"
  case "${active}" in
    inactive|dead|failed|unknown|"") ;;
    *) return 1 ;;
  esac
  case "${enabled}" in
    disabled|masked|not-found|"") ;;
    *) return 1 ;;
  esac
  return 0
}

assert_caddy_inactive_disabled() {
  stop_and_disable_caddy
  if caddy_is_inactive_disabled; then
    ok "Caddy inactive/disabled"
    return 0
  fi
  err "Caddy nao ficou inactive/disabled (active=$(caddy_active_state) enabled=$(caddy_enabled_state))"
  exit 1
}

cleanup_policy_rc() {
  if [[ "${POLICY_RC_PREEXISTED}" -eq 1 ]]; then
    return 0
  fi
  if [[ "${CREATED_POLICY_RC}" -eq 1 ]]; then
    rm -f "${POLICY_RC}"
    CREATED_POLICY_RC=0
  fi
}

# Qualquer saida apos o inicio do apt-get install forca Caddy parado.
# policy-rc.d preexistente nunca e apagado.
on_exit() {
  if [[ "${CADDY_GUARD}" -eq 1 ]]; then
    stop_and_disable_caddy
  fi
  cleanup_policy_rc
}
trap on_exit EXIT INT TERM

evolution_welcome() {
  local url="$1"
  local body
  body="$(curl -fsS --max-time 8 "$url" 2>/dev/null || true)"
  if printf '%s' "$body" | grep -q 'Welcome to the Evolution API'; then
    return 0
  fi
  if printf '%s' "$body" | grep -q '"status"[[:space:]]*:[[:space:]]*200'; then
    return 0
  fi
  return 1
}

port_listening() {
  local port="$1"
  ss -lnt 2>/dev/null | awk -v p=":${port}" '$4 ~ p"$" { found=1 } END { exit found?0:1 }'
}

assert_evolution_8080() {
  if ! evolution_welcome "http://${BACKEND}/"; then
    err "Evolution nao respondeu em http://${BACKEND} - abortando, 8080 preservada"
    exit 1
  fi
  ok "Evolution local em http://${BACKEND}"
}

preflight() {
  info "Preflight: Evolution :8080 e containers (somente leitura)"
  if [[ ! -d "$EVOLUTION_DIR" ]]; then
    err "Diretorio nao encontrado: $EVOLUTION_DIR"
    exit 1
  fi
  if ! command -v docker >/dev/null 2>&1; then
    err "docker nao encontrado"
    exit 1
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    err "python3 e obrigatorio para validar metadados APT e ler o .env sem vazar credenciais"
    exit 1
  fi
  assert_evolution_8080

  local ps
  ps="$(docker_status_line)"
  printf '%s\n' "$ps"
  if printf '%s' "$ps" | grep -qiE 'unhealthy|restarting'; then
    err "Ha container unhealthy/restarting. Abortando sem instalar Caddy."
    exit 1
  fi
}

check_ports_before_install() {
  info "Checando se 80/443 estao livres no host (nao abre firewall)"
  local p
  for p in 80 443; do
    if port_listening "$p"; then
      local who
      who="$(ss -lntp 2>/dev/null | awk -v p=":${p}" '$4 ~ p"$" { print; exit }' | sanitize_text || true)"
      if printf '%s' "$who" | grep -qi caddy; then
        warn "Porta ${p} ja em uso pelo Caddy; o servico sera desligado"
      else
        err "Porta ${p} ja em uso por outro servico. Abortando."
        printf '%s\n' "$who"
        exit 1
      fi
    else
      ok "Porta ${p} livre no host"
    fi
  done
}

prevent_apt_service_start() {
  if [[ -e "${POLICY_RC}" ]]; then
    POLICY_RC_PREEXISTED=1
    CREATED_POLICY_RC=0
    warn "policy-rc.d preexistente preservado (nao modificado)"
    return 0
  fi
  printf '%s\n' '#!/bin/sh' 'exit 101' > "${POLICY_RC}"
  chmod 755 "${POLICY_RC}"
  CREATED_POLICY_RC=1
  POLICY_RC_PREEXISTED=0
  ok "APT nao vai iniciar servicos durante o install (policy-rc.d temporario)"
}

ensure_official_pin() {
  if [[ -e "${CADDY_PIN}" ]]; then
    warn "Pin APT ja existe em ${CADDY_PIN}; nao sera substituido"
    return 0
  fi
  cat > "${CADDY_PIN}" <<EOF
Package: caddy
Pin: origin ${CADDY_SITE}
Pin-Priority: 1001
EOF
  chmod 644 "${CADDY_PIN}"
  CREATED_PIN=1
  ok "Pin APT: caddy origin=${CADDY_SITE} priority=1001"
}

# Metadados APT: parser em arquivo temporario (sem /dev/fd/3). Nao imprime credenciais.
parse_caddy_policy() {
  local mode="$1"
  local policy_text="$2"
  local py rc
  py="$(mktemp)"
  cat > "${py}" <<'PY'
import os, sys, urllib.parse

site = os.environ.get("CADDY_SITE", "dl.cloudsmith.io")
mode = sys.argv[1]
text = sys.stdin.read()
candidate = None
installed = None
current = None
versions = []

for raw in text.splitlines():
    line = raw.rstrip("\n")
    if line.startswith("  Candidate:"):
        candidate = line.split(":", 1)[1].strip()
        continue
    if line.startswith("  Installed:"):
        installed = line.split(":", 1)[1].strip()
        continue
    if line.startswith("        ") and current is not None:
        parts = line.split()
        if len(parts) < 2:
            continue
        try:
            prio = int(parts[0])
        except ValueError:
            continue
        current["sources"].append({"priority": prio, "uri": parts[1]})
        continue

    # Linha de versao: "     2.11.7 500" (candidato) ou " *** 2.11.7 1001" (instalado).
    parts = line.split()
    if not parts:
        continue
    if parts[0] == "***":
        parts = parts[1:]
    elif not line.startswith("     "):
        continue
    if not parts or parts[0] in ("Installed:", "Candidate:", "Version"):
        continue
    current = {"version": parts[0], "sources": []}
    versions.append(current)

def host_of(uri):
    if uri.startswith("/") or uri == "/var/lib/dpkg/status":
        return "local"
    try:
        return urllib.parse.urlparse(uri).hostname or ""
    except Exception:
        return ""

def pick(version):
    for item in versions:
        if item["version"] == version:
            if not item["sources"]:
                return None
            return max(item["sources"], key=lambda s: s["priority"])
    return None

if mode == "candidate":
    if not candidate or candidate == "(none)":
        sys.stderr.write("apt_origin=no_candidate\n")
        sys.exit(2)
    src = pick(candidate)
    if src is None:
        sys.stderr.write("apt_origin=no_source\n")
        sys.exit(3)
    host = host_of(src["uri"])
    parsed = urllib.parse.urlparse(src["uri"]) if "://" in src["uri"] else None
    scheme = parsed.scheme if parsed else ""
    if scheme != "https" or host != site:
        sys.stderr.write("apt_origin=unexpected_source\n")
        sys.exit(4)
    sys.stdout.write(candidate + "\n")
    sys.stdout.write(host + "\n")
    sys.stdout.write(src["uri"] + "\n")
    sys.exit(0)

if mode == "installed":
    expect = os.environ.get("VALIDATED_VERSION", "")
    if not installed or installed == "(none)":
        sys.stderr.write("apt_origin=not_installed\n")
        sys.exit(2)
    if expect and installed != expect:
        sys.stderr.write("apt_origin=version_mismatch\n")
        sys.exit(5)
    official = False
    for item in versions:
        if item["version"] != installed:
            continue
        for src in item["sources"]:
            if host_of(src["uri"]) == site:
                official = True
    if not official:
        sys.stderr.write("apt_origin=missing_official_uri\n")
        sys.exit(4)
    sys.stdout.write(installed + "\n")
    sys.exit(0)

sys.exit(1)
PY
  chmod 600 "${py}"
  set +e
  printf '%s\n' "${policy_text}" | CADDY_SITE="${CADDY_SITE}" VALIDATED_VERSION="${VALIDATED_VERSION:-}" \
    python3 "${py}" "${mode}"
  rc=$?
  set -e
  rm -f "${py}"
  return "${rc}"
}

verify_caddy_gpg_fingerprint() {
  local fpr
  fpr="$(gpg --show-keys --with-colons "${CADDY_KEYRING}" 2>/dev/null | awk -F: '/^fpr:/ { print $10; exit }')"
  fpr="$(printf '%s' "${fpr}" | tr -d ' ' | tr '[:lower:]' '[:upper:]')"
  if [[ "${fpr}" != "${CADDY_GPG_FPR}" ]]; then
    rm -f "${CADDY_KEYRING}"
    err "Fingerprint GPG Caddy inesperado; keyring removido"
    exit 1
  fi
  ok "GPG Caddy fingerprint conferido"
}

verify_caddy_source_list() {
  if [[ ! -s "${CADDY_LIST}" ]]; then
    err "Source list Caddy ausente"
    exit 1
  fi
  if [[ ! -s "${CADDY_KEYRING}" ]]; then
    err "Keyring Caddy ausente"
    exit 1
  fi
  if ! awk -v key="${CADDY_KEYRING}" -v site="${CADDY_SITE}" '
    $1 == "deb" {
      found = 1
      signed = 0
      okhost = 0
      for (i = 1; i <= NF; i++) {
        if ($i ~ ("signed-by=" key)) signed = 1
        if ($i ~ ("^https://" site "/")) okhost = 1
      }
      if (!signed || !okhost) exit 2
    }
    END { if (!found) exit 3 }
  ' "${CADDY_LIST}"; then
    err "Source list Caddy sem signed-by do keyring ou URI inesperada"
    exit 1
  fi
}

verify_caddy_candidate() {
  local policy out rc
  policy="$(apt-cache policy caddy 2>/dev/null || true)"
  set +e
  out="$(parse_caddy_policy candidate "${policy}")"
  rc=$?
  set -e
  if [[ "${rc}" -ne 0 ]]; then
    err "Candidato APT do caddy nao e do repositorio oficial ${CADDY_SITE}"
    exit 1
  fi
  VALIDATED_VERSION="$(printf '%s\n' "${out}" | sed -n '1p')"
  local host uri
  host="$(printf '%s\n' "${out}" | sed -n '2p')"
  uri="$(printf '%s\n' "${out}" | sed -n '3p')"
  if [[ -z "${VALIDATED_VERSION}" || "${host}" != "${CADDY_SITE}" ]]; then
    err "Metadados APT do caddy invalidos"
    exit 1
  fi
  export VALIDATED_VERSION
  ok "APT candidate=${VALIDATED_VERSION} site=${host}"
  info "APT uri=${uri}"
}

verify_caddy_installed_origin() {
  local policy rc
  policy="$(apt-cache policy caddy 2>/dev/null || true)"
  set +e
  parse_caddy_policy installed "${policy}" >/dev/null
  rc=$?
  set -e
  if [[ "${rc}" -ne 0 ]]; then
    err "Pacote caddy instalado nao confere com a origem/versao validada"
    exit 1
  fi
  local got
  got="$(dpkg-query -W -f='${Version}' caddy 2>/dev/null || true)"
  if [[ "${got}" != "${VALIDATED_VERSION}" ]]; then
    err "Versao instalada (${got}) != validada (${VALIDATED_VERSION})"
    exit 1
  fi
  ok "Pacote instalado caddy=${got} origem oficial"
}

install_caddy_official() {
  local install_rc
  info "Repositorio oficial do Caddy"
  export DEBIAN_FRONTEND=noninteractive

  apt-get install -y --no-install-recommends \
    debian-keyring debian-archive-keyring apt-transport-https ca-certificates curl gnupg >/dev/null

  rm -f "${CADDY_KEYRING}"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o "${CADDY_KEYRING}"
  chmod o+r "${CADDY_KEYRING}"
  if [[ ! -s "${CADDY_KEYRING}" ]]; then
    err "Keyring Caddy vazio - abortando"
    exit 1
  fi
  verify_caddy_gpg_fingerprint
  ok "Keyring Caddy gravado"

  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee "${CADDY_LIST}" >/dev/null
  chmod o+r "${CADDY_LIST}"
  verify_caddy_source_list

  apt-get update \
    -o Dir::Etc::sourcelist="${CADDY_LIST}" \
    -o Dir::Etc::sourceparts="-" \
    -o APT::Get::List-Cleanup="0"

  ensure_official_pin
  verify_caddy_candidate
  prevent_apt_service_start

  # Guard BEFORE apt-get: instalacao parcial tambem dispara o trap.
  CADDY_GUARD=1
  info "Instalando caddy=${VALIDATED_VERSION} (somente essa versao)"
  set +e
  apt-get install -y --no-install-recommends \
    -o APT::Get::AllowUnauthenticated=false \
    "caddy=${VALIDATED_VERSION}"
  install_rc=$?
  set -e
  stop_and_disable_caddy
  cleanup_policy_rc

  if [[ "${install_rc}" -ne 0 ]]; then
    err "apt-get install caddy falhou (rc=${install_rc}); servico forcado inactive/disabled"
    assert_caddy_inactive_disabled
    exit 1
  fi

  verify_caddy_installed_origin
  assert_caddy_inactive_disabled
  ok "Caddy instalado e parado antes do Caddyfile"
}

write_caddyfile() {
  if ! caddy_is_inactive_disabled; then
    err "Recusa: Caddy nao esta inactive/disabled ao gravar Caddyfile"
    assert_caddy_inactive_disabled
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
  ok "Caddyfile em disco (servico parado): ${DOMAIN} -> ${BACKEND}"
}

# stdout: somente a chave. stderr: codigo curto. Nunca dump do .env.
load_apikey_quiet() {
  local env_file="${EVOLUTION_DIR}/.env"
  python3 - "${env_file}" <<'PY'
import re, sys
path = sys.argv[1]
names = ("AUTHENTICATION_API_KEY", "EVOLUTION_API_KEY", "API_KEY", "WHATSAPP_EVOLUTION_API_KEY")
try:
    text = open(path, "r", encoding="utf-8", errors="ignore").read()
except OSError:
    sys.stderr.write("env_read=io_error\n")
    sys.exit(2)
except Exception:
    sys.stderr.write("env_read=error\n")
    sys.exit(2)
try:
    for name in names:
        m = re.search(r"(?m)^\s*" + re.escape(name) + r"\s*=\s*(.*)$", text)
        if not m:
            continue
        raw = m.group(1).strip().strip("'").strip('"')
        if raw:
            sys.stdout.write(raw)
            sys.exit(0)
    sys.stderr.write("env_read=not_found\n")
    sys.exit(3)
except Exception:
    sys.stderr.write("env_read=parse_error\n")
    sys.exit(2)
PY
}

query_instance_state() {
  local key="" rc=0 tmp code curl_rc py_rc
  set +e
  key="$(load_apikey_quiet 2>/dev/null)"
  rc=$?
  set -e
  if [[ "${rc}" -ne 0 || -z "${key}" ]]; then
    unset key
    printf 'INSTANCE_STATE=unavailable\n'
    printf 'INSTANCE_CONNECTED=no\n'
    return 1
  fi
  tmp="$(mktemp)"
  chmod 600 "${tmp}"
  set +e
  code="$(curl -s --max-time 10 -H "apikey: ${key}" \
    -o "${tmp}" -w '%{http_code}' \
    "http://${BACKEND}/instance/connectionState/${INSTANCE}")"
  curl_rc=$?
  set -e
  unset key
  if [[ "${curl_rc}" -ne 0 || -z "${code}" ]]; then
    rm -f "${tmp}"
    printf 'INSTANCE_STATE=unavailable\n'
    printf 'INSTANCE_CONNECTED=no\n'
    return 1
  fi
  if [[ "${code}" != "200" ]]; then
    rm -f "${tmp}"
    printf 'INSTANCE_STATE=http_%s\n' "${code}"
    printf 'INSTANCE_CONNECTED=no\n'
    return 1
  fi
  set +e
  python3 - "${tmp}" <<'PY'
import json, sys
path = sys.argv[1]
try:
    data = json.load(open(path, "r", encoding="utf-8"))
    inst = data.get("instance") if isinstance(data, dict) else {}
    if not isinstance(inst, dict):
        inst = {}
    state = inst.get("state") or (data.get("state") if isinstance(data, dict) else None) or "unknown"
    state = str(state)
    print("INSTANCE_STATE=" + state)
    print("INSTANCE_CONNECTED=" + ("yes" if state.lower() == "open" else "no"))
except Exception:
    sys.stderr.write("instance_parse=error\n")
    print("INSTANCE_STATE=unavailable")
    print("INSTANCE_CONNECTED=no")
    sys.exit(1)
PY
  py_rc=$?
  set -e
  rm -f "${tmp}"
  return "${py_rc}"
}

main() {
  require_root
  echo "=== Faith Brothers Caddy (install only, sem ACME) ==="
  echo "DOMAIN=${DOMAIN}"
  echo "BACKEND=${BACKEND}"
  echo "INSTANCE=${INSTANCE}"
  echo

  preflight
  check_ports_before_install
  install_caddy_official
  write_caddyfile
  assert_evolution_8080
  assert_caddy_inactive_disabled

  local inst_out="" inst_ok="no"
  set +e
  inst_out="$(query_instance_state)"
  set -e
  inst_out="$(printf '%s\n' "${inst_out}" | sanitize_text)"
  printf '%s\n' "$inst_out"
  if printf '%s' "$inst_out" | grep -q 'INSTANCE_CONNECTED=yes'; then
    inst_ok="yes"
  fi

  if ! caddy_is_inactive_disabled; then
    err "Validacao final: Caddy nao permaneceu inactive/disabled"
    stop_and_disable_caddy
    if ! caddy_is_inactive_disabled; then
      echo
      echo "=== RESULTADO ==="
      echo "CADDY_ACTIVE=$(caddy_active_state)"
      echo "CADDY_ENABLED=$(caddy_enabled_state)"
      echo "ACME_ATTEMPTED=no"
      echo "PENDING=CADDY_STILL_ACTIVE"
      exit 1
    fi
  fi

  echo
  echo "=== RESULTADO ==="
  echo "CADDY_ACTIVE=$(caddy_active_state)"
  echo "CADDY_ENABLED=$(caddy_enabled_state)"
  echo "CADDY_VERSION=$(dpkg-query -W -f='${Version}' caddy 2>/dev/null || echo unknown)"
  echo "CADDY_VALIDATED_VERSION=${VALIDATED_VERSION}"
  echo "ACME_ATTEMPTED=no"
  echo "HTTPS_OK=no"
  echo "CERT_PUBLIC=no"
  echo "EVOLUTION_HTTPS=no"
  echo "EVOLUTION_8080=yes"
  echo "INSTANCE_OK=${inst_ok}"
  printf '%s\n' "$inst_out"
  echo "PENDING=HOSTINGER_FIREWALL_TCP_80_443"
  echo "DOCKER_UNCHANGED=yes"
  echo "WHATSAPP_SENT=no"
  echo "WHATSAPP_SEND_UNCHANGED=yes"
  echo "SUPABASE_SECRETS_CHANGED=no"
  echo "FIREWALL_CHANGED=no"
  echo "DNS_CHANGED=no"
  echo "CRONS_CHANGED=no"
  docker_status_line
  echo
  echo "Caddy instalado, origem validada, servico parado. Certificado NAO pedido."
  echo "Evolution permanece em :8080. Nao altere secrets nesta etapa."
}

main "$@"
