@echo off
title Premier Can - Detener
set "PATH=%~dp0herramientas\node;%PATH%"
rem Apaga el servidor, guarda un respaldo de la base y las fotos, y apaga ngrok y SQL Server.
taskkill /fi "WINDOWTITLE eq Premier Can - Servidor*" /t /f >nul 2>&1

echo Guardando respaldo de la base de datos...
sc query MSSQLSERVER | find "RUNNING" >nul && (
  pushd "%~dp0backend"
  node scripts\respaldar-bd.js
  popd
)
echo Copiando fotos de mascotas y promociones...
robocopy "%~dp0backend\uploads" "%~dp0respaldos\fotos" /MIR /NFL /NDL /NJH /NJS /NP >nul
robocopy "%~dp0backend\privado" "%~dp0respaldos\privado" /MIR /NFL /NDL /NJH /NJS /NP >nul

taskkill /im ngrok.exe /f >nul 2>&1
net stop MSSQLSERVER >nul 2>&1
echo.
echo Premier Can detenido (servidor, ngrok y SQL Server). Respaldos en la carpeta "respaldos".
timeout /t 5 >nul
