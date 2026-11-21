@echo off
rem ERME BOOKS - tek tikla kurulum (Windows). Asil isi kurulum.ps1 yapar.
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kurulum.ps1"
echo.
pause
