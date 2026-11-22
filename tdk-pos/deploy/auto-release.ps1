param()

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$app = Join-Path $repo 'tdk-pos'
$helper = Join-Path $PSScriptRoot 'nas-release.sh'
$previousIndex = $env:GIT_INDEX_FILE
$temporaryIndex = Join-Path ([IO.Path]::GetTempPath()) ('tdk-auto-index-' + [guid]::NewGuid().ToString('N'))
$manifestFile = Join-Path ([IO.Path]::GetTempPath()) ('tdk-auto-paths-' + [guid]::NewGuid().ToString('N') + '.txt')
$sshTarget = 'sondows@192.168.0.83'
$sshOptions = @('-p', '22', '-o', 'StrictHostKeyChecking=yes', '-o', 'NumberOfPasswordPrompts=1', '-o', 'ConnectTimeout=10', '-T')

function Invoke-Git([string[]]$GitArgs) {
  $result = @(& git -C $repo @GitArgs 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "git $($GitArgs[0]) failed: $($result -join ' ')" }
  return $result
}

function Assert-Exit([string]$Label) {
  if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE" }
}

function Invoke-Nas([string]$Action, [string]$ReleaseSha = '', [string]$BaseSha = '', [string]$AgentUrl = '') {
  $sshArguments = @($sshOptions + @($sshTarget, "sh -s -- $Action $ReleaseSha $BaseSha $AgentUrl"))
  # SSH obtains any login password from the console. Never pass credentials through stdin.
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $result = @(Get-Content -LiteralPath $helper -Raw -Encoding UTF8 | & ssh @sshArguments 2>&1)
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($code -ne 0) {
    $message = ($result | ForEach-Object { "$_" }) -join ' '
    if ($message -match 'REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed') { throw 'NAS host key verification failed. Check the NAS fingerprint with the administrator; do not disable checking.' }
    if ($message -match 'Permission denied \(publickey|Permission denied \(password') { throw 'NAS SSH authentication failed. Use an approved SSH key or enter the account password at the console.' }
    if ($message -match 'Connection refused|Connection timed out|No route to host|Could not resolve hostname') { throw "NAS network connection failed: $message" }
    if ($message -match 'noninteractive sudo|password is required|not allowed to run sudo') { throw 'NAS sudo -n permission is missing. An administrator must approve only the required deployment commands; no Docker socket change is made.' }
    throw "NAS $Action failed (exit $code): $message"
  }
  return @($result | ForEach-Object { "$_" })
}

function Read-Inspection([string[]]$Lines) {
  $values = @{}
  foreach ($line in $Lines) {
    if ($line -match '^([A-Z_]+)=(.*)$') { $values[$matches[1]] = $matches[2].Trim() }
  }
  foreach ($key in @('SOURCE_SHA', 'IMAGE_REVISION', 'IMAGE_ID', 'CONTAINER_ID', 'CONTAINER_STATE', 'HEALTH', 'FREE_KB')) {
    if (-not $values.ContainsKey($key)) { throw "NAS inspection did not return $key; deployment is blocked." }
  }
  return $values
}

function Invoke-LocalCheck([string]$Label, [string]$Command, [string[]]$Arguments) {
  Write-Output "Checking $Label..."
  Push-Location -LiteralPath $app
  try {
    & $Command @Arguments
    Assert-Exit $Label
  } finally { Pop-Location }
}

function Test-PublicRoute([string]$Path) {
  Add-Type -AssemblyName System.Net.Http
  $handler = New-Object System.Net.Http.HttpClientHandler
  $handler.AllowAutoRedirect = $false
  $client = New-Object System.Net.Http.HttpClient($handler)
  $client.Timeout = [TimeSpan]::FromSeconds(12)
  try {
    $response = $client.GetAsync("https://tdkon.myasustor.com$Path").GetAwaiter().GetResult()
    $code = [int]$response.StatusCode
    Write-Output "HTTPS $Path $code"
    if ($code -lt 200 -or $code -ge 400) { throw "HTTPS $Path returned $code" }
  } finally { $client.Dispose(); $handler.Dispose() }
}

