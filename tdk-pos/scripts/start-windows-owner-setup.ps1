$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectRoot

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Open PowerShell with Run as administrator, then run this script again.'
}
if ($env:NODE_ENV -eq 'production') {
  throw 'Windows owner setup is disabled when NODE_ENV is production.'
}

$envFile = Join-Path $projectRoot '.env.local'
$configuredDb = $env:DB_NAME
if (-not $configuredDb -and (Test-Path -LiteralPath $envFile)) {
  $dbLine = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^\s*DB_NAME\s*=' } | Select-Object -First 1
  if ($dbLine -match '^\s*DB_NAME\s*=\s*(.*?)\s*(?:#.*)?$') {
    $configuredDb = $Matches[1].Trim().Trim('"').Trim("'")
  }
}
if ($configuredDb -ne 'TDK_POS_TEST') {
  throw "Refusing to start owner setup: configured DB_NAME is not TDK_POS_TEST."
}

# Keep an existing general dev server untouched. Start the isolated setup server
# on the first free local development port so the browser cannot hit the old
# process and inherit its unrelated setup/rate-limit environment.
$listeningPorts = @(netstat -ano -p tcp | ForEach-Object {
  if ($_ -match '^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+\d+\s*$') { [int]$Matches[1] }
})
$setupPort = 3000
while ($listeningPorts -contains $setupPort) { $setupPort++ }

$saved = @{
  NODE_ENV = [Environment]::GetEnvironmentVariable('NODE_ENV', 'Process')
  DB_NAME = [Environment]::GetEnvironmentVariable('DB_NAME', 'Process')
  PORT = [Environment]::GetEnvironmentVariable('PORT', 'Process')
  TDK_WINDOWS_DEV_OWNER_SETUP = [Environment]::GetEnvironmentVariable('TDK_WINDOWS_DEV_OWNER_SETUP', 'Process')
  TDK_NAS_OWNER_SETUP = [Environment]::GetEnvironmentVariable('TDK_NAS_OWNER_SETUP', 'Process')
}

try {
  $env:NODE_ENV = 'development'
  $env:DB_NAME = 'TDK_POS_TEST'
  $env:PORT = [string]$setupPort
  $env:TDK_WINDOWS_DEV_OWNER_SETUP = '1'
  Remove-Item Env:TDK_NAS_OWNER_SETUP -ErrorAction SilentlyContinue
  Write-Host "Starting local-only ADM initial setup at http://localhost:${setupPort}: NODE_ENV=development, DB_NAME=TDK_POS_TEST, Windows setup=enabled."
  Write-Host 'Do not enter this URL from another device.'
  & npm.cmd run dev
  if ($LASTEXITCODE -ne 0) { throw "npm run dev exited with code $LASTEXITCODE." }
}
finally {
  foreach ($name in $saved.Keys) {
    if ($null -eq $saved[$name]) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
    else { Set-Item "Env:$name" $saved[$name] }
  }
}
