$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'auto-release.ps1'
$helper = Join-Path $PSScriptRoot 'nas-release.sh'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'auto-release.ps1 has a parse error.' }
$functionAst = $ast.Find({ param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-Nas'
}, $true)
if (-not $functionAst) { throw 'Invoke-Nas was not found.' }
. ([ScriptBlock]::Create($functionAst.Extent.Text))

$sshTarget = 'test-nas'
$sshOptions = @('-tt')
$script:seenSsh = @()
function ssh {
  $script:seenSsh = @($args)
  $global:LASTEXITCODE = 0
  'TEST_RESULT=ok'
}

$result = @(Invoke-Nas 'inspect')
if ($result -notcontains 'TEST_RESULT=ok') { throw 'NAS result was not captured.' }
if ($script:seenSsh -notcontains '-tt' -or $script:seenSsh -contains '-T') { throw 'Interactive SSH terminal was not requested.' }
$remoteCommand = "$($script:seenSsh[-1])"
if ($remoteCommand -notmatch 'TDK_INTERACTIVE_SUDO=1' -or $remoteCommand -notmatch 'sh -s -- inspect') {
  throw 'Interactive sudo or inspect action was not forwarded.'
}
$match = [regex]::Match($remoteCommand, 'printf %s ([A-Za-z0-9+/=]+) \| base64 -d \| sh -s --')
if (-not $match.Success) { throw 'Encoded NAS helper was not found.' }
$decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($match.Groups[1].Value))
$expected = (Get-Content -LiteralPath $helper -Raw -Encoding UTF8).Replace("`r`n", "`n")
if ($decoded -cne $expected) { throw 'NAS helper payload changed during transport.' }
$nativeJson = & node -e 'console.log(JSON.stringify(process.argv.at(-1)))' $remoteCommand
$nativeReceived = ConvertFrom-Json $nativeJson
if ($nativeReceived -cne $remoteCommand) {
  $firstDifference = 0
  while ($firstDifference -lt [Math]::Min($nativeReceived.Length, $remoteCommand.Length) -and
         $nativeReceived[$firstDifference] -ceq $remoteCommand[$firstDifference]) { $firstDifference++ }
  throw "Native argument passing changed the SSH command at character $firstDifference (received $($nativeReceived.Length), expected $($remoteCommand.Length))."
}
$localShell = 'C:\Program Files\Git\bin\sh.exe'
if (-not (Test-Path -LiteralPath $localShell)) { throw 'Git Bash shell is unavailable for transport validation.' }
$decodeCommand = $remoteCommand -replace '\| sh -s -- inspect\s*$', '| sha256sum'
if ($decodeCommand -ceq $remoteCommand) { throw 'Could not isolate NAS helper decoding.' }
$testFileName = '.transport-check-' + [guid]::NewGuid().ToString('N') + '.sh'
$testFile = Join-Path $PSScriptRoot $testFileName
try {
  [IO.File]::WriteAllText($testFile, $decodeCommand, (New-Object Text.UTF8Encoding($false)))
  $decodedHashOutput = @(& $localShell (Join-Path 'tdk-pos/deploy' $testFileName))
  if ($LASTEXITCODE -ne 0) { throw 'NAS helper payload could not be decoded by the shell.' }
} finally {
  if (Test-Path -LiteralPath $testFile) { Remove-Item -LiteralPath $testFile -Force }
}
$expectedHash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($expected))).Replace('-', '').ToLowerInvariant()
if (-not @($decodedHashOutput | Where-Object { $_ -match "^$expectedHash\s" }).Count) {
  throw 'The shell decoded a different NAS helper payload.'
}

$beforeInvalid = $script:seenSsh.Count
try { Invoke-Nas 'inspect;echo injected' | Out-Null; throw 'Unsafe NAS action was accepted.' }
catch { if ($_.Exception.Message -eq 'Unsafe NAS action was accepted.') { throw } }
if ($script:seenSsh.Count -ne $beforeInvalid) { throw 'Unsafe NAS action reached SSH.' }

Write-Output 'PASS: interactive SSH terminal, helper payload, native argument passing, captured result, action validation'
