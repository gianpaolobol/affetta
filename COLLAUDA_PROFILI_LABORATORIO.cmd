@echo off
setlocal
cd /d "%~dp0"
echo AFFETTA 0.5.1 - COLLAUDO STATICO PROFILI LABORATORIO
node "%~dp0scripts\fleet-profile-selftest.mjs"
echo.
echo Report: C:\AFFETTA\data\fleet-profile-selftest.json
pause
