param()

$securePin = Read-Host "OWNER PIN" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePin)

try {
  $env:OWNER_PIN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  node .\scripts\create-owner.mjs
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Item Env:OWNER_PIN -ErrorAction SilentlyContinue
}
