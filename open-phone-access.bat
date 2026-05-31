@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0open-phone-access.ps1"
