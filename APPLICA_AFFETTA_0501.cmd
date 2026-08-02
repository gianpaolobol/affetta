@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\apply-update-windows.ps1" -Target "C:\AFFETTA"
pause
