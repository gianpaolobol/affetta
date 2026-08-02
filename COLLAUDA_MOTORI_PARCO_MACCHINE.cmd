@echo off
setlocal
cd /d "%~dp0"
node scripts\lab-fleet-live-selftest.mjs
if errorlevel 1 (
  echo.
  echo COLLAUDO MOTORI PARCO MACCHINE NON SUPERATO.
  echo Consulta data\lab-fleet-live-selftest.json
) else (
  echo.
  echo COLLAUDO MOTORI PARCO MACCHINE SUPERATO.
)
pause
