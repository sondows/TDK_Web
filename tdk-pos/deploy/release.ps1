param(
  [ValidateSet('Auto', 'PrepareRelease', 'DryRun', 'Deploy')][string]$Mode = 'Auto',
  [string]$ApprovedSha,
  [string]$BaseSha,
  [string]$ApprovedPathsFile,
  [string]$ConfirmationSha,
  [string]$DeviceAgentUrl
)

if ($Mode -eq 'Auto') {
  & (Join-Path $PSScriptRoot 'prepare-release.ps1')
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & (Join-Path $PSScriptRoot 'auto-release.ps1')
  exit $LASTEXITCODE
}
if ($Mode -eq 'PrepareRelease') {
  & (Join-Path $PSScriptRoot 'prepare-release.ps1')
  exit $LASTEXITCODE
}

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$previousIndex = $env:GIT_INDEX_FILE
$temporaryIndex = Join-Path ([IO.Path]::GetTempPath()) ('tdk-release-index-' + [guid]::NewGuid().ToString('N'))

function Invoke-Git([string[]]$Arguments) {
  $output = & git @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw "git $($Arguments[0]) failed: $($output -join ' ')" }
  return $output
}

try {
  Set-Location -LiteralPath $repo
  if ($ApprovedSha -notmatch '^[0-9a-f]{40}$' -or $BaseSha -notmatch '^[0-9a-f]{40}$') {
    throw 'Pass the full 40-character approved release SHA and NAS base SHA.'
  }
  $head = @(Invoke-Git @('rev-parse', 'HEAD'))[0].Trim()
  $branch = @(Invoke-Git @('branch', '--show-current'))[0].Trim()
  if ($branch -ne 'main' -or $head -ne $ApprovedSha) { throw "Local main HEAD must equal approved SHA. branch=$branch HEAD=$head" }
  $verifiedBase = @(Invoke-Git @('rev-parse', '--verify', "$BaseSha^{commit}"))[0].Trim()
  $verifiedRelease = @(Invoke-Git @('rev-parse', '--verify', "$ApprovedSha^{commit}"))[0].Trim()
  if ($verifiedBase -ne $BaseSha -or $verifiedRelease -ne $ApprovedSha) { throw 'Commit identity mismatch.' }
  Invoke-Git @('merge-base', '--is-ancestor', $BaseSha, $ApprovedSha) | Out-Null

  $allPaths = @(Invoke-Git @('diff', '--name-only', $BaseSha, $ApprovedSha, '--'))
  $unexpected = @($allPaths | Where-Object { $_ -ne 'deploy.bat' -and -not $_.StartsWith('tdk-pos/') })
  if ($unexpected.Count) { throw "Release contains paths outside deploy.bat and tdk-pos: $($unexpected -join ', ')" }
  $releasePaths = @(Invoke-Git @('diff', '--name-only', $BaseSha, $ApprovedSha, '--', 'deploy.bat', 'tdk-pos'))
  Write-Output "Release: $ApprovedSha"
  Write-Output "NAS base: $BaseSha"
  Write-Output 'Committed deployment paths:'
  $releasePaths | ForEach-Object { Write-Output "  $_" }
  if (-not $releasePaths.Count) { throw 'No committed deployment paths differ from the NAS base.' }

  # Recreate the existing staged-path validation without touching the user's index.
  $env:GIT_INDEX_FILE = $temporaryIndex
  Invoke-Git @('read-tree', $ApprovedSha) | Out-Null
  Invoke-Git @('diff', '--cached', '--check', $BaseSha, '--', 'deploy.bat', 'tdk-pos') | Out-Null
  Write-Output 'Validate staged deployment paths: PASS (isolated Git index)'
  if ($null -eq $previousIndex) { Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue }
  else { $env:GIT_INDEX_FILE = $previousIndex }

  if ($ApprovedPathsFile) {
    $approvedPaths = @(Get-Content -LiteralPath $ApprovedPathsFile -Encoding UTF8 | ForEach-Object { $_.Trim().Replace('\', '/') } | Where-Object { $_ -and -not $_.StartsWith('#') })
    $actual = @($releasePaths | Sort-Object -Unique)
    $expected = @($approvedPaths | Sort-Object -Unique)
    if (($actual -join "`n") -cne ($expected -join "`n") -or $approvedPaths.Count -ne $expected.Count) {
      throw 'Approved path manifest differs from the committed release path list.'
    }
    Write-Output 'Approved path manifest: PASS'
  } elseif ($Mode -eq 'Deploy') {
    throw 'Deploy mode requires -ApprovedPathsFile with the exact approved release paths.'
  }

  $dirty = @(Invoke-Git @('status', '--porcelain=v1', '--untracked-files=all', '--', 'deploy.bat', 'tdk-pos'))
  if ($dirty.Count) {
    Write-Output 'Uncommitted deployment paths (never auto-staged):'
    $dirty | ForEach-Object { Write-Output "  $_" }
    throw 'Use an approved committed release in a clean checkout; current worktree was preserved.'
  }
  if ($Mode -eq 'DryRun') {
    Write-Output 'Dry run PASS: no SSH, Git push, Docker, NAS, or DB command was run.'
    exit 0
  }

  if ($ConfirmationSha -ne $ApprovedSha) { throw 'Deploy mode requires -ConfirmationSha equal to the approved release SHA.' }
  if ($DeviceAgentUrl -notmatch '^http://127\.0\.0\.1:[0-9]{2,5}$') {
    throw 'Deploy mode requires an approved local -DeviceAgentUrl such as http://127.0.0.1:5168.'
  }
  $remoteLine = @(Invoke-Git @('ls-remote', 'origin', 'refs/heads/main'))
  $remoteSha = ($remoteLine[0] -split '\s+')[0]
  if ($remoteSha -ne $ApprovedSha) { throw "origin/main must already equal the approved SHA; no automatic commit or push is performed. remote=$remoteSha" }
  $confirmation = Read-Host 'Type the approved release SHA to start the NAS deployment'
  if ($confirmation -ne $ApprovedSha) { throw 'Confirmation did not match; deployment cancelled.' }

  $helper = Join-Path $PSScriptRoot 'nas-release.sh'
  $scriptText = Get-Content -LiteralPath $helper -Raw -Encoding UTF8
  $sshArgs = @('-o', 'BatchMode=yes', '-o', 'NumberOfPasswordPrompts=0', '-o', 'ConnectTimeout=10', '-T', 'sondows@192.168.0.83', "sh -s -- deploy $ApprovedSha $BaseSha $DeviceAgentUrl")
  $scriptText | & ssh @sshArgs
  if ($LASTEXITCODE -ne 0) { throw "NAS deployment helper failed with exit code $LASTEXITCODE. Review NAS state before retrying." }
  Write-Output 'NAS image replacement finished. Complete functional smoke checks before declaring success.'
} catch {
  Write-Error $_
  exit 1
} finally {
  if ($null -eq $previousIndex) { Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue }
  else { $env:GIT_INDEX_FILE = $previousIndex }
  if (Test-Path -LiteralPath $temporaryIndex) { Remove-Item -LiteralPath $temporaryIndex -Force }
  Set-Location -LiteralPath $repo
}
