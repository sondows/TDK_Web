$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'simple-release.ps1'
$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count) { throw 'Simple release PowerShell syntax failed.' }
$global:seenSsh = @()
$global:mockSha = 'a' * 40
function git {
  $global:LASTEXITCODE = 0
  $command = ($args -join ' ')
  if ($command -match 'branch --show-current') { return 'main' }
  if ($command -match 'rev-parse HEAD') { return $global:mockSha }
  if ($command -match 'ls-remote origin refs/heads/main') { return "$($global:mockSha)`trefs/heads/main" }
  if ($command -match 'status --porcelain=v1') { return }
  throw "Unexpected Git command: $command"
}
function ssh {
  $global:seenSsh = @($args)
  $global:LASTEXITCODE = 0
}
& $scriptPath
if ($LASTEXITCODE -ne 0) { throw 'Simple release controller failed with mocked Git and SSH.' }
if ($global:seenSsh -notcontains '-tt') { throw 'SSH did not request a terminal for sudo.' }
$remoteCommand = "$($global:seenSsh[-1])"
if ($remoteCommand -notmatch ('\| base64 -d \| sh -s -- a{40} -$')) { throw 'Release SHA or default Agent argument was not passed to NAS.' }
$match = [regex]::Match($remoteCommand, '^printf %s ([A-Za-z0-9+/=]+) \| base64 -d')
if (-not $match.Success) { throw 'NAS helper payload was not encoded.' }
$decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($match.Groups[1].Value))
$expected = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'simple-nas-release.sh') -Raw -Encoding UTF8).Replace("`r`n", "`n")
if ($decoded -cne $expected) { throw 'NAS helper payload changed during transport.' }
Write-Output 'PASS: simple release controller, committed SHA, SSH terminal, exact helper payload'
