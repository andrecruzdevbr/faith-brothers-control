<#
.SYNOPSIS
  Consulta somente leitura do estado prepaid/billing em produção (PostgREST).

.DESCRIPTION
  Projeto fixo: faith-brothers-prod (wojqjxtaqjasnfhbotxi).
  Preferência: login administrativo (WhatsApp + senha) → JWT → PostgREST.
  Fallback opcional: psql via connection string (senha pedida por Read-Host).

  NÃO altera dados. NÃO usa service role em arquivo versionado.
  NÃO usa o subcomando frágil `supabase db query` como caminho principal.

.EXAMPLE
  powershell -NoProfile -File scripts/query-production-state.ps1

.EXAMPLE
  $env:FB_ADMIN_WHATSAPP = "31999999999"
  $env:FB_ADMIN_PASSWORD = "***"   # somente sessão local; nunca commit
  powershell -NoProfile -File scripts/query-production-state.ps1
#>

[CmdletBinding()]
param(
  [string]$AdminWhatsapp = $env:FB_ADMIN_WHATSAPP,
  [string]$AdminPassword = $env:FB_ADMIN_PASSWORD,
  [switch]$UsePsqlFallback,
  # Usa `supabase projects api-keys` (CLI já autenticada). NÃO imprime a chave.
  [switch]$UseLinkedServiceRole
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ExpectedProjectRef = "wojqjxtaqjasnfhbotxi"
$ExpectedUrlHost = "$ExpectedProjectRef.supabase.co"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$EnvFile = Join-Path $RepoRoot ".env"

function Write-Section([string]$Title) {
  Write-Host ""
  Write-Host "=== $Title ===" -ForegroundColor Cyan
}

function Get-DotEnvValue([string]$Path, [string]$Key) {
  if (-not (Test-Path $Path)) { return $null }
  foreach ($line in Get-Content $Path) {
    $trim = $line.Trim()
    if (-not $trim -or $trim.StartsWith("#")) { continue }
    $parts = $trim -split "=", 2
    if ($parts.Count -ne 2) { continue }
    if ($parts[0].Trim() -ne $Key) { continue }
    return $parts[1].Trim().Trim('"').Trim("'")
  }
  return $null
}

function Normalize-Whatsapp([string]$Raw) {
  $digits = ($Raw -replace "\D", "")
  if ($digits.Length -ge 12 -and $digits.StartsWith("55")) {
    return $digits.Substring(2)
  }
  return $digits
}

function ConvertTo-PrettyJson($Object) {
  if ($null -eq $Object) { return "[]" }
  return ($Object | ConvertTo-Json -Depth 8)
}

function Sanitize-CliText([string]$Text) {
  if ([string]::IsNullOrEmpty($Text)) { return "" }
  # Mascara JWTs / chaves longas eventualmente vazadas no stderr
  $sanitized = [regex]::Replace($Text, 'eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}', 'eyJ***REDACTED***')
  $sanitized = [regex]::Replace($sanitized, 'sb_secret_[A-Za-z0-9_\-]+', 'sb_secret_***REDACTED***')
  $sanitized = [regex]::Replace($sanitized, '("api_key"\s*:\s*")[^"]+', '$1***REDACTED***')
  return $sanitized
}

function Test-IsIgnorableCliNoise([string]$Text) {
  if ([string]::IsNullOrWhiteSpace($Text)) { return $true }
  $known = @(
    'Timeout while shutting down PostHog',
    'Some events may not have been sent',
    'Try rerunning the command with --debug'
  )
  $remaining = $Text
  foreach ($k in $known) {
    $remaining = $remaining -replace [regex]::Escape($k), ''
  }
  # Remove JSON PostHog wrapper e ruído comum
  $remaining = $remaining -replace '\{\s*"_tag"\s*:\s*"Error"[^}]*\}', ''
  $remaining = $remaining -replace 'npm warn[^\r\n]*', ''
  $remaining = $remaining.Trim()
  return [string]::IsNullOrWhiteSpace($remaining)
}

function Invoke-SupabaseCliCapture {
  param(
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [int]$TimeoutMs = 120000
  )

  $stdoutFile = [System.IO.Path]::GetTempFileName()
  $stderrFile = [System.IO.Path]::GetTempFileName()
  try {
    # No Windows, npx costuma ser .cmd — Start-Process direto falha; use cmd /c.
    $argString = ($ArgumentList | ForEach-Object {
      if ($_ -match '\s') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
    }) -join " "

    $proc = Start-Process -FilePath "cmd.exe" `
      -ArgumentList @("/d", "/c", $argString) `
      -WorkingDirectory $RepoRoot.Path `
      -NoNewWindow `
      -PassThru `
      -RedirectStandardOutput $stdoutFile `
      -RedirectStandardError $stderrFile

    $finished = $proc.WaitForExit($TimeoutMs)
    if (-not $finished) {
      try { $proc.Kill() } catch { }
      throw "Timeout (${TimeoutMs}ms) ao executar: $argString"
    }

    $exitCode = $proc.ExitCode
    $stdout = Get-Content -Path $stdoutFile -Raw -ErrorAction SilentlyContinue
    $stderr = Get-Content -Path $stderrFile -Raw -ErrorAction SilentlyContinue
    if ($null -eq $stdout) { $stdout = "" }
    if ($null -eq $stderr) { $stderr = "" }

    return [pscustomobject]@{
      ExitCode = $exitCode
      StdOut   = $stdout
      StdErr   = $stderr
    }
  }
  finally {
    Remove-Item -Path $stdoutFile, $stderrFile -Force -ErrorAction SilentlyContinue
  }
}

function Get-ServiceRoleKeyFromStdout([string]$StdoutOriginal) {
  if ([string]::IsNullOrWhiteSpace($StdoutOriginal)) { return $null }

  # Formato tabela da CLI: "service_role | eyJ..." ou "service_role | sb_secret_..."
  $tableMatch = [regex]::Match(
    $StdoutOriginal,
    '(?im)^\s*service_role\s*\|\s*([A-Za-z0-9_\-\.]+)\s*$'
  )
  if ($tableMatch.Success) {
    return $tableMatch.Groups[1].Value.Trim()
  }

  # Formato solto na mesma linha (JWT legado ou sb_secret)
  $looseMatch = [regex]::Match(
    $StdoutOriginal,
    '(?is)service_role\s*[|:\s]+((?:eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)|(?:sb_secret_[A-Za-z0-9_\-]+))'
  )
  if ($looseMatch.Success) {
    return $looseMatch.Groups[1].Value.Trim()
  }

  # Formato JSON {"keys":[...]}
  if ($StdoutOriginal -match '"keys"') {
    $jsonStart = $StdoutOriginal.IndexOf('{"keys"')
    if ($jsonStart -lt 0) {
      $m = [regex]::Match($StdoutOriginal, '\{\s*"keys"\s*:')
      if ($m.Success) { $jsonStart = $m.Index }
    }
    if ($jsonStart -ge 0) {
      $jsonTail = $StdoutOriginal.Substring($jsonStart)
      $tagIdx = $jsonTail.IndexOf('{"_tag"')
      if ($tagIdx -gt 0) { $jsonTail = $jsonTail.Substring(0, $tagIdx) }
      try {
        $parsed = $jsonTail | ConvertFrom-Json
        $service = @(
          $parsed.keys | Where-Object { $_.id -eq "service_role" -or $_.name -eq "service_role" }
        ) | Select-Object -First 1
        if ($service -and $service.api_key) {
          return ([string]$service.api_key).Trim()
        }
      }
      catch { }
    }
  }

  return $null
}

function Get-ServiceRoleKeyFromCli {
  param([Parameter(Mandatory = $true)][string]$ProjectRef)

  $result = Invoke-SupabaseCliCapture -ArgumentList @(
    "npx", "supabase", "projects", "api-keys", "--project-ref", $ProjectRef
  )

  # Extrair da saída ORIGINAL (antes de qualquer sanitização)
  $key = Get-ServiceRoleKeyFromStdout -StdoutOriginal $result.StdOut

  if (-not [string]::IsNullOrWhiteSpace($key)) {
    $exitDisplay = if ($null -eq $result.ExitCode -or "$($result.ExitCode)" -eq "") { "(nulo/vazio - ignorado)" } else { "$($result.ExitCode)" }
    if ($null -eq $result.ExitCode -or "$($result.ExitCode)" -eq "" -or $result.ExitCode -ne 0) {
      if (Test-IsIgnorableCliNoise $result.StdErr) {
        Write-Host "Aviso CLI ignorado (PostHog/exit=$exitDisplay); service_role presente no stdout." -ForegroundColor DarkYellow
      }
      elseif ($null -eq $result.ExitCode -or "$($result.ExitCode)" -eq "") {
        Write-Host "ExitCode nulo/vazio; service_role valida no stdout - seguindo." -ForegroundColor DarkYellow
      }
      else {
        # Ainda ha service_role valida: prioriza sucesso pelo stdout, avisa stderr sanitizado
        Write-Host "ExitCode=$exitDisplay com service_role valida; stderr nao critico (sanitizado):" -ForegroundColor DarkYellow
        Write-Host (Sanitize-CliText $result.StdErr)
      }
    }

    $prefix = $key.Substring(0, [Math]::Min(10, $key.Length))
    Write-Host "service_role obtida (prefixo=$prefix...; completa NAO exibida)." -ForegroundColor Green
    return $key
  }

  # Falha: sem service_role no stdout — só agora reporta exit/stderr sanitizados
  $exitDisplay = if ($null -eq $result.ExitCode -or "$($result.ExitCode)" -eq "") { "(nulo/vazio)" } else { "$($result.ExitCode)" }
  throw @"
Falha: stdout nao contem service_role valida.
ExitCode: $exitDisplay
Stdout (sanitizado):
$(Sanitize-CliText $result.StdOut)
Stderr (sanitizado):
$(Sanitize-CliText $result.StdErr)
"@
}

function Invoke-PostgrestGet {
  param(
    [Parameter(Mandatory = $true)][string]$RestBase,
    [Parameter(Mandatory = $true)][string]$AnonKey,
    [Parameter(Mandatory = $true)][string]$AccessToken,
    [Parameter(Mandatory = $true)][string]$PathAndQuery,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $uri = "$RestBase/$PathAndQuery"
  try {
    $response = Invoke-RestMethod -Method Get -Uri $uri -TimeoutSec 20 -Headers @{
      apikey        = $AnonKey
      Authorization = "Bearer $AccessToken"
      Accept        = "application/json"
    }
    return $response
  }
  catch {
    $status = $null
    $body = $null
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
      try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $body = $reader.ReadToEnd()
      }
      catch { }
    }
    $bodySafe = Sanitize-CliText ([string]$body)
    if ($status -eq 404 -or ($bodySafe -match "does not exist|Could not find")) {
      throw "Tabela/coluna ausente ao consultar ${Label}. Detalhe: $bodySafe"
    }
    if ($status -eq 401 -or $status -eq 403) {
      throw "Acesso negado ao consultar ${Label} (HTTP $status). Confirme login admin e RLS. Detalhe: $bodySafe"
    }
    throw "Falha ao consultar ${Label}: $($_.Exception.Message) $bodySafe"
  }
}

