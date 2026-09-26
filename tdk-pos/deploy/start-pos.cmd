@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-and-start-pos.ps1" %*
set "pos_result=%ERRORLEVEL%"
if exist "%~dp0..\.pos-runtime\logs\pos-server.log" (echo pos-server.log: present) else (echo pos-server.log: missing)
if exist "%~dp0..\.pos-runtime\logs\pos-server.err.log" (echo pos-server.err.log: present) else (echo pos-server.err.log: missing)
exit /b %pos_result%
