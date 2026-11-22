param()

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$app = Join-Path $repo 'tdk-pos'
$localHttps = 'tdk-pos/.local-dev-https'
$excludeLocalHttps = ':(exclude)tdk-pos/.local-dev-https'
$savedIndex = $env:GIT_INDEX_FILE
$previewIndex = Join-Path ([IO.Path]::GetTempPath()) ('tdk-release-preview-' + [guid]::NewGuid().ToString('N'))

function Invoke-Git([string[]]$GitArgs) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = @(& git -C $repo @GitArgs 2>&1)
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousPreference }
  if ($code -ne 0) { throw "git $($GitArgs[0]) failed (exit $code)." }
  if (@($output | Where-Object { "$_" -match '^warning: could not open directory' }).Count) {
    throw 'Git could not inspect a project directory. No release files were staged.'
  }
  return @($output | ForEach-Object { "$_" } | Where-Object { $_ -notmatch '^warning: in the working copy of ' })
}

function Invoke-ScopedAdd() {
  # Preserve Git's normal line-ending conversion. A temporary index is used
  # for preview; the real index is touched only after tests and scope checks.
  Invoke-Git @('add', '-A', '--', 'deploy.bat', 'tdk-pos', $excludeLocalHttps) | Out-Null
}

function Assert-ScopedPaths([string[]]$Paths) {
  foreach ($path in $Paths) {
    if ($path -ne 'deploy.bat' -and -not $path.StartsWith('tdk-pos/')) { throw "Release path is outside TDKON: $path" }
    if ($path -match '(^|/)(node_modules|\.next|\.local-dev-https|storage|\.codex-backups|private-staff-cleanup)(/|$)' -or
        $path -match '\.(pem|pfx|key|dpapi)$' -or
        ($path -match '^tdk-pos/\.env' -and $path -notin @('tdk-pos/.env.production.example', 'tdk-pos/.env.development.example'))) {
      throw "Release path could contain a credential or generated data: $path"
    }
  }
}

function Invoke-LocalCheck([string]$Name, [string[]]$NodeArguments) {
  if (-not $NodeArguments.Count) { throw "$Name has no Node.js arguments; refusing to launch the interactive REPL." }
  Write-Output "Checking $Name..."
  Push-Location -LiteralPath $app
  try {
    & node @NodeArguments
    if ($LASTEXITCODE -ne 0) { throw "$Name failed (exit $LASTEXITCODE). No files were staged." }
  } finally { Pop-Location }
}

function Invoke-DevelopmentChecks() {
  Invoke-LocalCheck 'TypeScript' @('node_modules/typescript/bin/tsc', '--noEmit')
  Invoke-LocalCheck 'ESLint' @('node_modules/eslint/bin/eslint.js', 'src/app/api/admin/qr-codes', 'src/app/api/qr/table-order-link/route.ts', 'src/app/q', 'src/app/qrorder/[notice]/page.tsx', 'src/lib/admin-qr-export.test.mjs', 'src/lib/admin-qr-export.ts', 'src/lib/qr-order-auth.ts', 'scripts/verify-qr-cancellation-scope.cjs', 'scripts/verify-qr-entry-development.cjs', 'scripts/verify-qr-invite-development.cjs')
  Invoke-LocalCheck 'QR unit tests' @('--experimental-strip-types', '--test', 'src/lib/admin-qr-export.test.mjs', 'src/lib/qr-session-expiry-policy.test.mjs', 'src/lib/qr-processing-policy.test.mjs', 'src/lib/qr-order-access-state.test.mjs', 'src/lib/qr-table-indicators-model.test.mjs', 'src/lib/hos-table-view-state.test.mjs', 'src/lib/hos-qr-order-errors.test.mjs', 'src/lib/qr-order-invite-failure.test.mjs', 'src/lib/qr-pending-order-rounds.test.mjs', 'src/lib/qr-order-approval-navigation.test.mjs')
  Invoke-LocalCheck 'Next production build' @('node_modules/next/dist/bin/next', 'build')
  $priorTestBase = $env:TDK_QR_TEST_BASE_URL
  try {
    Push-Location -LiteralPath $app
    try {
      & node -e "fetch('http://127.0.0.1:3000/api/db-test',{signal:AbortSignal.timeout(2000)}).then(r=>r.json()).then(j=>{if(j.result?.[0]?.database_name!=='TDK_POS_TEST')process.exit(1)}).catch(()=>process.exit(1))" 2>$null
      if ($LASTEXITCODE -eq 0) { $env:TDK_QR_TEST_BASE_URL = 'http://127.0.0.1:3000' }
      else { Remove-Item Env:TDK_QR_TEST_BASE_URL -ErrorAction SilentlyContinue }
    } finally { Pop-Location }
    Invoke-LocalCheck 'TEST QR entry' @('scripts/verify-qr-entry-development.cjs')
    Invoke-LocalCheck 'TEST QR invite join' @('scripts/verify-qr-invite-development.cjs')
    Invoke-LocalCheck 'TEST cancellation scope' @('scripts/verify-qr-cancellation-scope.cjs')
  } finally {
    if ($null -eq $priorTestBase) { Remove-Item Env:TDK_QR_TEST_BASE_URL -ErrorAction SilentlyContinue }
    else { $env:TDK_QR_TEST_BASE_URL = $priorTestBase }
  }
}

