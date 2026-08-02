@echo off
setlocal
cd /d "%~dp0.."
if not exist "dist\src\index.js" (
  echo Build non presente. Eseguo la compilazione...
  call npm run build
  if errorlevel 1 exit /b 1
)
call npm start
exit /b %errorlevel%
