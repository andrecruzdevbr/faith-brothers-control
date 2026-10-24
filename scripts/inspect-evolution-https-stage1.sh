#!/usr/bin/env bash
# Faith Brothers — Etapa 1: backup + inspeção da Evolution (SEM alteração de config).
# Idempotente: só cria /root/fb-https-backup-<timestamp>. Não modifica arquivos existentes.
# Não imprime .env, API keys, senhas, tokens, URIs. Não usa `docker compose config`.
# Não reinicia containers, não fecha 8080, não envia WhatsApp.

set -euo pipefail

DOMAIN="faithbrothers-wa.chickenkiller.com"
BACKEND="127.0.0.1:8080"
EVOLUTION_DIR="/opt/evolution-faithbrothers"
INSTANCE="FaithBrothersAcademia"
CADDYFILE="/etc/caddy/Caddyfile"
EXPECTED_PROXY="127.0.0.1:8080"

ok() { printf '[OK]    %s\n' "$*"; }
info() { printf '[INFO]  %s\n' "$*"; }
warn() { printf '[WARN]  %s\n' "$*"; }
err() { printf '[ERROR] %s\n' "$*"; }

if [[ "$(id -u)" -ne 0 ]]; then
  err "Execute como root."
  exit 1
fi

if [[ ! -d "${EVOLUTION_DIR}" ]]; then
  err "Diretorio nao encontrado: ${EVOLUTION_DIR}"
  exit 1
fi

# ---------------------------------------------------------------------------
# Backup (novos arquivos apenas)
# ---------------------------------------------------------------------------
STAMP="$(date -u +%Y%m%d%H%M%S)"
BDIR="/root/fb-https-backup-${STAMP}"
if [[ -e "${BDIR}" ]]; then
  BDIR="${BDIR}-$$"
fi
mkdir -m 700 "${BDIR}"
ok "BACKUP_DIR=${BDIR}"

copy_preserve() {
  local src="$1"
  local dest="$2"
  if [[ -f "${src}" ]]; then
    cp -a "${src}" "${dest}"
    chmod 600 "${dest}"
    ok "backup $(basename "${src}")"
    return 0
  fi
  return 1
}

COMPOSE_COPIED=()
for name in docker-compose.yml docker-compose.yaml compose.yml compose.yaml; do
  if copy_preserve "${EVOLUTION_DIR}/${name}" "${BDIR}/${name}"; then
    COMPOSE_COPIED+=("${name}")
  fi
done
if copy_preserve "${EVOLUTION_DIR}/.env" "${BDIR}/.env"; then
  ENV_BACKED_UP=yes
else
  ENV_BACKED_UP=no
  warn ".env ausente; backup sem env"
fi
if copy_preserve "${CADDYFILE}" "${BDIR}/Caddyfile"; then
  CADDY_BACKED_UP=yes
else
  CADDY_BACKED_UP=no
  warn "Caddyfile ausente"
fi

compose_joined="${COMPOSE_COPIED[*]-}"
{
  echo "created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "host=$(hostname)"
  echo "evolution_dir=${EVOLUTION_DIR}"
  echo "env_backed_up=${ENV_BACKED_UP}"
  echo "caddy_backed_up=${CADDY_BACKED_UP}"
  echo "compose_files=${compose_joined:-none}"
} > "${BDIR}/MANIFEST.txt"
chmod 600 "${BDIR}/MANIFEST.txt"

if [[ -f "${BDIR}/.env" ]]; then
  sha256sum "${BDIR}/.env" | awk '{print "env_sha256="$1}' >> "${BDIR}/MANIFEST.txt"
fi
for f in "${BDIR}"/docker-compose.yml "${BDIR}"/docker-compose.yaml "${BDIR}"/compose.yml "${BDIR}"/compose.yaml "${BDIR}/Caddyfile"; do
  if [[ -f "${f}" ]]; then
    sha256sum "${f}" | awk -v n="$(basename "${f}")" '{print n"_sha256="$1}' >> "${BDIR}/MANIFEST.txt"
  fi
done
chmod 600 "${BDIR}/MANIFEST.txt"
chmod 700 "${BDIR}"

# ---------------------------------------------------------------------------
# Python helpers (stdlib only). Nunca imprime secrets.
# ---------------------------------------------------------------------------
export EVOLUTION_DIR DOMAIN BACKEND INSTANCE CADDYFILE EXPECTED_PROXY BDIR

