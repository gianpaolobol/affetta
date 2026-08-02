@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0backend\p4-1\PREPARA_E_COLLAUDA_P4_1_BETA.ps1" -RepoPath "%~dp0"
exit /b %ERRORLEVEL%
