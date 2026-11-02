@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-pos-kiosk.ps1" %*
exit /b %ERRORLEVEL%
