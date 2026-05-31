@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0close-phone-access.ps1"
