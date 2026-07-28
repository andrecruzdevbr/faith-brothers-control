#Requires -Version 5.1
<#
.SYNOPSIS
  Verifica Evolution VPS Faith Brothers (sem imprimir API key).

.DESCRIPTION
  - Base: http://2.24.108.128:8080
  - Instancia: FaithBrothersControl
  - API key: env local OU SSH opcional em /opt/evolution-faithbrothers/.env
  - Nao altera VPS, volumes ou instancias
#>

$ErrorActionPreference = "Stop"

$baseUrl = "http://2.24.108.128:8080"
$instance = "FaithBrothersControl"
$sshHost = $env:EVOLUTION_SSH_HOST
$sshUser = $env:EVOLUTION_SSH_USER
if ([string]::IsNullOrWhiteSpace($sshUser)) { $sshUser = "root" }
$remoteEnvPath = "/opt/evolution-faithbrothers/.env"

function Write-Info([string]$Message) { Write-Host "[INFO]  $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "[OK]    $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host "[WARN]  $Message" -ForegroundColor Yellow }
function Write-Err([string]$Message) { Write-Host "[ERROR] $Message" -ForegroundColor Red }

function Get-ApiKeyFromText {
  param([string]$Text)
  $names = @("AUTHENTICATION_API_KEY", "WHATSAPP_EVOLUTION_API_KEY", "EVOLUTION_API_KEY", "API_KEY")
  foreach ($line in ($Text -split "`n")) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
    foreach ($name in $names) {
      if ($trimmed -match ("^\s*" + [regex]::Escape($name) + "\s*=\s*(.*)$")) {
        $raw = $Matches[1].Trim()
        $dq = [char]34
        $sq = [char]39
        if (($raw.StartsWith([string]$dq) -and $raw.EndsWith([string]$dq)) -or
            ($raw.StartsWith([string]$sq) -and $raw.EndsWith([string]$sq))) {
          $raw = $raw.Substring(1, $raw.Length - 2)
        }
        if (-not [string]::IsNullOrWhiteSpace($raw)) {
          return @{ Name = $name; Value = $raw }
        }
      }
    }
  }
  return $null
}

function Get-PropertySafe {
  param($Object, [string]$Name)
  if ($null -eq $Object) { return $null }
  $prop = $Object.PSObject.Properties[$Name]
  if ($null -eq $prop) { return $null }
  return $prop.Value
}

Write-Host ""
Write-Host "=== check-whatsapp-evolution-vps ===" -ForegroundColor White
Write-Host "Base URL : $baseUrl"
Write-Host "Instance : $instance"
Write-Warn "API key nunca sera impressa."
Write-Host ""

# 1) Health / online
Write-Info "Consultando Evolution root..."
$online = $false
$version = $null
try {
  $healthText = & curl.exe -s --max-time 15 $baseUrl 2>$null
  if ($healthText -match "Welcome to the Evolution API" -or $healthText -match '"status"\s*:\s*200') {
    $online = $true
    Write-Ok "Evolution API online"
    try {
      $healthObj = $healthText | ConvertFrom-Json
      $version = $healthObj.version
      if ($version) { Write-Host "Versao   : $version" }
      if ($healthObj.manager) { Write-Host "Manager  : $($healthObj.manager)" }
    }
    catch { }
  }
  else {
    Write-Err "Evolution API offline ou resposta inesperada."
    Write-Host $healthText
  }
}
catch {
  Write-Err ("Falha ao contatar Evolution: " + $_.Exception.Message)
}

if (-not $online) {
  Write-Host ""
  Write-Host "=== RESULTADO ===" -ForegroundColor White
  Write-Host "Evolution API : offline"
  Write-Host "Instance      : $instance"
  Write-Host "State         : (nao consultado)"
  Write-Host "Open          : False"
  exit 1
}

# 2) Resolver API key sem imprimir
$apiKey = $null
$keySource = $null

foreach ($envName in @("WHATSAPP_EVOLUTION_API_KEY", "EVOLUTION_API_KEY", "AUTHENTICATION_API_KEY")) {
  $fromEnv = [Environment]::GetEnvironmentVariable($envName)
  if (-not [string]::IsNullOrWhiteSpace($fromEnv)) {
    $apiKey = $fromEnv
    $keySource = "env:$envName"
    break
  }
}

if (-not $apiKey -and -not [string]::IsNullOrWhiteSpace($sshHost)) {
  Write-Info "API key nao encontrada no ambiente. Tentando SSH ($sshUser@$sshHost)..."
  if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    Write-Err "ssh nao encontrado no PATH."
    exit 1
  }
  $remoteCmd = "grep -E '^(AUTHENTICATION_API_KEY|API_KEY|EVOLUTION_API_KEY)=' $remoteEnvPath"
  $remoteText = & ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$sshUser@$sshHost" $remoteCmd 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    Write-Err "Falha no SSH ao ler .env remoto (exit=$LASTEXITCODE)."
    Write-Warn "Defina EVOLUTION_SSH_HOST/EVOLUTION_SSH_USER ou exporte WHATSAPP_EVOLUTION_API_KEY no shell."
    exit 1
  }
  $parsed = Get-ApiKeyFromText -Text $remoteText
  if ($null -eq $parsed) {
    Write-Err "Nao foi possivel extrair API key do .env remoto."
    exit 1
  }
  $apiKey = $parsed.Value
  $keySource = "ssh:$($parsed.Name)"
}

if (-not $apiKey) {
  Write-Err "API key nao disponivel."
  Write-Warn "Opcoes:"
  Write-Warn "  1) `$env:WHATSAPP_EVOLUTION_API_KEY = '<chave>'  (somente no shell; nao commit)"
  Write-Warn "  2) `$env:EVOLUTION_SSH_HOST = '<ip-ou-host>' e rode de novo (le /opt/evolution-faithbrothers/.env)"
  exit 1
}

Write-Ok "API key carregada ($keySource). Valor NAO sera exibido."

# 3) connectionState
Write-Info "Consultando /instance/connectionState/$instance ..."
$state = $null
$connected = $false
try {
  $headers = @{ apikey = $apiKey }
  $statePayload = Invoke-RestMethod -Method GET -Uri "$baseUrl/instance/connectionState/$instance" -Headers $headers -TimeoutSec 30
  $state = Get-PropertySafe (Get-PropertySafe $statePayload "instance") "state"
  if (-not $state) { $state = Get-PropertySafe $statePayload "state" }
  if ($state) {
    $connected = ([string]$state).ToLowerInvariant() -eq "open"
  }
}
catch {
  $statusCode = $null
  if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
    $statusCode = [int]$_.Exception.Response.StatusCode
  }
  if ($statusCode -eq 401) {
    Write-Err "401 Unauthorized - API key incorreta para a VPS."
  }
  else {
    Write-Err ("Falha connectionState: " + $_.Exception.Message)
  }
  exit 1
}

Write-Host ""
Write-Host "=== RESULTADO ===" -ForegroundColor White
Write-Host "Evolution API : online"
if ($version) { Write-Host "Versao        : $version" }
Write-Host "Instance      : $instance"
Write-Host ("State         : " + $(if ($state) { $state } else { "(desconhecido)" }))
Write-Host "Open          : $connected"
if ($connected) {
  Write-Ok "Instancia FaithBrothersControl conectada (state=open)."
}
else {
  Write-Warn "Instancia NAO esta open. Escaneie QR / aguarde pareamento."
}
Write-Host ""
exit 0
