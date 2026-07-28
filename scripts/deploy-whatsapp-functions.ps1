#Requires -Version 5.1
<#
.SYNOPSIS
  Deploy seguro das Edge Functions WhatsApp/Evolution (Faith Brothers).

.DESCRIPTION
  - Project ref: wojqjxtaqjasnfhbotxi
  - Para se o projeto estiver INACTIVE
  - Nao imprime API key / secrets
  - Mantem WHATSAPP_SEND_ENABLED=false (nao altera secrets)
#>

$ErrorActionPreference = "Stop"

$projectRef = "wojqjxtaqjasnfhbotxi"
$rootDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $rootDir

$functions = @(
  "whatsapp-status",
  "send-whatsapp",
  "send-billing-whatsapp",
  "process-whatsapp-queue",
  "generate-monthly-billings"
)

function Write-Info([string]$Message) { Write-Host "[INFO]  $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "[OK]    $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host "[WARN]  $Message" -ForegroundColor Yellow }
function Write-Err([string]$Message) { Write-Host "[ERROR] $Message" -ForegroundColor Red }

Write-Host ""
Write-Host "=== deploy-whatsapp-functions ===" -ForegroundColor White
Write-Host "Project: $projectRef"
Write-Warn "Este script NAO altera secrets e NAO ativa envio real."
Write-Host ""

# 1) supabase CLI
if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
  Write-Err "CLI supabase nao encontrada no PATH. Instale e autentique antes."
  exit 1
}
Write-Ok "supabase CLI encontrada."

# 2) Docker
Write-Info "Validando Docker..."
$dockerOk = $false
try {
  $dockerInfo = & docker info 2>&1 | Out-String
  if ($LASTEXITCODE -eq 0) {
    $dockerOk = $true
    Write-Ok "Docker esta rodando."
  }
  else {
    Write-Err "Docker nao respondeu corretamente."
    Write-Host $dockerInfo
  }
}
catch {
  Write-Err ("Docker indisponivel: " + $_.Exception.Message)
}
if (-not $dockerOk) {
  Write-Err "Inicie o Docker Desktop e tente novamente."
  exit 1
}

# 3) Projeto ativo?
Write-Info "Consultando functions list no projeto $projectRef..."
$listOut = ""
$listExit = 0
try {
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $listOut = & supabase functions list --project-ref $projectRef 2>&1 | Out-String
  $listExit = $LASTEXITCODE
  $ErrorActionPreference = $prevEap
}
catch {
  $listOut = $_.Exception.Message
  $listExit = 1
}

if ($listOut -match "INACTIVE") {
  Write-Err "Projeto Supabase esta INACTIVE. Reative no painel antes de deployar."
  Write-Host $listOut
  exit 1
}

if ($listExit -ne 0) {
  Write-Err "Falha ao listar functions do projeto (exit=$listExit)."
  Write-Host $listOut
  if ($listOut -match "INACTIVE") {
    Write-Err "Projeto Supabase esta INACTIVE. Reative no painel antes de deployar."
  }
  else {
    Write-Warn "Confirme login (supabase login) e status do projeto no Dashboard."
  }
  exit 1
}

Write-Ok "Projeto respondeu ao functions list (nao INACTIVE nesta consulta)."

# 4) Deploy na ordem
foreach ($fn in $functions) {
  Write-Host ""
  Write-Info "Deploy: $fn"
  & supabase functions deploy $fn --project-ref $projectRef
  if ($LASTEXITCODE -ne 0) {
    Write-Err "Deploy falhou em $fn (exit=$LASTEXITCODE). Abortando."
    exit $LASTEXITCODE
  }
  Write-Ok "Deploy OK: $fn"
}

# 5) Secrets list (nomes; CLI nao deve imprimir valores)
Write-Host ""
Write-Info "Listando secrets (somente metadados/nomes; valores nao devem aparecer)..."
& supabase secrets list --project-ref $projectRef
if ($LASTEXITCODE -ne 0) {
  Write-Warn "secrets list falhou (exit=$LASTEXITCODE). Deploy das functions pode ter concluido mesmo assim."
  exit $LASTEXITCODE
}

Write-Host ""
Write-Ok "Deploy WhatsApp/Evolution concluido."
Write-Warn "Confirme no Dashboard: WHATSAPP_SEND_ENABLED=false"
Write-Host ""
exit 0
