@echo off
REM ============================================================
REM ERIC Robotics — Insight.IO Dashboard
REM Double-click to run! (Windows batch file)
REM ============================================================

echo.
echo   ===================================================
echo   ERIC Robotics - Insight.IO Dashboard
echo   One-Click Launcher
echo   ===================================================
echo.

cd /d "%~dp0"

where docker >nul 2>nul
if %errorlevel%==0 (
    echo [*] Docker detected. Starting full stack...
    powershell -ExecutionPolicy Bypass -File "%~dp0setup.ps1" -Mode full
    goto :eof
)

echo [!] Docker not found. Falling back to frontend demo mode.
powershell -ExecutionPolicy Bypass -File "%~dp0setup.ps1" -Mode frontend
