@echo off
setlocal
cd /d "%~dp0.."
set "PIDFILE=agent-data\agent.pid"
if not exist "%PIDFILE%" (
  echo Nessun PID Agent trovato in %PIDFILE%.
  exit /b 0
)
set /p AGENT_PID=<"%PIDFILE%"
if "%AGENT_PID%"=="" (
  echo PID file vuoto.
  exit /b 1
)
taskkill /PID %AGENT_PID% /T
if errorlevel 1 exit /b 1
echo Arresto richiesto per PID %AGENT_PID%.
exit /b 0
