@echo off
setlocal
cd /d "%~dp0.."

echo [Affetta Agent] Verifica Node.js...
where node >nul 2>nul || (
  echo ERRORE: Node.js non trovato. Installa Node.js 24 LTS.
  exit /b 1
)
node -e "const m=Number(process.versions.node.split('.')[0]); if(m<22){console.error('Richiesto Node.js 22.16 o superiore; raccomandato 24 LTS.');process.exit(1)}"
if errorlevel 1 exit /b 1

if not exist ".env" copy /y ".env.example" ".env" >nul
if not exist "agent-data" mkdir "agent-data"
icacls "agent-data" /inheritance:r /grant:r "%USERNAME%:(OI)(CI)F" >nul 2>nul

echo [Affetta Agent] Installazione dipendenze...
call npm install --no-package-lock
if errorlevel 1 exit /b 1

echo [Affetta Agent] Compilazione TypeScript...
call npm run build
if errorlevel 1 exit /b 1

echo.
echo Installazione completata.
echo Configura agent\.env, quindi esegui AVVIA_AGENT.cmd.
exit /b 0
