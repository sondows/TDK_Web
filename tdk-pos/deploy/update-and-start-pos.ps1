param([switch]$NoBrowser, [switch]$NoUpdate)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repo = (Resolve-Path (Join-Path $project '..')).Path
$runtime = Join-Path $project '.pos-runtime'
$logDir = Join-Path $runtime 'logs'
$log = Join-Path $logDir 'pos-updater.log'
$stateFile = Join-Path $runtime 'state.json'
$url = 'http://localhost:3000/pos'
$mutex = New-Object System.Threading.Mutex($false, 'Local\TDK_POS_Auto_Start')
if (-not $mutex.WaitOne(0)) { exit 0 }

function Write-Log([string]$message) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
  Add-Content -LiteralPath $log -Value $line -Encoding UTF8
}
function Run([string]$file, [string[]]$arguments, [string]$at) {
  Push-Location $at
  try {
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $output = & $file @arguments 2>$null; $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $oldPreference }
    if ($code -ne 0) { throw "$file failed (exit $code)" }
    return $output
  } finally { Pop-Location }
}
function Git([string[]]$arguments) { return Run 'git.exe' $arguments $repo }
function Ready {
  try {
    $request = [Net.HttpWebRequest]::Create('http://localhost:3000/login')
    $request.Timeout = 2000
    $request.AllowAutoRedirect = $false
    $response = $request.GetResponse()
    try {
      if ([int]$response.StatusCode -ne 200) { return $false }
      $reader = New-Object IO.StreamReader($response.GetResponseStream())
      try { return ($reader.ReadToEnd().Contains('TDK POS')) }
      finally { $reader.Dispose() }
    }
    finally { $response.Close() }
  } catch [Net.WebException] {
    if ($_.Exception.Response) {
      $response = $_.Exception.Response
      try { return ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 400) }
      finally { $response.Close() }
    }
    return $false
  } catch { return $false }
}
function Browser {
  if ($NoBrowser) { return }
  $chrome = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  if ($chrome) {
    Start-Process -FilePath $chrome -ArgumentList @('--new-window', '--app=http://localhost:3000/pos') | Out-Null
    Write-Log 'Chrome POS window opened'
  } else { Write-Log 'Chrome not found; open http://localhost:3000/pos manually' }
}
function Start-Server([string]$path) {
  if (-not (Test-Path -LiteralPath (Join-Path $path '.next\BUILD_ID'))) { throw "No production build: $path" }
  if (Ready) { Write-Log 'Port 3000 already responds; no second server started'; return $true }
  $listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
  if ($listener) { Write-Log 'Port 3000 occupied by another process'; return $false }
  if ($path -ne $project) {
    foreach ($name in @('.env', '.env.local', '.env.production', '.env.production.local')) {
      $source = Join-Path $project $name
      $target = Join-Path $path $name
      if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $target -Force }
      elseif (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
    }
  }
  $oldStorage = $env:MENU_IMAGE_STORAGE_PATH
  try {
    # Keep default uploaded menu images outside the release folders.
    $configuredStorage = Select-String -Path (Join-Path $path '.env.local'), (Join-Path $path '.env') -Pattern '^\s*MENU_IMAGE_STORAGE_PATH\s*=' -ErrorAction SilentlyContinue
    if (-not $oldStorage -and -not $configuredStorage) {
      $env:MENU_IMAGE_STORAGE_PATH = Join-Path $project 'public\uploads\menu'
    }
    $env:PORT = '3000'
    $serverLog = Join-Path $logDir 'server.out.log'
    $serverError = Join-Path $logDir 'server.err.log'
    $process = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/s', '/c', 'npm run start') -WorkingDirectory $path -PassThru -WindowStyle Hidden -RedirectStandardOutput $serverLog -RedirectStandardError $serverError
    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep -Seconds 1
      if (Ready) {
        Write-Log "POS ready; process $($process.Id); path $path"
        return $true
      }
      $process.Refresh()
      if ($process.HasExited) { break }
    }
    Write-Log 'POS startup failed or timed out; see server.err.log'
    if (-not $process.HasExited) { & taskkill.exe /PID $process.Id /T /F 1>$null 2>$null }
    return $false
  } finally { $env:MENU_IMAGE_STORAGE_PATH = $oldStorage }
}

