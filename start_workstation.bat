@echo off
setlocal enabledelayedexpansion

title Market HFT OS — Workstation Launcher
cd /d "%~dp0"

echo ================================================================================
echo  MARKET HFT OS — LOCAL LOOPBACK OPERATOR WORKSTATION (Gate M7.0)
echo ================================================================================

rem Ensure logs directory exists
if not exist logs mkdir logs

rem Check if loopback daemon is already healthy
curl -s -f http://127.0.0.1:4310/api/health > nul 2>&1
if not errorlevel 1 (
    echo [Workstation] Daemon is already active at http://127.0.0.1:4310
    echo [Workstation] Launching operator terminal in default browser...
    start "" "http://127.0.0.1:4310"
    goto :done
)

echo [Workstation] Booting background loopback daemon on http://127.0.0.1:4310...
start "" /b cmd /c "npx tsx src/cli/workstationCli.ts > logs\workstation_daemon.log 2>&1"

echo [Workstation] Waiting for daemon to initialize...
set "healthy=0"
for /l %%i in (1,1,12) do (
    curl -s -f http://127.0.0.1:4310/api/health > nul 2>&1
    if not errorlevel 1 (
        set "healthy=1"
        goto :launched
    )
    timeout /t 1 /nobreak > nul
)

:launched
if "!healthy!"=="1" (
    echo [Workstation] Daemon successfully verified healthy at http://127.0.0.1:4310!
    echo [Workstation] Launching operator terminal in default browser...
    start "" "http://127.0.0.1:4310"
    goto :done
) else (
    echo [Workstation] WARNING: Loopback daemon did not respond within 12 seconds.
    echo [Workstation] Check logs\workstation_daemon.log for diagnostic details.
    if exist "dist\POC-001_Standalone_Workstation.html" (
        echo [Workstation] Opening offline standalone HTML fallback...
        start "" "dist\POC-001_Standalone_Workstation.html"
    )
)

:done
echo ================================================================================
