function Get-PosPortPid {
  $connection = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($connection) { return [int]$connection.OwningProcess }
  foreach ($line in (& netstat.exe -ano -p tcp 2>$null)) {
    if ($line -match '^\s*TCP\s+\S+:3000\s+\S+\s+LISTENING\s+(\d+)\s*$') { return [int]$Matches[1] }
  }
  return $null
}

function Get-ManagedPos {
  if (-not (Test-Path -LiteralPath $processFile)) { return $null }
  try {
    $marker = Get-Content -LiteralPath $processFile -Raw | ConvertFrom-Json
    $pidNumber = [int]$marker.nodePid
    if ($pidNumber -le 0 -or (Get-PosPortPid) -ne $pidNumber) { return $null }
    $process = Get-Process -Id $pidNumber -ErrorAction Stop
    if ($process.ProcessName -ne 'node' -or $process.StartTime.ToUniversalTime().Ticks -ne [long]$marker.startTicks) { return $null }
    return $marker
  } catch { return $null }
}

function Stop-ManagedPos {
  $marker = Get-ManagedPos
  if (-not $marker) { return $false }
  Stop-Process -Id ([int]$marker.nodePid) -ErrorAction Stop
  for ($i = 0; $i -lt 10; $i++) {
    if ((Get-PosPortPid) -ne [int]$marker.nodePid) { break }
    Start-Sleep -Milliseconds 250
  }
  if ((Get-PosPortPid) -eq [int]$marker.nodePid) { return $false }
  Remove-Item -LiteralPath $processFile -Force
  return $true
}
