param(
  [string]$LanIp = "192.168.0.54"
)

$ErrorActionPreference = "Stop"
$helperProject = Join-Path $PSScriptRoot "dev-https-cert\DevHttpsCert.csproj"
if (-not (Test-Path $helperProject)) { throw "TLS certificate helper project is missing." }

dotnet run --project $helperProject --configuration Release -- $LanIp
if ($LASTEXITCODE -ne 0) { throw "TLS certificate generation failed." }
