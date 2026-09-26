param([switch]$Unregister)
$ErrorActionPreference = 'Stop'
$taskName = 'TDK POS Auto Start'
if ($Unregister) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
  Write-Host "Removed scheduled task: $taskName"
  exit
}
$launcher = Join-Path $PSScriptRoot 'start-pos.cmd'
if (-not (Test-Path -LiteralPath $launcher)) { throw "Launcher missing: $launcher" }
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c "{0}"' -f $launcher) -WorkingDirectory (Split-Path $launcher)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Start TDK POS and check for a safe update at Windows sign-in.' -Force | Out-Null
Write-Host "Registered scheduled task: $taskName"
