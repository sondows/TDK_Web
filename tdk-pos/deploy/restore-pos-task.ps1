param([Parameter(Mandatory = $true)][string]$BackupDirectory)

$ErrorActionPreference = 'Stop'
$BackupDirectory = (Resolve-Path -LiteralPath $BackupDirectory).Path
$manifestPath = Join-Path $BackupDirectory 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Task backup manifest.json is missing.' }
$manifest = @(Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json)
if ($manifest.Count -eq 0) { throw 'Task backup manifest is empty.' }

# Back up and remove the currently installed POS tasks before restoring the snapshot.
$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$registerScript = Join-Path $PSScriptRoot 'register-pos-task.ps1'
& $powerShell -NoProfile -ExecutionPolicy Bypass -File $registerScript -Unregister
if ($LASTEXITCODE -ne 0) { throw 'Could not remove the current POS auto-start task(s).' }

$schtasks = Join-Path $env:WINDIR 'System32\schtasks.exe'
foreach ($entry in $manifest) {
    $xmlPath = Join-Path $BackupDirectory ([string]$entry.XmlFile)
    if (-not (Test-Path -LiteralPath $xmlPath -PathType Leaf)) { throw "Task XML is missing: $($entry.XmlFile)" }
    $fullTaskName = ([string]$entry.TaskPath) + ([string]$entry.TaskName)
    & $schtasks /Create /TN $fullTaskName /XML $xmlPath /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not restore scheduled task: $fullTaskName" }
}

Write-Host "Restored $($manifest.Count) scheduled task definition(s) from $BackupDirectory"