try {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 1MB) {
    $archive = Join-Path $logDir 'pos-updater.previous.log'
    Move-Item -LiteralPath $log -Destination $archive -Force
  }
  Write-Log 'Startup check begun'
  $rootHead = (Git @('rev-parse', 'HEAD') | Select-Object -First 1).Trim()
  $active = $project
  $activeHead = $rootHead
  $fallback = $null
  $fallbackHead = $null
  if (Test-Path -LiteralPath $stateFile) {
    $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    if ($state.previousPath -and (Test-Path -LiteralPath (Join-Path $state.previousPath '.next\BUILD_ID'))) {
      $fallback = $state.previousPath
      $fallbackHead = $state.previousCommit
    }
    if ($state.activePath -and (Test-Path -LiteralPath (Join-Path $state.activePath '.next\BUILD_ID'))) {
      $active = $state.activePath
      $activeHead = $state.activeCommit
    } elseif ($fallback) {
      $active = $fallback
      $activeHead = $fallbackHead
      $fallback = $project
      $fallbackHead = $rootHead
      Write-Log 'Saved release unavailable; using previous release'
    } else { Write-Log 'Saved release unavailable; using original project build' }
  }
  Write-Log "Current commit: $activeHead"
  if (Ready) {
    Write-Log 'Port 3000 already responds; leaving running server untouched'
    Browser
    exit 0
  }
  if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
    Write-Log 'Port 3000 is occupied by a server that did not pass the TDK POS check'
    exit 1
  }
  $candidate = $null
  if (-not $NoUpdate) {
    try {
      $dirty = (Git @('status', '--porcelain=v1', '--untracked-files=no') | Out-String).Trim()
      if ($dirty.Length -gt 0) { Write-Log 'Tracked local changes found; update skipped' }
      else {
        try {
          Git @('-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=10', 'fetch', '--no-tags', 'origin', 'main') | Out-Null
          $remoteHead = (Git @('rev-parse', 'refs/remotes/origin/main') | Select-Object -First 1).Trim()
          Write-Log "GitHub commit: $remoteHead"
          if ($remoteHead -eq $activeHead) { Write-Log 'Update needed: no' }
          else {
            Write-Log 'Update needed: yes'
            $isAncestor = $false
            try { Git @('merge-base', '--is-ancestor', $activeHead, $remoteHead) | Out-Null; $isAncestor = $true } catch {}
            if (-not $isAncestor) { Write-Log 'Remote history does not extend current release; update skipped' }
            else {
              $releaseName = '{0}-{1}' -f $remoteHead.Substring(0, 12), (Get-Date -Format 'yyyyMMddHHmmss')
              $releasePath = Join-Path $runtime (Join-Path 'releases' $releaseName)
              if (Test-Path -LiteralPath $releasePath) { throw 'Release folder already exists; manual inspection required' }
              New-Item -ItemType Directory -Path (Split-Path $releasePath) -Force | Out-Null
              Git @('worktree', 'add', '--detach', $releasePath, $remoteHead) | Out-Null
              $candidate = $releasePath
              Write-Log 'Git candidate checkout succeeded'
              foreach ($name in @('.env', '.env.local', '.env.production', '.env.production.local')) {
                $source = Join-Path $project $name
                if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $candidate $name) }
              }
              $oldPackage = (Git @('show', "${activeHead}:tdk-pos/package.json") | Out-String)
              $newPackage = (Git @('show', "${remoteHead}:tdk-pos/package.json") | Out-String)
              $oldLock = (Git @('show', "${activeHead}:tdk-pos/package-lock.json") | Out-String)
              $newLock = (Git @('show', "${remoteHead}:tdk-pos/package-lock.json") | Out-String)
              $sourceModules = Join-Path $active 'node_modules'
              if ($oldPackage -eq $newPackage -and $oldLock -eq $newLock -and (Test-Path -LiteralPath $sourceModules)) {
                New-Item -ItemType Junction -Path (Join-Path $candidate 'node_modules') -Target $sourceModules | Out-Null
                Write-Log 'Dependencies unchanged; existing node_modules reused'
              } else {
                Run 'npm.cmd' @('ci', '--include=dev', '--no-audit', '--no-fund') $candidate | Out-Null
                Write-Log 'npm ci succeeded'
              }
              Run 'npm.cmd' @('run', 'build') $candidate | Out-Null
              if (-not (Test-Path -LiteralPath (Join-Path $candidate '.next\BUILD_ID'))) { throw 'Build ID missing after build' }
              Write-Log 'Production build succeeded'
            }
          }
        } catch { Write-Log "Update failed: $($_.Exception.Message)"; $candidate = $null }
      }
    } catch { Write-Log "Update check failed: $($_.Exception.Message)" }
  } else { Write-Log 'Update manually skipped' }
  if ($candidate) {
    if (Start-Server $candidate) {
      @{ activePath = $candidate; activeCommit = $remoteHead; previousPath = $active; previousCommit = $activeHead } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
      Write-Log 'New release activated'
      Browser
      exit 0
    }
    Write-Log 'New release could not start; starting previous release'
  }
  if (Start-Server $active) { Browser; exit 0 }
  Write-Log 'POS startup failed for active release'
  if ($fallback -and $fallback -ne $active -and (Start-Server $fallback)) {
    @{ activePath = $fallback; activeCommit = $fallbackHead; previousPath = $project; previousCommit = $rootHead } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
    Write-Log 'Previous working release restored'
    Browser
    exit 0
  }
  exit 1
} catch {
  if (Test-Path -LiteralPath $logDir) { Write-Log "Fatal error: $($_.Exception.Message)" }
  exit 1
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