python3 - <<'PY'
import json, os, re, socket, subprocess, sys, urllib.request
from urllib.parse import urlparse

EVOLUTION_DIR = os.environ["EVOLUTION_DIR"]
DOMAIN = os.environ["DOMAIN"]
BACKEND = os.environ["BACKEND"]
INSTANCE = os.environ["INSTANCE"]
CADDYFILE = os.environ["CADDYFILE"]
EXPECTED_PROXY = os.environ["EXPECTED_PROXY"]

SECRET_KEY_RE = re.compile(
    r"(pass(word)?|secret|token|api[_-]?key|authentication|credential|private|database.*uri|connection_uri|postgres|redis_uri|access_key)",
    re.I,
)

def run(args, timeout=20):
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout or "", p.stderr or ""
    except Exception as e:
        return 1, "", str(e)

def print_kv(k, v):
    print(f"{k}={v}")

def is_public_url(value):
    if not value or not isinstance(value, str):
        return False
    raw = value.strip().strip("'").strip('"')
    if not raw or any(ch.isspace() for ch in raw):
        return False
    if "@" in raw.split("://", 1)[-1].split("/")[0]:
        return False
    try:
        u = urlparse(raw if "://" in raw else "http://" + raw)
    except Exception:
        return False
    if u.scheme not in ("http", "https"):
        return False
    if u.username or u.password:
        return False
    host = (u.hostname or "").strip().lower()
    if not host:
        return False
    if SECRET_KEY_RE.search(raw):
        return False
    if host in {"localhost", "127.0.0.1", "::1"}:
        return True
    return True

def read_env_map(path):
    out = {}
    try:
        text = open(path, encoding="utf-8", errors="ignore").read()
    except Exception:
        return out
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        k = k.strip()
        v = v.strip().strip("'").strip('"')
        if k:
            out[k] = v
    return out

def parse_compose_text(text):
    """Indent-aware-enough scan. Does not interpolate env. Never returns secret values."""
    services = {}
    current = None
    section = None
    in_services = False
    services_indent = None
    svc_indent = None
    for raw in text.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        line = raw.rstrip()
        stripped = line.strip()
        if stripped == "services:":
            in_services = True
            services_indent = indent
            current = None
            continue
        if in_services and services_indent is not None and indent <= services_indent and stripped.endswith(":") and stripped != "services:":
            in_services = False
            current = None
        if not in_services:
            continue
        if services_indent is not None and indent == services_indent + 2 and stripped.endswith(":") and not stripped.startswith("-"):
            current = stripped[:-1]
            services[current] = {
                "image": None,
                "container_name": None,
                "restart": None,
                "env_file": [],
                "depends_on": [],
                "ports": [],
                "volumes": [],
                "healthcheck": False,
                "server_url_raw": [],
            }
            svc_indent = indent
            section = None
            continue
        if not current:
            continue
        if svc_indent is not None and indent == svc_indent + 2:
            key = stripped.split(":", 1)[0].strip()
            section = key
            rest = stripped.split(":", 1)[1].strip() if ":" in stripped else ""
            if key == "image" and rest:
                services[current]["image"] = rest.strip("'\"")
            elif key == "container_name" and rest:
                services[current]["container_name"] = rest.strip("'\"")
            elif key == "restart" and rest:
                services[current]["restart"] = rest.strip("'\"")
            elif key == "healthcheck":
                services[current]["healthcheck"] = True
            elif key == "env_file" and rest and rest not in ("", "|", ">", "[]"):
                services[current]["env_file"].append(rest.strip("- ").strip("'\""))
        if section == "depends_on" and stripped.startswith("- "):
            services[current]["depends_on"].append(stripped[2:].split(":")[0].strip().strip("'\""))
        if section == "ports" and stripped.startswith("- "):
            services[current]["ports"].append(stripped[2:].strip().strip("'\""))
        if section == "volumes" and stripped.startswith("- "):
            vol = stripped[2:].strip().strip("'\"")
            # keep mapping source:dest only (no driver opts)
            services[current]["volumes"].append(vol.split(":")[0] if ":" in vol else vol)
        if section == "env_file" and stripped.startswith("- "):
            services[current]["env_file"].append(stripped[2:].strip().strip("'\""))
        if "SERVER_URL" in stripped:
            services[current]["server_url_raw"].append(stripped)
        if section == "healthcheck":
            services[current]["healthcheck"] = True
    return services

def compose_candidates():
    names = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]
    found = []
    for n in names:
        p = os.path.join(EVOLUTION_DIR, n)
        if os.path.isfile(p):
            found.append(n)
    return found