Write-Section "1) Carregar configuração pública"
$supabaseUrl = Get-DotEnvValue $EnvFile "VITE_SUPABASE_URL"
$projectId = Get-DotEnvValue $EnvFile "VITE_SUPABASE_PROJECT_ID"
$anonKey = Get-DotEnvValue $EnvFile "VITE_SUPABASE_PUBLISHABLE_KEY"
if (-not $anonKey) {
  $anonKey = Get-DotEnvValue $EnvFile "VITE_SUPABASE_ANON_KEY"
}

if (-not $supabaseUrl) {
  $supabaseUrl = Read-Host "VITE_SUPABASE_URL (ex: https://$ExpectedProjectRef.supabase.co)"
}
if (-not $anonKey) {
  $anonKey = Read-Host "VITE_SUPABASE_PUBLISHABLE_KEY (chave pública anon)"
}
if (-not $projectId) {
  $projectId = $ExpectedProjectRef
}

$supabaseUrl = $supabaseUrl.TrimEnd("/")
if ($supabaseUrl -notmatch [regex]::Escape($ExpectedUrlHost) -or $projectId -ne $ExpectedProjectRef) {
  throw @"
Projeto incorreto.
Esperado: $ExpectedProjectRef ($ExpectedUrlHost)
Recebido: projectId=$projectId url=$supabaseUrl
"@
}

