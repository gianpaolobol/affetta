@echo off
setlocal
cd /d "%~dp0"
echo AFFETTA - Ripresa collaudo motori v0.4.4
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\verify-engines-windows.ps1"
set CODE=%ERRORLEVEL%
if not "%CODE%"=="0" (
  echo.
  echo Il collaudo ha segnalato un errore reale di un motore.
  echo Inviami i file data\profile-selftest.json e data\engine-selftest.json.
)
exit /b %CODE%