print("=== STAGE1_BEGIN ===")
print_kv("BACKUP_DIR", os.environ.get("BDIR", ""))
print_kv("EVOLUTION_DIR", EVOLUTION_DIR)

# --- Compose files on disk ---
files = compose_candidates()
print_kv("COMPOSE_FILES_ON_DISK", ",".join(files) if files else "none")

compose_from_labels = []
rc, out, err = run(["docker", "ps", "-q"])
cids = [x for x in out.split() if x]
inspect = []
if cids:
    rc, out, err = run(["docker", "inspect", *cids])
    if rc == 0:
        try:
            inspect = json.loads(out)
        except Exception:
            inspect = []
    else:
        print_kv("DOCKER_INSPECT", "failed")

project_files = set()
services_running = []
for c in inspect:
    labels = c.get("Config", {}).get("Labels") or {}
    cfg = labels.get("com.docker.compose.project.config_files") or ""
    svc = labels.get("com.docker.compose.service") or ""
    proj = labels.get("com.docker.compose.project") or ""
    workdir = labels.get("com.docker.compose.project.working_dir") or ""
    name = (c.get("Name") or "").lstrip("/")
    image = c.get("Config", {}).get("Image") or ""
    if cfg:
        for part in cfg.split(","):
            project_files.add(part.strip())
    rp = c.get("HostConfig", {}).get("RestartPolicy") or {}
    health = ((c.get("State") or {}).get("Health") or {}).get("Status") or "none"
    mounts = []
    for m in c.get("Mounts") or []:
        src = m.get("Name") or m.get("Source") or ""
        dst = m.get("Destination") or ""
        mtype = m.get("Type") or ""
        mounts.append(f"{mtype}:{src}->{dst}")
    ports = []
    for p, confs in (c.get("NetworkSettings", {}).get("Ports") or {}).items():
        if not confs:
            ports.append(f"{p}->(unpublished)")
            continue
        for conf in confs:
            hip = conf.get("HostIp") or "0.0.0.0"
            hp = conf.get("HostPort") or ""
            ports.append(f"{hip}:{hp}->{p}")
    services_running.append({
        "name": name,
        "service": svc,
        "project": proj,
        "workdir": workdir,
        "image": image,
        "restart": rp.get("Name") or "",
        "health": health,
        "status": (c.get("State") or {}).get("Status") or "",
        "mounts": mounts,
        "ports": ports,
        "env_server_url": None,
        "is_evolution": bool(re.search(r"evolution", (image + " " + name + " " + svc), re.I))
            and not bool(re.search(r"postgres|redis|caddy", (image + " " + name + " " + svc), re.I)),
    })
    env_list = c.get("Config", {}).get("Env") or []
    for item in env_list:
        if item.startswith("SERVER_URL="):
            val = item.split("=", 1)[1]
            services_running[-1]["env_server_url"] = val if is_public_url(val) else "redacted_non_public"

print("=== RUNNING_CONTAINERS ===")
if not services_running:
    print_kv("CONTAINERS", "none_or_inspect_failed")
for s in services_running:
    print_kv("CONTAINER", s["name"])
    print_kv("COMPOSE_SERVICE", s["service"] or "unlabeled")
    print_kv("COMPOSE_PROJECT", s["project"] or "unknown")
    print_kv("COMPOSE_WORKDIR", s["workdir"] or "unknown")
    print_kv("IMAGE", s["image"])
    print_kv("STATUS", s["status"])
    print_kv("RESTART_POLICY", s["restart"] or "unspecified")
    print_kv("HEALTH", s["health"])
    print_kv("PORTS", ";".join(s["ports"]) if s["ports"] else "none")
    print_kv("VOLUMES", ";".join(s["mounts"]) if s["mounts"] else "none")
    print_kv("IS_EVOLUTION_CANDIDATE", "yes" if s["is_evolution"] else "no")
    if s["env_server_url"] is not None:
        print_kv("CONTAINER_SERVER_URL", s["env_server_url"])
    print("---")

print("=== COMPOSE_USED ===")
if project_files:
    print_kv("COMPOSE_CONFIG_FILES_LABEL", ",".join(sorted(project_files)))
else:
    print_kv("COMPOSE_CONFIG_FILES_LABEL", "unlabeled")
    if files:
        print_kv("COMPOSE_FALLBACK_DISK", ",".join(files))

