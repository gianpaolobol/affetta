@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\AFFETTA\scripts\rollback-update-windows.ps1" -Target "C:\AFFETTA"
pause