try {
  Set-Location -LiteralPath $repo
  $branch = @(Invoke-Git @('branch', '--show-current'))[0].Trim()
  $releaseSha = @(Invoke-Git @('rev-parse', 'HEAD'))[0].Trim()
  if ($branch -ne 'main' -or $releaseSha -notmatch '^[0-9a-f]{40}$') { throw 'Release checkout must be on main with a full Git SHA.' }
  Write-Output "Local main HEAD: $releaseSha"
  # Local HTTPS keys are never release inputs. Avoid traversing an unreadable
  # certificate directory while still checking every tracked path separately.
  $localHttpsPath = 'tdk-pos/.local-dev-https'
  $trackedLocalHttps = @(Invoke-Git @('ls-files', '--', $localHttpsPath))
  if ($trackedLocalHttps.Count) { throw 'The excluded local HTTPS directory contains tracked files; review Git state before deployment.' }
  $excludeLocalHttps = ':(exclude)tdk-pos/.local-dev-https'
  $dirty = @(Invoke-Git @('status', '--porcelain=v1', '--untracked-files=all', '--', '.', $excludeLocalHttps))
  $dirtyReleasePaths = @(Invoke-Git @('status', '--porcelain=v1', '--untracked-files=all', '--', 'deploy.bat', 'tdk-pos', $excludeLocalHttps))
  $toolDirty = @(Invoke-Git @('status', '--porcelain=v1', '--untracked-files=all', '--', 'deploy.bat', 'tdk-pos/deploy'))
  if ($toolDirty.Count) {
    Write-Output 'Uncommitted deployment tool files:'
    $toolDirty | ForEach-Object { Write-Output "  $_" }
    throw "Current main HEAD $releaseSha does not include these deployment tools. Review and commit the intended release in a separate clean checkout, then retry. No files were committed or discarded."
  }
  $dirtySourcePaths = @($dirtyReleasePaths | Where-Object { $_ -notmatch 'tdk-pos/(checkpoints/|PLANS\.md)' })
  if ($dirtySourcePaths.Count) {
    Write-Output 'Uncommitted TDKON source files:'
    $dirtySourcePaths | ForEach-Object { Write-Output "  $_" }
    throw 'Current main HEAD does not include these app changes. Deploying HEAD now would omit them. Create a reviewed release commit before retrying.'
  }
  if ($dirty.Count) { Write-Output "Uncommitted paths outside the release source: $($dirty.Count). They are preserved and excluded from the committed release." }

  Write-Output 'Inspecting running NAS container and image (read only)...'
  $inspection = Read-Inspection @(Invoke-Nas 'inspect')
  Write-Output "NAS container: $($inspection.CONTAINER_ID) ($($inspection.CONTAINER_STATE), $($inspection.HEALTH))"
  Write-Output "Running image ID: $($inspection.IMAGE_ID)"
  Write-Output "Running image revision: $($inspection.IMAGE_REVISION)"
  Write-Output "Revision source: $($inspection.REVISION_SOURCE); evidence SHA-256: $($inspection.BASELINE_EVIDENCE_SHA256)"
  Write-Output "NAS Git HEAD: $($inspection.SOURCE_SHA)"
  Write-Output "NAS free space: $($inspection.FREE_KB) KiB"
  if ($inspection.CONTAINER_STATE -ne 'running' -or $inspection.HEALTH -ne 'healthy') { throw 'Current NAS container is not healthy; investigate before replacing it.' }
  if ($inspection.IMAGE_REVISION -notmatch '^[0-9a-f]{40}$') { throw 'Running image has no trusted Git revision label. Verify prior deployment evidence and register a separately approved baseline before automated deployment.' }
  if ($inspection.SOURCE_SHA -cne $inspection.IMAGE_REVISION) { throw 'Running image revision and NAS checkout differ. Do not infer a base SHA from the mutable image tag.' }
  $baseSha = $inspection.IMAGE_REVISION
  $verifiedBase = @(Invoke-Git @('rev-parse', '--verify', "$baseSha^{commit}"))[0].Trim()
  if ($verifiedBase -cne $baseSha) { throw 'NAS base commit is absent locally. Fetch and verify the commit before deployment.' }
  Invoke-Git @('merge-base', '--is-ancestor', $baseSha, $releaseSha) | Out-Null
  $paths = @(Invoke-Git @('diff', '--name-only', $baseSha, $releaseSha, '--'))
  if (-not $paths.Count) { throw 'No committed release paths differ from the running NAS version.' }
  $unrelated = @($paths | Where-Object { $_ -ne 'deploy.bat' -and -not $_.StartsWith('tdk-pos/') })
  if ($unrelated.Count) { throw "Release includes non-TDKON paths: $($unrelated -join ', ')" }
  Write-Output "Committed release paths ($($paths.Count)):"
  $paths | ForEach-Object { Write-Output "  $_" }
  $paths | Set-Content -LiteralPath $manifestFile -Encoding UTF8
  $manifestPaths = @(Get-Content -LiteralPath $manifestFile -Encoding UTF8)
  if ($manifestPaths.Count -ne $paths.Count -or ($manifestPaths -join "`n") -cne ($paths -join "`n")) { throw 'Generated release manifest does not match the committed diff.' }
  $manifestHash = (Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Output "Exact path manifest SHA-256: $manifestHash"

  $env:GIT_INDEX_FILE = $temporaryIndex
  Invoke-Git @('read-tree', $releaseSha) | Out-Null
  Invoke-Git @('diff', '--cached', '--check', $baseSha, '--', 'deploy.bat', 'tdk-pos') | Out-Null
  Write-Output 'Validate staged deployment paths: PASS (isolated Git index)'
  if ($null -eq $previousIndex) { Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue }
  else { $env:GIT_INDEX_FILE = $previousIndex }
  $remoteLine = @(Invoke-Git @('ls-remote', 'origin', 'refs/heads/main'))
  $remoteSha = ($remoteLine[0] -split '\s+')[0]
  if ($remoteSha -cne $releaseSha) { throw 'origin/main does not equal local HEAD. No automatic push is performed.' }

  $agentUrl = $env:TDK_DEVICE_AGENT_URL
  if (-not $agentUrl -and $inspection.DEVICE_AGENT_URL -ne 'UNKNOWN') { $agentUrl = $inspection.DEVICE_AGENT_URL }
  if (-not $agentUrl) { throw 'Set TDK_DEVICE_AGENT_URL to the verified POS Device Agent browser URL before one-click deployment.' }
  if ($agentUrl -notmatch '^http://127\.0\.0\.1:[0-9]{2,5}$') { throw 'TDK_DEVICE_AGENT_URL must be an approved http://127.0.0.1:<port> URL.' }
  $shell = 'C:\Program Files\Git\usr\bin\sh.exe'
  if (-not (Test-Path -LiteralPath $shell)) { throw 'A POSIX shell is required to check the NAS helper syntax.' }
  & $shell -n $helper
  Assert-Exit 'NAS helper syntax'
  Invoke-LocalCheck 'TypeScript' 'node' @('node_modules/typescript/bin/tsc', '--noEmit')
  Invoke-LocalCheck 'ESLint' 'node' @('node_modules/eslint/bin/eslint.js', 'src/app/q', 'src/lib/admin-qr-export.ts', 'src/lib/qr-order-auth.ts')
  Invoke-LocalCheck 'QR unit tests' 'node' @('--experimental-strip-types', '--test', 'src/lib/admin-qr-export.test.mjs', 'src/lib/qr-session-expiry-policy.test.mjs', 'src/lib/qr-processing-policy.test.mjs', 'src/lib/qr-order-access-state.test.mjs', 'src/lib/qr-table-indicators-model.test.mjs', 'src/lib/hos-table-view-state.test.mjs', 'src/lib/hos-qr-order-errors.test.mjs', 'src/lib/qr-order-invite-failure.test.mjs', 'src/lib/qr-pending-order-rounds.test.mjs', 'src/lib/qr-order-approval-navigation.test.mjs')
  Invoke-LocalCheck 'Next production build' 'node' @('node_modules/next/dist/bin/next', 'build')
  $previousTestBase = $env:TDK_QR_TEST_BASE_URL
  try {
    $existingTest = & node -e "fetch('http://127.0.0.1:3000/api/db-test',{signal:AbortSignal.timeout(2000)}).then(r=>r.json()).then(j=>{if(j.result?.[0]?.database_name!=='TDK_POS_TEST')process.exit(1)}).catch(()=>process.exit(1))" 2>$null
    if ($LASTEXITCODE -eq 0) { $env:TDK_QR_TEST_BASE_URL = 'http://127.0.0.1:3000' }
    else { Remove-Item Env:TDK_QR_TEST_BASE_URL -ErrorAction SilentlyContinue }
    Invoke-LocalCheck 'TEST QR entry' 'node' @('scripts/verify-qr-entry-development.cjs')
    Invoke-LocalCheck 'TEST QR invite join' 'node' @('scripts/verify-qr-invite-development.cjs')
    Invoke-LocalCheck 'TEST cancellation scope' 'node' @('scripts/verify-qr-cancellation-scope.cjs')
  } finally {
    if ($null -eq $previousTestBase) { Remove-Item Env:TDK_QR_TEST_BASE_URL -ErrorAction SilentlyContinue }
    else { $env:TDK_QR_TEST_BASE_URL = $previousTestBase }
  }


  Write-Output 'Creating and verifying the protected running-image backup before final deployment approval...'
  $backup = @(Invoke-Nas 'prepare' $releaseSha $baseSha)
  $backup | ForEach-Object { Write-Output $_ }
  if (-not @($backup | Where-Object { $_ -match '^ROLLBACK PREPARED:' }).Count) { throw 'NAS backup did not report a verified rollback archive.' }
  Write-Output 'Rollback archive checksum and tar listing are verified. A container restore has not been exercised.'
  Write-Output '========================================'
  Write-Output 'TDKON production deployment ready for review'
  Write-Output "NAS: 192.168.0.83; container: $($inspection.CONTAINER_ID)"
  Write-Output "Current image: $($inspection.IMAGE_ID)"
  Write-Output "NAS base SHA: $baseSha"
  Write-Output "Release SHA: $releaseSha"
  Write-Output "Changed paths: $($paths.Count); local checks: PASS; backup: verified; rollback: prepared, restore untested"
  Write-Output "Approved path manifest SHA-256: $manifestHash"
  Write-Output "Device Agent URL: $agentUrl"
  Write-Output 'Deployment changes the TDKON app container only. Production DB migrations and other containers are excluded.'
  Write-Output '========================================'
  $confirmation = Read-Host 'Type the full Release SHA to approve the production app replacement; Enter cancels'
  if ($confirmation -cne $releaseSha) { throw 'Deployment cancelled; the protected backup remains on NAS.' }
  if (@(Invoke-Git @('rev-parse', 'HEAD'))[0].Trim() -cne $releaseSha) { throw 'Local release HEAD changed while awaiting approval.' }
  $finalPaths = @(Invoke-Git @('diff', '--name-only', $baseSha, $releaseSha, '--'))
  if (($finalPaths -join "`n") -cne ($manifestPaths -join "`n") -or (Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifestHash) { throw 'Release path manifest changed while awaiting approval.' }
  Write-Output 'Final approval received. Deploying the committed release...'
  $deployed = $false
  try {
    $result = @(Invoke-Nas 'deploy' $releaseSha $baseSha $agentUrl)
    $result | ForEach-Object { Write-Output $_ }
    if (-not @($result | Where-Object { $_ -match '^RELEASE CONTAINER HEALTHY:' }).Count) { throw 'NAS deployment did not confirm the new healthy image.' }
    $deployed = $true
    foreach ($path in @('/pos', '/hos', '/qr')) { Test-PublicRoute $path }
    Write-Output 'Deployment checks passed. Authenticated POS/HOS/QRS business flows still need manual verification.'
  } catch {
    $failure = $_
    $rollbackNeeded = $deployed
    if (-not $deployed) {
      try {
        $afterFailure = Read-Inspection @(Invoke-Nas 'inspect')
        if ($afterFailure.IMAGE_ID -ceq $inspection.IMAGE_ID) { $rollbackNeeded = $false }
        elseif ($afterFailure.IMAGE_REVISION -ceq $releaseSha) { $rollbackNeeded = $true }
        else { throw "Unexpected running image $($afterFailure.IMAGE_ID) after deployment error." }
      } catch {
        throw "Deployment failed and NAS state could not be safely resolved: $failure; inspection error: $_. Inspect NAS immediately."
      }
    }
    if ($rollbackNeeded) {
      Write-Warning "Deployment check failed: $failure. Attempting automatic rollback."
      try { @(Invoke-Nas 'rollback' $releaseSha) | ForEach-Object { Write-Output $_ } }
      catch { throw "Deployment check failed and rollback failed: $failure; rollback error: $_. Inspect NAS immediately." }
    }
    throw "Deployment failed or was rolled back: $failure"
  }
} catch {
  Write-Host "DEPLOYMENT STOPPED: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  if ($null -eq $previousIndex) { Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue }
  else { $env:GIT_INDEX_FILE = $previousIndex }
  if (Test-Path -LiteralPath $temporaryIndex) { Remove-Item -LiteralPath $temporaryIndex -Force }
  if (Test-Path -LiteralPath $manifestFile) { Remove-Item -LiteralPath $manifestFile -Force }
  Set-Location -LiteralPath $repo
}
