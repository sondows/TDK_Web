@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul

set "EXIT_CODE=1"
set "FAILED_STAGE=Initialization"
set "STATUS_FILE="
set "DEPLOY_COMMIT_FILE="

cd /d "%~dp0"
if errorlevel 1 goto failed
if not exist ".git" goto failed

set "FAILED_STAGE=Tool check"
where git >nul 2>&1
if errorlevel 1 goto failed
where ssh >nul 2>&1
if errorlevel 1 goto failed
where powershell.exe >nul 2>&1
if errorlevel 1 goto failed

set "FAILED_STAGE=Git branch check"
set "CURRENT_BRANCH="
for /f "delims=" %%B in ('git branch --show-current') do set "CURRENT_BRANCH=%%B"
if not "%CURRENT_BRANCH%"=="main" goto failed
git remote get-url origin >nul 2>&1
if errorlevel 1 goto failed

set "FAILED_STAGE=Git status"
set "STATUS_FILE=%TEMP%\tdk-pos-deploy-status-%RANDOM%-%RANDOM%.tmp"
git status --porcelain --untracked-files=normal > "%STATUS_FILE%"
if errorlevel 1 goto failed
set "HAS_CHANGES="
for %%F in ("%STATUS_FILE%") do if %%~zF GTR 0 set "HAS_CHANGES=1"
del /q "%STATUS_FILE%" >nul 2>&1
set "STATUS_FILE="
if not defined HAS_CHANGES goto push

set "FAILED_STAGE=Commit message"
set "DEPLOY_COMMIT_MESSAGE="
set /p "DEPLOY_COMMIT_MESSAGE=Commit message: "
if not defined DEPLOY_COMMIT_MESSAGE goto failed
set "DEPLOY_COMMIT_FILE=%TEMP%\tdk-pos-deploy-commit-%RANDOM%-%RANDOM%.txt"
powershell.exe -NoLogo -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; [System.IO.File]::WriteAllText($env:DEPLOY_COMMIT_FILE, $env:DEPLOY_COMMIT_MESSAGE, [System.Text.UTF8Encoding]::new($false))"
if errorlevel 1 goto failed

set "FAILED_STAGE=Git add"
git add .
if errorlevel 1 goto failed
set "FAILED_STAGE=Git commit"
git commit -F "%DEPLOY_COMMIT_FILE%"
if errorlevel 1 goto failed
del /q "%DEPLOY_COMMIT_FILE%" >nul 2>&1
set "DEPLOY_COMMIT_FILE="

:push
echo [INFO] Pushing main to origin...
set "FAILED_STAGE=Git push"
git push origin main
if errorlevel 1 goto failed

echo [INFO] Deploying origin/main on NAS...
set "FAILED_STAGE=NAS SSH / deployment"
ssh -tt sondows@192.168.0.83 "export PATH=/opt/bin:/opt/sbin:$PATH || { echo [FAIL] NAS Entware PATH; exit 20; }; cd /volume1/TDK-POS || { echo [FAIL] NAS repository directory; exit 21; }; git fetch origin || { echo [FAIL] NAS git fetch; exit 22; }; git checkout main || { echo [FAIL] NAS git checkout; exit 23; }; git reset --hard origin/main || { echo [FAIL] NAS git reset; exit 24; }; cd /volume1/TDK-POS/tdk-pos || { echo [FAIL] NAS compose directory; exit 25; }; sudo docker compose up -d --build || { echo [FAIL] Docker compose build/start; exit 26; }; sudo docker compose ps || { echo [FAIL] Docker compose ps; exit 27; }"
if errorlevel 1 goto failed

echo [OK] Deployment finished. Check the tdk-pos status above.
set "EXIT_CODE=0"
goto finish

:failed
echo [FAIL] %FAILED_STAGE% failed. Deployment stopped.

:finish
if defined STATUS_FILE if exist "%STATUS_FILE%" del /q "%STATUS_FILE%" >nul 2>&1
if defined DEPLOY_COMMIT_FILE if exist "%DEPLOY_COMMIT_FILE%" del /q "%DEPLOY_COMMIT_FILE%" >nul 2>&1
pause
exit /b %EXIT_CODE%