try {
  Set-Location -LiteralPath $repo
  if (@(Invoke-Git @('branch', '--show-current'))[0].Trim() -ne 'main') { throw 'Scoped release commit requires the main branch.' }
  $originalHead = @(Invoke-Git @('rev-parse', 'HEAD'))[0].Trim()
  if ($originalHead -notmatch '^[0-9a-f]{40}$') { throw 'Git HEAD is not a full SHA.' }
  if (@(Invoke-Git @('ls-files', '--', $localHttps)).Count) { throw 'Local HTTPS directory contains tracked files; release preparation stopped.' }
  if (@(Invoke-Git @('diff', '--cached', '--name-only', '--')).Count) { throw 'The real Git index already contains staged files. Preserve and review that staging before automatic release preparation.' }
  $scopeStatus = @(Invoke-Git @('status', '--porcelain=v1', '--untracked-files=all', '--', 'deploy.bat', 'tdk-pos', $excludeLocalHttps))
  Write-Output "TDKON changed paths: $($scopeStatus.Count). Other projects are excluded."

  # Inspect the full prospective commit without changing the real index.
  $env:GIT_INDEX_FILE = $previewIndex
  Invoke-Git @('read-tree', $originalHead) | Out-Null
  Invoke-ScopedAdd
  $previewPaths = @(Invoke-Git @('diff', '--cached', '--name-only', $originalHead, '--'))
  Assert-ScopedPaths $previewPaths
  Invoke-Git @('diff', '--cached', '--check', $originalHead, '--') | Out-Null
  if ($null -eq $savedIndex) { Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue }
  else { $env:GIT_INDEX_FILE = $savedIndex }
  if ($previewPaths.Count -ne $scopeStatus.Count) { throw 'Staged preview differs from the TDKON status list. No release commit was made.' }
  Write-Output "Release file list ($($previewPaths.Count)):"
  $previewPaths | ForEach-Object { Write-Output "  $_" }

  $remoteLine = @(Invoke-Git @('ls-remote', '--exit-code', 'origin', 'refs/heads/main'))
  $remoteHead = ($remoteLine[0] -split '\s+')[0]
  if ($remoteHead -notmatch '^[0-9a-f]{40}$') { throw 'Remote main SHA could not be verified.' }
  if ($remoteHead -ne $originalHead) { throw 'origin/main differs from local HEAD. Review the divergence before automatic commit or push.' }

  Invoke-DevelopmentChecks
  if (@(Invoke-Git @('rev-parse', 'HEAD'))[0].Trim() -ne $originalHead) { throw 'Git HEAD changed during tests.' }
  $statusAfter = @(Invoke-Git @('status', '--porcelain=v1', '--untracked-files=all', '--', 'deploy.bat', 'tdk-pos', $excludeLocalHttps))
  if (($statusAfter -join "`n") -cne ($scopeStatus -join "`n")) { throw 'TDKON file list changed during tests. Review it before committing.' }

  if ($previewPaths.Count) {
    Write-Output 'Staging only reviewed TDKON paths...'
    Invoke-ScopedAdd
    $actualPaths = @(Invoke-Git @('diff', '--cached', '--name-only', $originalHead, '--'))
    Assert-ScopedPaths $actualPaths
    if (($actualPaths -join "`n") -cne ($previewPaths -join "`n")) { throw 'Real staging differs from the reviewed preview. Staged files were preserved for inspection; no commit was made.' }
    Invoke-Git @('diff', '--cached', '--check', $originalHead, '--') | Out-Null
    $commitResult = @(Invoke-Git @('commit', '-m', 'TDKON QR recovery and guarded release automation'))
    $newHead = @(Invoke-Git @('rev-parse', 'HEAD'))[0].Trim()
    if ($newHead -eq $originalHead) { throw 'Git commit did not create a new release.' }
    Write-Output "Committed TDKON release: $newHead"
  } else {
    $newHead = $originalHead
    Write-Output "No new TDKON files to commit. Using existing main HEAD: $newHead"
  }

  $remoteBeforePush = @(Invoke-Git @('ls-remote', '--exit-code', 'origin', 'refs/heads/main'))
  if (($remoteBeforePush[0] -split '\s+')[0] -ne $originalHead) { throw 'Remote main changed during release preparation. Local commit remains; no push was attempted.' }
  if ($newHead -ne $remoteHead) {
    Write-Output 'Pushing reviewed TDKON release to origin/main (no force push)...'
    Invoke-Git @('push', 'origin', 'main') | Out-Null
  }
  $remoteAfter = @(Invoke-Git @('ls-remote', '--exit-code', 'origin', 'refs/heads/main'))
  if (($remoteAfter[0] -split '\s+')[0] -ne $newHead) { throw 'Remote main does not match the committed release SHA.' }
  Write-Output "RELEASE COMMIT AND PUSH VERIFIED: $newHead"
} catch {
  Write-Host "RELEASE PREPARATION STOPPED: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  if ($null -eq $savedIndex) { Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue }
  else { $env:GIT_INDEX_FILE = $savedIndex }
  if (Test-Path -LiteralPath $previewIndex) { Remove-Item -LiteralPath $previewIndex -Force }
  Set-Location -LiteralPath $repo
}
