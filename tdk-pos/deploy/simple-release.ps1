param()

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$helper = Join-Path $PSScriptRoot 'simple-nas-release.sh'

function Invoke-Git([string[]]$GitArgs) {
  $prior = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $result = @(& git -C $repo @GitArgs 2>&1); $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $prior }
  if ($code -ne 0) { throw "git $($GitArgs[0]) failed: $($result -join ' ')" }
  return $result
}

try {
  $branch = @(Invoke-Git @('branch', '--show-current'))[0].Trim()
  $releaseSha = @(Invoke-Git @('rev-parse', 'HEAD'))[0].Trim()
  if ($branch -ne 'main' -or $releaseSha -notmatch '^[0-9a-f]{40}$') { throw 'Release checkout must be on main with a full Git SHA.' }
  $remote = @(Invoke-Git @('ls-remote', 'origin', 'refs/heads/main'))
  if (($remote[0] -split '\s+')[0] -cne $releaseSha) { throw 'origin/main does not match the local release SHA.' }
  $dirty = @(Invoke-Git @('status', '--porcelain=v1', '--untracked-files=all', '--', 'deploy.bat', 'tdk-pos', ':(exclude)tdk-pos/.local-dev-https'))
  if ($dirty.Count) { throw 'TDKON files changed after release preparation. Commit and push them before deployment.' }

  $agentUrl = $env:TDK_DEVICE_AGENT_URL
  if ($agentUrl -and $agentUrl -notmatch '^http://127\.0\.0\.1:[0-9]{2,5}$') { throw 'TDK_DEVICE_AGENT_URL must be http://127.0.0.1:<port>.' }
  if (-not $agentUrl) { $agentUrl = '-' }
  $scriptText = (Get-Content -LiteralPath $helper -Raw -Encoding UTF8).Replace("`r`n", "`n")
  $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($scriptText))
  $remoteCommand = "printf %s $payload | base64 -d | sh -s -- $releaseSha $agentUrl"
  if ($remoteCommand.Length -gt 30000) { throw 'NAS helper exceeds the safe SSH command length.' }
  Write-Output "Deploying committed TDKON release $releaseSha. NAS image backup and automatic rollback are disabled."
  if ($agentUrl -eq '-') { Write-Output 'Device Agent: Dockerfile default http://127.0.0.1:5168' }
  else { Write-Output "Device Agent: $agentUrl" }
  Write-Output 'Enter NAS SSH and sudo passwords in this terminal when prompted.'
  $prior = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & ssh -p 22 -o StrictHostKeyChecking=yes -o NumberOfPasswordPrompts=1 -o ConnectTimeout=10 -tt sondows@192.168.0.83 $remoteCommand
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prior }
  if ($code -ne 0) { throw "NAS build or deployment failed (exit $code). Inspect NAS logs, fix the issue, then run deploy.bat again." }
} catch {
  Write-Host "DEPLOYMENT STOPPED: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
