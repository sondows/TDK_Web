param(
    [switch]$Unregister,
    [string]$BackupDirectory
)

$ErrorActionPreference = 'Stop'
$taskName = 'TDK POS Auto Start'
$taskPath = '\'
$posTaskNamePattern = '(?i)^(?:TDK[\s_-]*POS|POS[\s_-]*TDK).*$'
$posActionPattern = '(?i)(start-pos-kiosk\.ps1|start-pos\.cmd|register-pos-task\.ps1|update-and-start-pos\.ps1|tdkon\.myasustor\.com/tdkpos|192\.168\.0\.83:3000/(?:tdkpos|pos)|(?:localhost|127\.0\.0\.1):3000/(?:tdkpos|pos)|TDK-POS[\\/]EdgeProfile)'

function Get-PosAutoStartTasks {
    foreach ($task in Get-ScheduledTask -ErrorAction Stop) {
        $actionText = ($task.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments) $($_.WorkingDirectory)" }) -join ' '
        if ($task.TaskName -match $posTaskNamePattern -or $actionText -match $posActionPattern) { $task }
    }
}

function Save-TaskBackup($tasks) {
    if ($tasks.Count -eq 0) { return $null }
    if ([string]::IsNullOrWhiteSpace($BackupDirectory)) {
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $BackupDirectory = Join-Path $env:LOCALAPPDATA "TDK-POS\TaskBackups\$stamp"
    }
    New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
    $manifest = @()
    $index = 0
    foreach ($task in $tasks) {
        $index++
        $xmlName = '{0:D2}-{1}.xml' -f $index, ([regex]::Replace($task.TaskName, '[^A-Za-z0-9._-]', '_'))
        $xmlPath = Join-Path $BackupDirectory $xmlName
        $xml = Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -ErrorAction Stop | Out-String
        [IO.File]::WriteAllText($xmlPath, $xml, [Text.UTF8Encoding]::new($false))
        $manifest += [pscustomobject]@{ TaskName = $task.TaskName; TaskPath = $task.TaskPath; XmlFile = $xmlName }
    }
    $manifestPath = Join-Path $BackupDirectory 'manifest.json'
    [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
    return $BackupDirectory
}

$launcher = Join-Path $PSScriptRoot 'start-pos-kiosk.ps1'
if (-not $Unregister -and -not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw "POS launcher missing: $launcher" }

# Enumerate and export every recognized TDK POS auto-start task before changing any.
$existingTasks = @(Get-PosAutoStartTasks)
$backupPath = Save-TaskBackup $existingTasks
foreach ($task in $existingTasks) {
    Unregister-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -Confirm:$false -ErrorAction Stop
}

if ($Unregister) {
    if ($backupPath) { Write-Host "Removed $($existingTasks.Count) POS auto-start task(s). Backup: $backupPath" }
    else { Write-Host 'No TDK POS auto-start tasks were registered.' }
    exit 0
}

$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -StartupDelaySeconds 12' -f $launcher
$action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Start TDKPOS from the HTTPS address in its dedicated Edge kiosk profile.' -Force | Out-Null

$registered = @(Get-PosAutoStartTasks)
if ($registered.Count -ne 1 -or $registered[0].TaskName -ne $taskName) {
    throw "Expected exactly one TDK POS auto-start task after registration; found $($registered.Count). Backup: $backupPath"
}
if ($registered[0].Settings.MultipleInstances -ne 'IgnoreNew') {
    throw "TDK POS auto-start task does not use IgnoreNew. Backup: $backupPath"
}

Write-Host "Registered one HTTPS-only POS auto-start task: $taskName"
if ($backupPath) { Write-Host "Previous task definitions were backed up to: $backupPath" }
