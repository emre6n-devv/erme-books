@echo off
rem ERME BOOKS - Kurulum.exe olusturucu (gelistirici icin). Asil isi kurulum_olustur.ps1 yapar.
chcp 65001 >NUL
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kurulum_olustur.ps1"
echo.
pause
