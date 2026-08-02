@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0backend\p4-2\PREPARA_E_COLLAUDA_P4_2_BETA.ps1" -RepoPath "%~dp0"
pause
