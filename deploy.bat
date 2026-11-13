@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul

cd /d "%~dp0"
set "EXIT_CODE=1"

echo.
echo ==========================================
echo          TDKPOS deployment
echo ==========================================
echo.

set "FAILED_STAGE=Git repository check"
git rev-parse --show-toplevel >nul 2>&1
if errorlevel 1 goto failed
if not exist "tdk-pos\package.json" goto failed
where git >nul 2>&1
if errorlevel 1 goto failed
where ssh >nul 2>&1
if errorlevel 1 goto failed

for /f "delims=" %%B in ('git branch --show-current') do set "BRANCH=%%B"
if not "%BRANCH%"=="main" goto wrong_branch
git remote get-url origin >nul 2>&1
if errorlevel 1 goto failed

echo [1/4] Review deployment scope
echo.
git status --short -- deploy.bat tdk-pos
if errorlevel 1 goto failed
echo.
echo Only deploy.bat and changes under tdk-pos will be committed.
echo Other staged paths will remain staged and will not be included.
echo Database migrations are never run by this script.
echo.
choice /c YN /n /m "Have you independently verified all required production schema? [Y/N] "
if errorlevel 2 goto cancelled
echo.
choice /c YN /n /m "Push and deploy TDKPOS to the NAS now? [Y/N] "
if errorlevel 2 goto cancelled

set "FAILED_STAGE=NAS deployment preflight"
ssh -tt sondows@192.168.0.83 "export PATH=/opt/bin:/opt/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH; cd /volume1/TDK-POS/tdk-pos || { echo '[FAIL] NAS TDKPOS directory is unavailable'; exit 21; }; test -f .env.production || { echo '[FAIL] NAS .env.production is missing'; exit 22; }; tr -d '\r' < .env.production | grep -Eq '^KASI_HOLIDAY_ENCRYPTION_KEY_PROD=[[:xdigit:]]{64}$' || { echo '[FAIL] KASI production key is missing or invalid (value hidden)'; exit 23; }; test -d storage/qr-title || { echo '[FAIL] storage/qr-title directory is missing'; exit 24; }; test -d storage/qr-notices || { echo '[FAIL] storage/qr-notices directory is missing'; exit 25; }; echo '[OK] NAS deployment prerequisites passed'"
if errorlevel 1 goto failed

set "FAILED_STAGE=Stage deployment paths"
git add -A -- deploy.bat tdk-pos
if errorlevel 1 goto failed

set "FAILED_STAGE=Validate staged deployment paths"
git diff --cached --check -- deploy.bat tdk-pos
if errorlevel 1 goto failed
git diff --cached --quiet -- deploy.bat tdk-pos
if errorlevel 1 (
    set "FAILED_STAGE=Commit deployment paths"
    git commit -m "Update TDKPOS" --only -- deploy.bat tdk-pos
    if errorlevel 1 goto failed
) else (
    echo [INFO] No deployment-path changes to commit.
)

set "FAILED_STAGE=Push main"
git push origin main
if errorlevel 1 goto failed

echo.
echo [2/4] Update NAS source
echo.
set "FAILED_STAGE=NAS fast-forward update"
ssh -tt sondows@192.168.0.83 "export PATH=/opt/bin:/opt/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH; cd /volume1/TDK-POS && git fetch origin && git checkout main && git pull --ff-only origin main"
if errorlevel 1 goto failed

echo.
echo [3/4] Build and replace TDKPOS container
echo.
set "FAILED_STAGE=TDKPOS Docker deployment"
ssh -tt sondows@192.168.0.83 "export PATH=/opt/bin:/opt/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH; cd /volume1/TDK-POS/tdk-pos && sudo -v && OLD_IMAGE_ID=$(sudo docker inspect --format='{{.Image}}' tdk-pos-tdk-pos-1) && OLD_IMAGE_TAG=$(sudo docker inspect --format='{{.Config.Image}}' tdk-pos-tdk-pos-1) && sudo docker image tag $OLD_IMAGE_ID tdk-pos:backup-before-deploy && sudo docker compose build tdk-pos && (sudo docker compose up -d --no-deps --force-recreate tdk-pos || { echo '[ROLLBACK] Restore previous image'; sudo docker image tag tdk-pos:backup-before-deploy $OLD_IMAGE_TAG && sudo docker compose up -d --no-deps tdk-pos; exit 1; }) && sleep 5 && sudo docker compose ps tdk-pos"
if errorlevel 1 goto failed

echo.
echo [4/4] Deployment complete
set "EXIT_CODE=0"
goto finish

:wrong_branch
echo [ERROR] Deployment is allowed only from main.
goto finish

:cancelled
echo [INFO] Deployment cancelled. No files were staged or changed by this script.
set "EXIT_CODE=0"
goto finish

:failed
echo.
echo [ERROR] Deployment failed at: %FAILED_STAGE%
set "EXIT_CODE=1"

:finish
echo.
pause
exit /b %EXIT_CODE%
