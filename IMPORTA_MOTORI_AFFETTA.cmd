@echo off
setlocal
cd /d "%~dp0"
set "SOURCE=%~1"
if "%SOURCE%"=="" set "SOURCE=%USERPROFILE%\Downloads"
echo.
echo AFFETTA - Importazione motori
 echo Cartella cercata: %SOURCE%
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\import-engines-windows.ps1" -SourceFolder "%SOURCE%"
if errorlevel 1 (
  echo.
  echo Importazione non completata.
  echo Puoi trascinare la cartella contenente i quattro file sopra IMPORTA_MOTORI_AFFETTA.cmd.
  pause
  exit /b 1
)
echo.
echo Importazione completata. Ora verra avviata la preparazione dei motori.
call "%~dp0PREPARA_MOTORI_AFFETTA.cmd"
endlocal
