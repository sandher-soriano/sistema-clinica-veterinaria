@echo off
setlocal EnableDelayedExpansion
title Premier Can - Restaurar respaldo
set "PATH=%~dp0herramientas\node;%PATH%"
echo ============================================================
echo   RESTAURAR UN RESPALDO DE PREMIER CAN
echo   La base actual se REEMPLAZA por el respaldo que elijas.
echo   (Antes se guarda un respaldo del estado actual, por si acaso.)
echo ============================================================
echo.

set n=0
for /f "delims=" %%f in ('dir /b /o-d "%~dp0respaldos\PremierCanDB_*.bak" 2^>nul') do (
  set /a n+=1
  set "archivo!n!=%%f"
  echo   !n!^) %%f
)
if %n%==0 (
  echo No hay respaldos en la carpeta "respaldos".
  pause & exit /b
)
echo.
set /p eleccion=Numero del respaldo a restaurar (Enter para cancelar):
if "%eleccion%"=="" exit /b
set "elegido=!archivo%eleccion%!"
if "%elegido%"=="" (
  echo Numero invalido.
  pause & exit /b
)
echo.
set /p seguro=Escribe SI para reemplazar la base actual por %elegido%:
if /i not "%seguro%"=="SI" (
  echo Cancelado. No se cambio nada.
  pause & exit /b
)

rem El servidor no debe estar usando la base mientras se restaura
taskkill /fi "WINDOWTITLE eq Premier Can - Servidor*" /t /f >nul 2>&1
sc query MSSQLSERVER | find "RUNNING" >nul || net start MSSQLSERVER >nul

pushd "%~dp0backend"
node scripts\restaurar-bd.js "%~dp0respaldos\%elegido%" --confirmar
popd
echo.
echo Listo. Vuelve a abrir iniciar-premiercan.bat para usar el sistema.
pause