Write-Host "Projeto validado: $projectId" -ForegroundColor Green
Write-Host "URL OK: $supabaseUrl"
Write-Host "Chave pública carregada: $($anonKey.Substring(0, [Math]::Min(12, $anonKey.Length)))..."

$restBase = "$supabaseUrl/rest/v1"
$authBase = "$supabaseUrl/auth/v1"

if ($UsePsqlFallback) {
  Write-Section "2) Fallback psql (somente leitura)"
  $dbPassword = Read-Host "Senha do banco Postgres (Dashboard → Database) " -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($dbPassword)
  try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) | Out-Null
  }
  if (-not $plain) { throw "Senha do banco vazia." }

  $encoded = [Uri]::EscapeDataString($plain)
  $dbUrl = "postgresql://postgres.${ExpectedProjectRef}:${encoded}@aws-1-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require"
  $psql = Get-Command psql -ErrorAction SilentlyContinue
  if (-not $psql) {
    throw "psql não encontrado no PATH. Instale PostgreSQL client ou rode sem -UsePsqlFallback."
  }

  $sql = @"
select id, student_id, family_group_id, plan_id, starts_on, ends_on, payment_status, contract_status, total_amount
from public.student_contracts
order by created_at;
select student_id, reference_month, status, amount, asaas_payment_id
from public.billings
order by student_id, reference_month;
select student_id, reference_month, status, source
from public.student_contract_months
order by student_id, reference_month;
"@
  $sql | & psql $dbUrl -v ON_ERROR_STOP=1
  Write-Host ""
  Write-Host "Escrita realizada: NÃO (somente SELECT via psql)." -ForegroundColor Green
  exit 0
}

