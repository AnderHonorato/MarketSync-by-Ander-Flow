@echo off
rem ============================================================
rem iniciar.bat - sobe tudo que o MarketSync atualizado precisa:
rem   0. instala dependencias na primeira vez
rem   1. prepara o .env e MIGRA o banco (cria a tabela de usuarios)
rem   2. sobe a API do projeto (porta 3100)
rem   3. sobe o tunel ngrok pro callback do Mercado Livre
rem   4. sobe o servidor da interface (porta 5190) e abre o navegador
rem ============================================================
setlocal enabledelayedexpansion
title MarketSync - Atualizacao 1

set "PASTA=%~dp0"
set "RAIZ_PROJETO=%PASTA%..\.."
set "PORTA=5190"

where node >nul 2>nul
if errorlevel 1 (
  echo [erro] Node.js nao encontrado. Instale em https://nodejs.org e tente de novo.
  pause
  exit /b 1
)

rem --- Primeira execucao: instala as dependencias ---
if not exist "%RAIZ_PROJETO%\node_modules" (
  echo [info] Primeira execucao: instalando dependencias. Isso pode levar alguns minutos...
  pushd "%RAIZ_PROJETO%"
  call npm install
  popd
)

rem --- Prepara .env e MIGRA o banco (idempotente: so aplica o que falta) ---
rem   Isso garante que a tabela de usuarios (login/hierarquia) exista mesmo
rem   em instalacoes antigas, sem apagar nada do que ja estava la.
echo [info] Preparando ambiente e banco de dados...
pushd "%RAIZ_PROJETO%"
call node scripts\setup-local.mjs --quiet
rem Garante o Prisma Client gerado (necessario pro backend enxergar os usuarios)
call npm run db:generate -w @ml-manager/api >nul 2>nul
popd

rem --- A API ja esta rodando na 3100? Se nao, subo em outra janela ---
netstat -ano | findstr /r /c:":3100 .*LISTENING" >nul 2>nul
if errorlevel 1 (
  echo [info] Subindo a API do projeto na porta 3100...
  rem WEB_ORIGIN aponta pra nova interface, assim o login oficial volta pra ca
  start "MarketSync API (3100)" cmd /k "cd /d "%RAIZ_PROJETO%" && set WEB_ORIGIN=http://localhost:%PORTA%&& set PUBLIC_APP_URL=http://localhost:%PORTA%&& npm run dev -w @ml-manager/api"
  timeout /t 6 /nobreak >nul
) else (
  echo [info] A API ja esta no ar na porta 3100. Vou aproveitar ela.
)

rem --- Sobe o tunel ngrok pra callback HTTPS do Mercado Livre ---
set "NGROK=%RAIZ_PROJETO%\ngrok.exe"
if exist "%NGROK%" (
  rem Extrai o dominio do ML_REDIRECT_URI no .env (ex: https://xxxxx.ngrok-free.dev/api/ml/callback)
  for /f "usebackq tokens=2 delims==" %%d in (`findstr /r "^ML_REDIRECT_URI=" "%RAIZ_PROJETO%\.env"`) do set "REDIRECT_URI=%%d"
  if defined REDIRECT_URI (
    rem Remove "https://" do inicio
    set "DOMINIO=!REDIRECT_URI:https://=!"
    rem Pega so o hostname (antes da primeira /)
    for /f "tokens=1 delims=/" %%h in ('echo !DOMINIO!') do set "NGROK_DOMAIN=%%h"
    echo [info] Subindo tunel ngrok em https://!NGROK_DOMAIN! ...
    taskkill /F /IM ngrok.exe >nul 2>nul
    start "MarketSync Ngrok" /min "%NGROK%" http --url=!NGROK_DOMAIN! 3100
    timeout /t 3 /nobreak >nul
  )
) else (
  echo [aviso] ngrok.exe nao encontrado. O login do Mercado Livre pelo celular pode nao funcionar.
)

rem --- Sobe o servidor da interface e abre o navegador ---
echo.
echo [ok] Tudo pronto! Abrindo http://localhost:%PORTA%
echo      Na primeira vez, crie a conta do Fundador (acesso total).
echo      Deixe esta janela aberta enquanto usa o sistema.
echo.
start "" "http://localhost:%PORTA%"
node "%PASTA%servidor\servidor.js"

endlocal
