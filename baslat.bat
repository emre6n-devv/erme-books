@echo off
rem ERME BOOKS - uygulamayi acar. Ilk seferde bagimliliklari kendisi kurar.
chcp 65001 >nul
cd /d "%~dp0uygulama-electron"
where npm 1>NUL 2>NUL || goto nonode
if not exist node_modules (
  echo Ilk calistirma: uygulama bagimliliklari kuruluyor, birkac dakika surebilir...
  call npm install --no-fund --no-audit || goto hata
)
call npm start || goto hata
exit /b 0
:nonode
echo Node.js bulunamadi. Once kurulum.bat dosyasini calistir.
pause
exit /b 1
:hata
echo.
echo Uygulama baslatilamadi. Yukaridaki mesaja bak ya da once kurulum.bat dosyasini calistir.
pause
exit /b 1
