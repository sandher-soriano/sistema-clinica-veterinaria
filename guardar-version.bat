@echo off
title Premier Can - Guardar version
cd /d "%~dp0"
set "GIT=%~dp0herramientas\git\cmd\git.exe"

echo ============================================================
echo   GUARDAR UNA VERSION DEL CODIGO (historial con git)
echo ============================================================
echo.
echo Cambios desde la ultima version:
"%GIT%" status --short
"%GIT%" diff --quiet HEAD -- . && "%GIT%" diff --cached --quiet && (
  for /f %%c in ('"%GIT%" status --porcelain ^| find /c /v ""') do if %%c==0 (
    echo   ^(no hay cambios para guardar^)
    pause & exit /b
  )
)
echo.
set /p mensaje=Describe brevemente que cambiaste (Enter para cancelar):
if "%mensaje%"=="" exit /b

"%GIT%" add -A
"%GIT%" commit -q -m "%mensaje%"
echo.
echo Version guardada. Ultimas versiones:
"%GIT%" log --oneline -5
echo.
pause
