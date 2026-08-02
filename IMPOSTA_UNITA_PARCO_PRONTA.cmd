@echo off
setlocal
cd /d "%~dp0"
echo Elenco unita disponibile in config\fleet.json
set /p UNIT_ID=Inserisci unit_id da modificare:
set /p READY=Abilitare in produzione? Digita true oppure false:
node scripts\set-fleet-unit-ready.mjs "%UNIT_ID%" "%READY%"
pause