# Parse compose files from disk (no interpolation)
print("=== COMPOSE_DISK_PARSE ===")
all_svc = {}
all_server_url_lines = []
for n in files:
    path = os.path.join(EVOLUTION_DIR, n)
    try:
        text = open(path, encoding="utf-8", errors="ignore").read()
    except Exception:
        continue
    parsed = parse_compose_text(text)
    all_svc[n] = parsed
    for svc_name, meta in parsed.items():
        print_kv("FILE_SERVICE", f"{n}:{svc_name}")
        print_kv("IMAGE", meta["image"] or "unset")
        print_kv("CONTAINER_NAME", meta["container_name"] or "unset")
        print_kv("RESTART", meta["restart"] or "unset")
        print_kv("DEPENDS_ON", ",".join(meta["depends_on"]) if meta["depends_on"] else "none")
        print_kv("PORTS", ",".join(meta["ports"]) if meta["ports"] else "none")
        print_kv("VOLUME_REFS", ",".join(meta["volumes"]) if meta["volumes"] else "none")
        print_kv("ENV_FILE", ",".join(meta["env_file"]) if meta["env_file"] else "none")
        print_kv("HEALTHCHECK_BLOCK", "yes" if meta["healthcheck"] else "no")
        for line in meta["server_url_raw"]:
            # print only if the line itself is not a secret assignment
            if SECRET_KEY_RE.search(line) and "SERVER_URL" not in line.split("=", 1)[0]:
                continue
            all_server_url_lines.append(f"{n}:{svc_name}:{line.strip()}")
        print("---")

print("=== SERVER_URL ===")
env_map = read_env_map(os.path.join(EVOLUTION_DIR, ".env"))
env_keys = sorted(env_map.keys())
print_kv("ENV_KEY_COUNT", str(len(env_keys)))
print_kv("ENV_HAS_SERVER_URL", "yes" if "SERVER_URL" in env_map else "no")
if "SERVER_URL" in env_map:
    val = env_map["SERVER_URL"]
    if is_public_url(val):
        print_kv("ENV_SERVER_URL", val.strip().strip("'").strip('"'))
        print_kv("ENV_SERVER_URL_KIND", "public_url")
    else:
        print_kv("ENV_SERVER_URL", "redacted_non_public")
        print_kv("ENV_SERVER_URL_KIND", "not_safe_to_print")
else:
    print_kv("ENV_SERVER_URL", "missing")

if all_server_url_lines:
    for i, line in enumerate(all_server_url_lines, 1):
        print_kv(f"COMPOSE_SERVER_URL_LINE_{i}", line)
    print_kv("SERVER_URL_IN_COMPOSE", "yes")
else:
    print_kv("SERVER_URL_IN_COMPOSE", "no")

live_urls = [s["env_server_url"] for s in services_running if s.get("env_server_url")]
print_kv("SERVER_URL_IN_RUNNING_CONTAINER", "yes" if live_urls else "no")

evo_candidates = [s for s in services_running if s["is_evolution"]]
port_8080 = []
for s in services_running:
    for p in s["ports"]:
        if re.search(r":8080->|:8080/|8080/tcp", p):
            port_8080.append(f"{s['name']}:{p}")
print("=== PORT_8080 ===")
print_kv("DOCKER_PUBLISH_8080", ";".join(port_8080) if port_8080 else "not_in_inspect")
if port_8080:
    joined = ";".join(port_8080)
    bound_loop = "127.0.0.1:8080" in joined
    bound_all = ("0.0.0.0:8080" in joined) or (joined.startswith("[::]:8080") or ";[::]:8080" in joined)
    if bound_loop and not bound_all:
        print_kv("PORT_8080_BIND", "loopback_only")
    elif bound_all:
        print_kv("PORT_8080_BIND", "public_0.0.0.0")
    else:
        print_kv("PORT_8080_BIND", "see_DOCKER_PUBLISH_8080")

print("=== EVOLUTION_SERVICE ===")
if evo_candidates:
    primary = evo_candidates[0]
    print_kv("EVOLUTION_CONTAINER", primary["name"])
    print_kv("EVOLUTION_COMPOSE_SERVICE", primary["service"] or "unlabeled")
    print_kv("EVOLUTION_CANDIDATES", ",".join(s["name"] for s in evo_candidates))
else:
    print_kv("EVOLUTION_CONTAINER", "unidentified")
    print_kv("EVOLUTION_COMPOSE_SERVICE", "unidentified")

