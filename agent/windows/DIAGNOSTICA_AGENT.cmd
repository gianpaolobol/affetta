@echo off
setlocal
cd /d "%~dp0.."
if not exist "dist\src\diagnostics.js" (
  call npm run build
  if errorlevel 1 exit /b 1
)
node dist\src\diagnostics.js > "agent-data\diagnostica-agent.json"
type "agent-data\diagnostica-agent.json"
echo.
echo Report salvato in agent\agent-data\diagnostica-agent.json
exit /b %errorlevel%
