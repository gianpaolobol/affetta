@echo off
setlocal
cd /d "%~dp0"
node --test server-lite\test\*.test.js
if errorlevel 1 exit /b 1
node server-lite\scripts\smoke.mjs
endlocal
