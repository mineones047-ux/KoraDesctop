@echo off
echo ================================
echo   Kora - AI Desktop Assistant
echo ================================
echo.

echo [1/3] Compiling Electron...
call npx tsc --project tsconfig.electron.json
if errorlevel 1 (
    echo TypeScript compilation failed!
    pause
    exit /b 1
)

echo [2/3] Starting Vite dev server...
start "Vite" npx vite

echo [3/3] Waiting for Vite to be ready...
powershell -NoProfile -Command "$ok=$false; for ($i=0; $i -lt 30; $i++) { try { $r = Invoke-WebRequest -Uri 'http://localhost:5173' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -eq 200) { $ok=$true; break } } catch {}; Start-Sleep -Seconds 1 }; if (-not $ok) { exit 1 }"
if errorlevel 1 (
    echo Vite failed to start within 30 seconds!
    pause
    exit /b 1
)

echo Starting Electron...
set VITE_DEV_SERVER_URL=http://localhost:5173
call npx electron . --enable-logging

echo.
echo Kora closed.
pause