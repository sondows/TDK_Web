param([switch]$NoBrowser, [switch]$NoUpdate, [switch]$RestartLegacy)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repo = (Resolve-Path (Join-Path $project '..')).Path
$runtime = Join-Path $project '.pos-runtime'
$logDir = Join-Path $runtime 'logs'
$log = Join-Path $logDir 'pos-updater.log'
$stateFile = Join-Path $runtime 'state.json'
$processFile = Join-Path $runtime 'pos-process.json'
$url = 'http://localhost:3000/pos'
. (Join-Path $PSScriptRoot 'pos-process.ps1')
$mutex = New-Object System.Threading.Mutex($false, 'Local\TDK_POS_Auto_Start')
if (-not $mutex.WaitOne(0)) { exit 0 }

function Write-Log([string]$message) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
  Add-Content -LiteralPath $log -Value $line -Encoding UTF8
}
function Error-Summary([System.Management.Automation.ErrorRecord]$record) {
  # Windows PowerShell can localize exception messages and a command may include secrets in them.
  # Keep the log stable and safe to read in CMD regardless of its current code page.
  if ($record.Exception.Message -match '^(git\.exe|npm\.cmd) failed \(exit \d+\)$') {
    return $record.Exception.Message
  }
  return $record.Exception.GetType().Name
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
function Get-PosResponse([string]$endpoint) {
  try {
    $request = [Net.HttpWebRequest]::Create("http://localhost:3000$endpoint")
    $request.Timeout = 2000
    $request.AllowAutoRedirect = $false
    $response = $request.GetResponse()
    try {
      $body = ''
      if ($endpoint -ne '/pos') {
        $reader = New-Object IO.StreamReader($response.GetResponseStream())
        try { $body = $reader.ReadToEnd() }
        finally { $reader.Dispose() }
      }
      return @{ Status = [int]$response.StatusCode; Body = $body; Location = $response.Headers['Location'] }
    }
    finally { $response.Close() }
  } catch [Net.WebException] {
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
      $_.Exception.Response.Close()
      return @{ Status = $status; Body = ''; Location = $null }
    }
    return @{ Status = 0; Body = ''; Location = $null }
  } catch { return @{ Status = 0; Body = ''; Location = $null } }
}
function Ready {
  $login = Get-PosResponse '/login'
  if ($login.Status -ne 200 -or -not $login.Body.Contains('TDK POS')) { return $false }
  $settings = Get-PosResponse '/api/pos-settings/login-mode'
  if ($settings.Status -ne 200) { return $false }
  try { $mode = ($settings.Body | ConvertFrom-Json).mode }
  catch { return $false }
  if ($mode -ne 'PERSONAL' -and $mode -ne 'SHARED') { return $false }
  $pos = Get-PosResponse '/pos'
  if ($pos.Status -eq 200) { return $true }
  if ($pos.Status -in @(307, 308) -and $pos.Location -match '^(/login|http://localhost:3000/login)(\?|$)') { return $true }
  return $false
}
function Write-HealthFailure {
  $login = Get-PosResponse '/login'
  $settings = Get-PosResponse '/api/pos-settings/login-mode'
  $pos = Get-PosResponse '/pos'
  Write-Log "Health check failed: login=$($login.Status), settings=$($settings.Status), pos=$($pos.Status)"
}
function Get-LegacyPos {
  $portPid = Get-PosPortPid
  if (-not $portPid -or -not (Test-Path -LiteralPath $log)) { return $null }
  $lines = @(Get-Content -LiteralPath $log | Select-Object -Last 200)
  for ($index = $lines.Count - 1; $index -ge 0; $index--) {
    $line = $lines[$index]
    if ($line -notmatch '^(?<when>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) POS ready; process (?<launcher>\d+); path (?<path>.+)$') { continue }
    $recordedPath = $Matches['path']
    $launcherPid = [int]$Matches['launcher']
    $stamp = [datetime]::ParseExact($Matches['when'], 'yyyy-MM-dd HH:mm:ss', [Globalization.CultureInfo]::InvariantCulture)
    if ($recordedPath -ne $project) { continue }
    $launcher = Get-Process -Id $launcherPid -ErrorAction SilentlyContinue
    $nodeProcess = Get-Process -Id $portPid -ErrorAction SilentlyContinue
    if (-not $launcher -or -not $nodeProcess -or $launcher.ProcessName -ne 'cmd' -or $nodeProcess.ProcessName -ne 'node') { continue }
    if ($launcher.StartTime -lt $stamp.AddMinutes(-2) -or $launcher.StartTime -gt $stamp) { continue }
    if ($nodeProcess.StartTime -lt $launcher.StartTime.AddSeconds(-3) -or $nodeProcess.StartTime -gt $stamp.AddSeconds(5)) { continue }
    return @{ nodePid = $portPid; launcherPid = $launcherPid }
  }
  return $null
}
function Stop-LegacyPos {
  $legacy = Get-LegacyPos
  if (-not $legacy) { return $false }
  Write-Log "Verified legacy POS launcher PID $($legacy.launcherPid), node PID $($legacy.nodePid)"
  Stop-Process -Id $legacy.nodePid -ErrorAction Stop
  for ($i = 0; $i -lt 20; $i++) {
    if ((Get-PosPortPid) -ne $legacy.nodePid) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return $false
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
  if (Get-PosPortPid) { Write-Log 'Port 3000 occupied by an unhealthy server'; return $false }
  if ($path -ne $project) {
    foreach ($name in @('.env', '.env.local', '.env.production', '.env.production.local')) {
      $source = Join-Path $project $name
      $target = Join-Path $path $name
      if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $target -Force }
      elseif (Test-Path -LiteralPath $target) { throw "Unexpected release environment file: $name" }
    }
  }
  $oldStorage = $env:MENU_IMAGE_STORAGE_PATH
  $oldNodeEnv = $env:NODE_ENV
  $oldPort = $env:PORT
  $oldPath = $env:PATH
  try {
    # Keep default uploaded menu images outside the release folders.
    $configuredStorage = $false
    $envFiles = @('.env.production.local', '.env.local', '.env.production', '.env') |
      ForEach-Object { Join-Path $path $_ } |
      Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }
    if ($envFiles.Count -gt 0) {
      $configuredStorage = [bool](Select-String -LiteralPath $envFiles -Pattern '^\s*MENU_IMAGE_STORAGE_PATH\s*=' -Quiet)
    }
    if (-not $oldStorage -and -not $configuredStorage) {
      $env:MENU_IMAGE_STORAGE_PATH = Join-Path $project 'public\uploads\menu'
    }
    $npm = (Get-Command npm.cmd -CommandType Application -ErrorAction Stop).Source
    $node = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
    $env:PATH = "$(Split-Path $node);$oldPath"
    $env:NODE_ENV = 'production'
    $env:PORT = '3000'
    Write-Log "Server working directory: $path"
    Write-Log "Server command: npm run start; npm: $npm; node: $node"
    Write-Log "Environment files present: $(($envFiles | ForEach-Object { Split-Path $_ -Leaf }) -join ', ')"
    Write-Log 'Server environment: production mode; inherited PATH retained with node directory first; environment values omitted'
    $inheritedDbNames = @('DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME') |
      Where-Object { $null -ne [Environment]::GetEnvironmentVariable($_, 'Process') }
    if ($inheritedDbNames.Count -gt 0) {
      Write-Log "Inherited DB variable names (values omitted): $($inheritedDbNames -join ', ')"
    }
    $serverLog = Join-Path $logDir 'pos-server.log'
    $serverError = Join-Path $logDir 'pos-server.err.log'
    $process = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/s', '/c', 'npm run start') -WorkingDirectory $path -PassThru -WindowStyle Hidden -RedirectStandardOutput $serverLog -RedirectStandardError $serverError
    if (-not (Test-Path -LiteralPath $serverLog -PathType Leaf) -or -not (Test-Path -LiteralPath $serverError -PathType Leaf)) {
      throw 'Server stdout or stderr log file was not created'
    }
    Write-Log "Server stdout log: $serverLog"
    Write-Log "Server stderr log: $serverError"
    $managedPid = $null
    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep -Seconds 1
      $portPid = Get-PosPortPid
      if ($portPid -and -not $managedPid) {
        $nodeProcess = Get-Process -Id $portPid -ErrorAction SilentlyContinue
        if ($nodeProcess -and $nodeProcess.ProcessName -eq 'node' -and $nodeProcess.StartTime -ge $process.StartTime.AddSeconds(-3)) {
          $managedPid = $portPid
          @{ nodePid = $portPid; startTicks = $nodeProcess.StartTime.ToUniversalTime().Ticks.ToString(); launcherPid = $process.Id; workingDirectory = $path } |
            ConvertTo-Json | Set-Content -LiteralPath $processFile -Encoding UTF8
        }
      }
      if ($managedPid -and (Ready)) {
        Write-Log "POS ready; node PID $managedPid; launcher PID $($process.Id)"
        return $true
      }
      $process.Refresh()
      if ($process.HasExited) { break }
    }
    Write-Log 'POS startup failed or timed out; see pos-server.err.log'
    Write-HealthFailure
    if (Test-Path -LiteralPath $serverError) {
      $errorText = Get-Content -LiteralPath $serverError -Raw -ErrorAction SilentlyContinue
      $codes = [regex]::Matches($errorText, "(?m)\bcode\s*:\s*['\x22]?([A-Z][A-Z0-9_]+)") |
        ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
      if ($codes) { Write-Log "Server error codes: $($codes -join ', ')" }
    }
    if ($managedPid) { Stop-ManagedPos | Out-Null }
    if (-not $process.HasExited) { & taskkill.exe /PID $process.Id /T /F 1>$null 2>$null }
    return $false
  } finally {
    $env:MENU_IMAGE_STORAGE_PATH = $oldStorage
    $env:NODE_ENV = $oldNodeEnv
    $env:PORT = $oldPort
    $env:PATH = $oldPath
  }
}
function Try-StartServer([string]$path) {
  try { return Start-Server $path }
  catch { Write-Log "POS launch failed: $(Error-Summary $_)"; return $false }
}

