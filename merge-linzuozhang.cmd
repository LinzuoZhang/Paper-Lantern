@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0merge-linzuozhang.ps1"
endlocal