Write-Section "2) Autenticação"
$accessToken = $null
$anonOrServiceKey = $anonKey

if ($UseLinkedServiceRole) {
  Write-Host "Obtendo service_role via CLI autenticada (stdout/stderr separados)..."
  # Evita que stderr do PostHog vire NativeCommandError sob $ErrorActionPreference=Stop
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $serviceKey = Get-ServiceRoleKeyFromCli -ProjectRef $ExpectedProjectRef
  }
  finally {
    $ErrorActionPreference = $prevEap
  }
  $accessToken = $serviceKey
  $anonOrServiceKey = $serviceKey
  Write-Host "Auth OK: service_role em memória (não versionado)."
}
else {
  Write-Host "Login administrativo (JWT)..."
  if (-not $AdminWhatsapp) {
    $AdminWhatsapp = Read-Host "WhatsApp do admin (11 dígitos)"
  }
  $wa = Normalize-Whatsapp $AdminWhatsapp
  if ($wa -notmatch '^\d{11}$') {
    throw "WhatsApp inválido. Informe 11 dígitos (DDD + número)."
  }
  $email = "$wa@wa.faithbrothers.app"

  if (-not $AdminPassword) {
    $secure = Read-Host "Senha do admin" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
      $AdminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) | Out-Null
    }
  }
  if (-not $AdminPassword) { throw "Senha vazia." }

  $loginBody = @{ email = $email; password = $AdminPassword } | ConvertTo-Json
  try {
    $auth = Invoke-RestMethod -Method Post -Uri "$authBase/token?grant_type=password" -TimeoutSec 20 -Headers @{
      apikey         = $anonKey
      "Content-Type" = "application/json"
    } -Body $loginBody
  }
  catch {
    throw "Login administrativo inválido. Verifique WhatsApp/senha. $($_.Exception.Message)"
  }

  $accessToken = $auth.access_token
  if (-not $accessToken) { throw "Login sem access_token." }
  Write-Host "Login OK (user=$($auth.user.id))"
}

Write-Section "3) student_contracts (leitura)"
$contracts = Invoke-PostgrestGet -RestBase $restBase -AnonKey $anonOrServiceKey -AccessToken $accessToken -Label "student_contracts" -PathAndQuery (
  "student_contracts?select=id,student_id,family_group_id,plan_id,starts_on,ends_on,payment_status,contract_status,total_amount&order=created_at.asc"
)
Write-Host "Consulta 1 concluída (student_contracts)." -ForegroundColor Green
Write-Host (ConvertTo-PrettyJson $contracts)

Write-Section "4) billings (leitura)"
$billings = Invoke-PostgrestGet -RestBase $restBase -AnonKey $anonOrServiceKey -AccessToken $accessToken -Label "billings" -PathAndQuery (
  "billings?select=student_id,reference_month,status,amount,asaas_payment_id&order=student_id.asc,reference_month.asc"
)
Write-Host "Consulta 2 concluída (billings)." -ForegroundColor Green
Write-Host (ConvertTo-PrettyJson $billings)

Write-Section "5) student_contract_months (leitura)"
$months = Invoke-PostgrestGet -RestBase $restBase -AnonKey $anonOrServiceKey -AccessToken $accessToken -Label "student_contract_months" -PathAndQuery (
  "student_contract_months?select=student_id,reference_month,status,source&order=student_id.asc,reference_month.asc"
)
Write-Host "Consulta 3 concluída (student_contract_months)." -ForegroundColor Green
Write-Host (ConvertTo-PrettyJson $months)

Write-Section "Resumo"
$contractCount = @($contracts).Count
$billingCount = @($billings).Count
$monthCount = @($months).Count
Write-Host "student_contracts: $contractCount"
Write-Host "billings: $billingCount"
Write-Host "student_contract_months: $monthCount"
Write-Host "Escrita realizada: NÃO (somente GET PostgREST)." -ForegroundColor Green