# --- Caddy ---
print("=== CADDY ===")
rc, active, _ = run(["systemctl", "is-active", "caddy"])
rc, enabled, _ = run(["systemctl", "is-enabled", "caddy"])
print_kv("CADDY_ACTIVE", (active or "").strip() or "unknown")
print_kv("CADDY_ENABLED", (enabled or "").strip() or "unknown")
caddy_ok = (active or "").strip() == "active"
proxy_ok = False
caddy_text = ""
try:
    caddy_text = open(CADDYFILE, encoding="utf-8", errors="ignore").read()
except Exception:
    caddy_text = ""
if caddy_text:
    # print Caddyfile: it must not contain secrets; skip lines that look like keys
    print("=== CADDYFILE ===")
    for line in caddy_text.splitlines():
        if SECRET_KEY_RE.search(line) and "reverse_proxy" not in line:
            print("# [redacted-line]")
            continue
        print(line)
    if EXPECTED_PROXY in caddy_text and "reverse_proxy" in caddy_text and DOMAIN.split(".")[0] in caddy_text:
        proxy_ok = True
print_kv("CADDY_PROXY_127_0_0_1_8080", "yes" if proxy_ok else "no")

# --- Evolution HTTP local + HTTPS (no send) ---
print("=== EVOLUTION_HTTP ===")

def http_get(url, headers=None, timeout=10):
    req = urllib.request.Request(url, headers=headers or {"Accept": "application/json"}, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read(4000).decode("utf-8", "ignore")
            return resp.status, body, dict(resp.headers)
    except Exception as e:
        code = getattr(getattr(e, "code", None), "real", None) if False else getattr(e, "code", None)
        return code or 0, str(e), {}

def summarize_welcome(label, url):
    status, body, hdrs = http_get(url)
    server = hdrs.get("Server") or hdrs.get("server") or ""
    powered = hdrs.get("X-Powered-By") or hdrs.get("x-powered-by") or ""
    print_kv(f"{label}_HTTP", str(status))
    if server:
        print_kv(f"{label}_SERVER", server)
    if powered:
        print_kv(f"{label}_POWERED_BY", powered)
    version = manager = client = None
    try:
        data = json.loads(body)
        version = data.get("version")
        manager = data.get("manager")
        client = data.get("clientName")
    except Exception:
        data = None
    if version:
        print_kv(f"{label}_VERSION", str(version))
    if client:
        print_kv(f"{label}_CLIENT", str(client))
    if manager and is_public_url(str(manager)):
        print_kv(f"{label}_MANAGER", str(manager))
    elif manager:
        print_kv(f"{label}_MANAGER", "redacted_non_public")
    return data

summarize_welcome("LOCAL", f"http://{BACKEND}/")
summarize_welcome("HTTPS", f"https://{DOMAIN}/")

# connectionState using key in-process only
print("=== INSTANCE ===")
key = None
for name in ("AUTHENTICATION_API_KEY", "EVOLUTION_API_KEY", "API_KEY", "WHATSAPP_EVOLUTION_API_KEY"):
    val = env_map.get(name)
    if val:
        key = val
        print_kv("API_KEY_SOURCE", name)
        break
if not key:
    print_kv("INSTANCE_STATE", "unavailable_no_key")
    print_kv("INSTANCE_CONNECTED", "no")
else:
    status, body, _ = http_get(
        f"http://{BACKEND}/instance/connectionState/{INSTANCE}",
        headers={"apikey": key, "Accept": "application/json"},
    )
    key = None
    print_kv("INSTANCE_HTTP", str(status))
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
    else:
        state = f"http_{status}"
    print_kv("INSTANCE_NAME", INSTANCE)
    print_kv("INSTANCE_STATE", state)
    print_kv("INSTANCE_CONNECTED", "yes" if state.lower() == "open" else "no")

print("=== GUARDS ===")
print_kv("DOCKER_RESTARTED", "no")
print_kv("FILES_MODIFIED", "no")
print_kv("PORT_8080_CLOSED", "no")
print_kv("WHATSAPP_SENT", "no")
print_kv("COMPOSE_CONFIG_USED", "no")
print("=== STAGE1_END ===")
PY

echo
echo "=== RESULTADO ==="
echo "BACKUP_DIR=${BDIR}"
echo "STAGE=1"
echo "MUTATED_EXISTING_FILES=no"
echo "RESTART=no"
echo "WHATSAPP_SENT=no"
echo "ETAPA2=not_executed"
echo "ETAPA3=not_executed"
