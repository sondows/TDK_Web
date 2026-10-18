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
set "FAILED_STAGE=NAS SSH connection or remote deployment"
ssh -tt sondows@192.168.0.83 "echo [OK] SSH connected; export PATH=/opt/bin:/opt/sbin:$PATH || { echo [FAIL] NAS Entware PATH; exit 20; }; echo [OK] NAS command path; cd /volume1/TDK-POS || { echo [FAIL] NAS repository directory; exit 21; }; echo [OK] NAS repository directory; git fetch origin || { echo [FAIL] git fetch origin; exit 22; }; echo [OK] git fetch origin; git checkout main || { echo [FAIL] git checkout main; exit 23; }; echo [OK] git checkout main; git reset --hard origin/main || { echo [FAIL] reset origin/main; exit 24; }; echo [OK] reset origin/main; cd /volume1/TDK-POS/tdk-pos || { echo [FAIL] compose directory; exit 25; }; echo [OK] compose directory; command -v sudo >/dev/null 2>&1 || { echo [FAIL] sudo command unavailable; exit 30; }; sudo -v || { echo [FAIL] sudo authentication or permission; exit 31; }; echo [OK] sudo authentication; sudo docker compose up -d --build || { echo [FAIL] docker compose build/start; exit 32; }; echo [OK] docker compose up -d --build; sudo docker compose ps || { echo [FAIL] docker compose ps; exit 33; }; echo [OK] containers started"
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
