$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$processFile = Join-Path $project '.pos-runtime\pos-process.json'
. (Join-Path $PSScriptRoot 'pos-process.ps1')
if (Stop-ManagedPos) {
  Write-Host 'Managed TDK POS server stopped.'
  exit 0
}
Write-Host 'No verified managed TDK POS server found. Nothing was stopped.'
exit 1
