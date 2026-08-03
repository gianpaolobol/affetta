@echo off
setlocal
cd /d "%~dp0"
if not exist "server-lite\config\local-server.json" (
  copy /Y "server-lite\config\local-server.example.json" "server-lite\config\local-server.json" >nul
  echo Creato server-lite\config\local-server.json. Configurare IP e stampanti prima del collaudo reale.
)
node server-lite\src\index.js
endlocal
