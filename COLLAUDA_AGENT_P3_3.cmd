@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent\p3-3\PREPARA_E_COLLAUDA_P3_3_AGENT.ps1" -RepoPath "%~dp0"
exit /b %errorlevel%
