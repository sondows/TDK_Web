param(
    [ValidateRange(0, 60)]
    [int]$StartupDelaySeconds = 0
)

$ErrorActionPreference = 'Stop'
$posUrl = 'https://tdkon.myasustor.com/tdkpos'
$profilePath = Join-Path $env:LOCALAPPDATA 'TDK-POS\EdgeProfile'
$sessionId = (Get-Process -Id $PID).SessionId

if ($StartupDelaySeconds -gt 0) { Start-Sleep -Seconds $StartupDelaySeconds }

$managedRoots = @(Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" -ErrorAction Stop |
    Where-Object {
        $_.SessionId -eq $sessionId -and
        $_.CommandLine -and
        $_.CommandLine.IndexOf('--user-data-dir=', [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $_.CommandLine.IndexOf($profilePath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $_.CommandLine -notmatch '(^|\s)--type='
    })

if ($managedRoots.Count -eq 1 -and
    $managedRoots[0].CommandLine.IndexOf($posUrl, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
    $managedRoots[0].CommandLine.IndexOf('--kiosk', [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
    $managedRoots[0].CommandLine.IndexOf('--edge-kiosk-type=fullscreen', [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
    Write-Output "TDKPOS kiosk is already running at the HTTPS address (PID $($managedRoots[0].ProcessId))."
    exit 0
}

# Replace stale dedicated-profile instances (including old LAN/localhost URLs)
# without touching a user's normal Edge profile.
if ($managedRoots.Count -gt 0) {
    $taskkill = Join-Path $env:WINDIR 'System32\taskkill.exe'
    foreach ($root in $managedRoots) {
        & $taskkill /PID $root.ProcessId /T /F | Out-Null
        if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $root.ProcessId -ErrorAction SilentlyContinue)) {
            throw "Could not stop stale TDKPOS Edge process $($root.ProcessId)."
        }
    }
    foreach ($root in $managedRoots) {
        $deadline = [DateTime]::UtcNow.AddSeconds(10)
        while ([DateTime]::UtcNow -lt $deadline -and (Get-Process -Id $root.ProcessId -ErrorAction SilentlyContinue)) {
            Start-Sleep -Milliseconds 200
        }
        if (Get-Process -Id $root.ProcessId -ErrorAction SilentlyContinue) {
            throw "Stale TDKPOS Edge process $($root.ProcessId) did not exit."
        }
    }
}

$edgeCandidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

if (-not $edgeCandidates) { throw 'Microsoft Edge executable was not found.' }
New-Item -ItemType Directory -Path $profilePath -Force | Out-Null
$edge = $edgeCandidates[0]
$profileArgument = '--user-data-dir="{0}"' -f $profilePath
$process = Start-Process -FilePath $edge -ArgumentList @(
    '--kiosk',
    $posUrl,
    '--edge-kiosk-type=fullscreen',
    $profileArgument,
    '--no-first-run',
    '--no-default-browser-check'
) -PassThru

Write-Output "TDKPOS kiosk started (PID $($process.Id))."
