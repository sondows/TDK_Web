@echo off
setlocal
cd /d "%~dp0"
if "%~1"=="" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tdk-pos\deploy\release.ps1" -Mode Auto
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tdk-pos\deploy\release.ps1" %*
)
exit /b %ERRORLEVEL%
