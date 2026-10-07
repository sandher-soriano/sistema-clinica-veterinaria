@echo off
title Premier Can - Servidor
rem Node.js portable (herramientas\node): no se instala en Windows ni corre en segundo plano.
set "PATH=%~dp0herramientas\node;%PATH%"
cd /d "%~dp0backend"
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)

rem SQL Server esta en modo Manual (no arranca con Windows): se enciende aqui.
sc query MSSQLSERVER | find "RUNNING" >nul || (
  echo Encendiendo SQL Server...
  net start MSSQLSERVER >nul
)

rem Respaldo automatico si el ultimo tiene mas de 12 horas (por si la laptop
rem se apago sin usar detener-premiercan.bat). Las fotos tambien se copian.
node scripts\respaldar-bd.js --si-hace-falta
robocopy "%~dp0backend\uploads" "%~dp0respaldos\fotos" /MIR /NFL /NDL /NJH /NJS /NP >nul
robocopy "%~dp0backend\privado" "%~dp0respaldos\privado" /MIR /NFL /NDL /NJH /NJS /NP >nul

rem Tunel publico con URL fija (ngrok, cuenta gratis). Se abre en otra ventana.
rem El dominio se lee de NGROK_DOMAIN en backend\.env (no se guarda en el codigo).
set "PC_URL="
for /f "usebackq tokens=1,* delims==" %%a in ("%~dp0backend\.env") do if /i "%%a"=="NGROK_DOMAIN" set "PC_URL=%%b"
if not exist "%LOCALAPPDATA%\ngrok\ngrok.yml" (
  echo  [!] ngrok no tiene token configurado: la pagina solo funcionara en local.
  echo      Configuralo con:  herramientas\ngrok.exe config add-authtoken TU_TOKEN
) else if defined PC_URL (
  start "Premier Can - Tunel ngrok" "%~dp0herramientas\ngrok.exe" http --url=%PC_URL% 4000
) else (
  echo  [!] Falta NGROK_DOMAIN en backend\.env: el tunel se abre con una direccion temporal.
  start "Premier Can - Tunel ngrok" "%~dp0herramientas\ngrok.exe" http 4000
)

echo.
echo  Premier Can en linea:
if defined PC_URL (
  echo    Personal:  https://%PC_URL%/
  echo    Clientes:  https://%PC_URL%/cliente/login.html
)
echo    Local:     http://localhost:4000
echo.
echo  No cierres esta ventana ni la del tunel mientras quieras que la pagina funcione.
echo  Para apagar todo (incluido SQL Server) usa detener-premiercan.bat
echo.
node server.js
pause