try {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 1MB) {
    $archive = Join-Path $logDir 'pos-updater.previous.log'
    Move-Item -LiteralPath $log -Destination $archive -Force
  }
  Write-Log 'Startup check begun'
  Write-Log "Updater script: $PSCommandPath; runtime directory: $runtime"
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
  Write-Log "Active server path: $active"
  if (Ready) {
    Write-Log 'Port 3000 already responds; leaving running server untouched'
    Browser
    exit 0
  }
  if (Get-PosPortPid) {
    Write-HealthFailure
    if (Get-ManagedPos) {
      Write-Log 'Managed POS server is unhealthy; stopping its recorded Node PID'
      if (-not (Stop-ManagedPos)) { Write-Log 'Could not stop managed POS server'; exit 1 }
    } elseif ($RestartLegacy -and (Get-LegacyPos)) {
      Write-Log 'Legacy POS restart explicitly requested'
      if (-not (Stop-LegacyPos)) { Write-Log 'Could not stop verified legacy POS server'; exit 1 }
    } else {
      Write-Log 'Port 3000 is occupied by an unhealthy unverified process; leaving it untouched'
      exit 1
    }
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
              $trackedEnvironment = (Git @('ls-tree', '-r', '--name-only', $remoteHead, '--', 'tdk-pos/.env', 'tdk-pos/.env.local', 'tdk-pos/.env.production', 'tdk-pos/.env.production.local') | Out-String).Trim()
              if ($trackedEnvironment.Length -gt 0) { throw 'Release tracks an environment file; update skipped' }
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
        } catch { Write-Log "Update failed: $(Error-Summary $_)"; $candidate = $null }
      }
    } catch { Write-Log "Update check failed: $(Error-Summary $_)" }
  } else { Write-Log 'Update manually skipped' }
  if ($candidate) {
    if (Try-StartServer $candidate) {
      @{ activePath = $candidate; activeCommit = $remoteHead; previousPath = $active; previousCommit = $activeHead } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
      Write-Log 'New release activated'
      Browser
      exit 0
    }
    Write-Log 'New release could not start; starting previous release'
  }
  if (Try-StartServer $active) { Browser; exit 0 }
  Write-Log 'POS startup failed for active release'
  if ($fallback -and $fallback -ne $active -and (Try-StartServer $fallback)) {
    @{ activePath = $fallback; activeCommit = $fallbackHead; previousPath = $project; previousCommit = $rootHead } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
    Write-Log 'Previous working release restored'
    Browser
    exit 0
  }
  exit 1
} catch {
  if (Test-Path -LiteralPath $logDir) { Write-Log "Fatal error: $(Error-Summary $_)" }
  exit 1
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
