@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\COLLECT_RUNTIME_DIAGNOSTICS.ps1" -Root "%~dp0"
echo.
pause
