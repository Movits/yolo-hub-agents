@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao foi encontrado no PATH.
  echo Instale o Node.js 22 ou mais recente e tente novamente.
  pause
  exit /b 1
)

if not exist ".env" (
  copy /Y ".env.example" ".env" >nul
  echo Arquivo .env criado para o modo local.
)

if not exist "node_modules\fastify\package.json" (
  echo Instalando dependencias pela primeira vez...
  where pnpm.cmd >nul 2>nul
  if not errorlevel 1 (
    call pnpm.cmd install
  ) else (
    call npm.cmd install --no-package-lock
  )
  if errorlevel 1 (
    echo [ERRO] Nao foi possivel instalar as dependencias.
    pause
    exit /b 1
  )
)

echo Preparando a interface...
call ".\node_modules\.bin\tsc.cmd" -p tsconfig.build.json
if errorlevel 1 (
  echo [ERRO] O projeto nao compilou.
  pause
  exit /b 1
)

echo.
echo Lia esta disponivel em http://127.0.0.1:3000
echo Mantenha esta janela aberta durante o teste.
echo Use Ctrl+C para encerrar o servidor.
echo.

start "" "http://127.0.0.1:3000"
node dist\index.js

