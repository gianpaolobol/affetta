@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0COLLECT_RUNTIME_DIAGNOSTICS.ps1" -Root "C:\AFFETTA"
echo.
pause
