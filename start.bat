@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Metrys Hub - API + Web + Ngrok
cd /d "%~dp0"

REM ============================================================
REM CONFIGURACOES
REM ============================================================
set "API_PORT=3100"
set "WEB_PORT=5180"
set "WEB_URL=http://localhost:%WEB_PORT%"
set "LOG_DIR=%~dp0logs"
set "START_ERROR=0"

REM Forca ferramentas compativeis a aceitarem conexoes da rede local.
set "HOST=0.0.0.0"
set "VITE_HOST=0.0.0.0"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1

echo.
echo  ==================================================
echo   METRYS HUB - INICIANDO SERVIDORES
echo   Ander Flow by Anderson Honorato
echo   https://anderhonorato.github.io/links/index.html
echo  ==================================================
echo.

REM ============================================================
REM VERIFICAR ADMINISTRADOR
REM ============================================================
net session >nul 2>&1
if errorlevel 1 (
    set "HAS_ADMIN=0"
) else (
    set "HAS_ADMIN=1"
)

REM ============================================================
REM VERIFICAR DEPENDENCIAS
REM ============================================================
echo  ==================================================
echo   VERIFICANDO DEPENDENCIAS
echo  ==================================================
echo.

call :check_node
if errorlevel 1 goto :fatal_error

call :check_npm
if errorlevel 1 goto :fatal_error

call :check_ngrok

call :check_dependencies
if errorlevel 1 goto :fatal_error

echo.
echo  [OK] Dependencias verificadas.
echo.

REM ============================================================
REM CONFIGURAR FIREWALL
REM ============================================================
echo  ==================================================
echo   CONFIGURANDO ACESSO NA REDE LOCAL
echo  ==================================================
echo.

if "%HAS_ADMIN%"=="1" (
    call :configure_firewall
) else (
    echo  [AVISO] O script nao esta como administrador.
    echo  [AVISO] Tentarei criar as regras do firewall automaticamente.
    echo.

    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "Start-Process netsh -Verb RunAs -Wait -ArgumentList 'advfirewall firewall add rule name=\"Metrys Hub API %API_PORT%\" dir=in action=allow protocol=TCP localport=%API_PORT% profile=private'"

    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "Start-Process netsh -Verb RunAs -Wait -ArgumentList 'advfirewall firewall add rule name=\"Metrys Hub Web %WEB_PORT%\" dir=in action=allow protocol=TCP localport=%WEB_PORT% profile=private'"
)

REM ============================================================
REM ENCERRAR SOMENTE PROCESSOS DAS PORTAS DO PROJETO
REM ============================================================
echo.
echo  ==================================================
echo   LIBERANDO PORTAS DO METRYS HUB
echo  ==================================================
echo.

call :kill_port %API_PORT%
call :kill_port %WEB_PORT%

REM O ngrok pode permanecer aberto de uma execucao anterior.
REM Encerra somente o ngrok, sem matar todos os processos Node.
tasklist /FI "IMAGENAME eq ngrok.exe" 2>nul | find /I "ngrok.exe" >nul
if not errorlevel 1 (
    echo  [INFO] Encerrando ngrok anterior...
    taskkill /F /IM ngrok.exe >nul 2>&1
)

call :wait_port_free %API_PORT% 10
if errorlevel 1 (
    echo  [ERRO] A porta %API_PORT% continua ocupada.
    call :show_port_process %API_PORT%
    goto :fatal_error
)

call :wait_port_free %WEB_PORT% 10
if errorlevel 1 (
    echo  [ERRO] A porta %WEB_PORT% continua ocupada.
    call :show_port_process %WEB_PORT%
    goto :fatal_error
)

echo  [OK] Portas %API_PORT% e %WEB_PORT% liberadas.

REM ============================================================
REM DETECTAR IP LOCAL
REM ============================================================
call :detect_local_ip

echo.
echo  ==================================================
echo   ENDERECOS DE ACESSO
echo  ==================================================
echo.
echo   Computador:
echo   %WEB_URL%
echo.

if defined LOCAL_IP (
    echo   Celular no mesmo Wi-Fi:
    echo   http://!LOCAL_IP!:%WEB_PORT%
    echo.
    echo   API pela rede local:
    echo   http://!LOCAL_IP!:%API_PORT%
) else (
    echo   [AVISO] Nao foi possivel detectar o IPv4 automaticamente.
    echo   Execute "ipconfig" e procure o Endereco IPv4 do Wi-Fi.
)

echo.
echo  Para funcionar no celular:
echo   1. PC e celular devem estar no mesmo Wi-Fi.
echo   2. A rede do Windows deve estar definida como Privada.
echo   3. O servidor Web deve escutar em 0.0.0.0.
echo   4. A API tambem deve escutar em 0.0.0.0.
echo.

REM ============================================================
REM ABRIR NAVEGADOR QUANDO O SITE RESPONDER
REM ============================================================
start "Metrys Browser Watcher" /min powershell -NoProfile -WindowStyle Hidden -Command ^
    "$url='%WEB_URL%'; $tentativas=0; while($tentativas -lt 60) { try { $r=Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing; if($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { Start-Process $url; exit 0 } } catch {}; Start-Sleep -Seconds 1; $tentativas++ }"

REM ============================================================
REM INICIAR SERVIDORES
REM ============================================================
echo  ==================================================
echo   INICIANDO SERVIDORES
echo  ==================================================
echo.
echo   Para encerrar, pressione Ctrl+C.
echo.
echo   O terminal permanecera aberto caso ocorra algum erro.
echo  ==================================================
echo.

REM O CALL impede que o npm substitua/encerre o processo do .bat.
call npm run dev:https

set "NPM_EXIT_CODE=%ERRORLEVEL%"

echo.
echo  ==================================================

if "%NPM_EXIT_CODE%"=="0" (
    echo   SERVIDORES ENCERRADOS NORMALMENTE.
) else (
    echo   [ERRO] O comando npm run dev:https foi encerrado.
    echo   Codigo de erro: %NPM_EXIT_CODE%
    echo.
    echo   Verifique se o script "dev:https" existe no package.json.
    echo   Execute manualmente para ver o erro:
    echo.
    echo       npm run dev:https
)

echo  ==================================================
echo.
pause
exit /b %NPM_EXIT_CODE%

REM ============================================================
REM SUBROTINA: VERIFICAR NODE
REM ============================================================
:check_node
echo  [ ] Node.js...

where node >nul 2>&1
if errorlevel 1 (
    echo  [X] Node.js nao encontrado.
    echo.

    where winget >nul 2>&1
    if errorlevel 1 (
        echo  Instale manualmente pelo site oficial do Node.js.
        exit /b 1
    )

    set /p "INSTALL_NODE=  Deseja instalar o Node.js LTS agora? (S/N): "

    if /I "!INSTALL_NODE!"=="S" (
        winget install --id OpenJS.NodeJS.LTS -e ^
            --accept-source-agreements ^
            --accept-package-agreements

        if errorlevel 1 (
            echo  [X] Falha ao instalar o Node.js.
            exit /b 1
        )

        echo.
        echo  [OK] Node.js instalado.
        echo  Feche esta janela e execute o arquivo novamente.
        pause
        exit /b 1
    )

    exit /b 1
)

for /f "tokens=*" %%V in ('node -v') do set "NODE_VERSION=%%V"
set "NODE_MAJOR=!NODE_VERSION:v=!"
for /f "tokens=1 delims=." %%M in ("!NODE_MAJOR!") do set "NODE_MAJOR=%%M"

if !NODE_MAJOR! LSS 20 (
    echo  [X] Node.js !NODE_VERSION! detectado.
    echo  [X] Este projeto necessita do Node.js 20 ou superior.
    exit /b 1
)

echo  [OK] Node.js !NODE_VERSION!
exit /b 0

REM ============================================================
REM SUBROTINA: VERIFICAR NPM
REM ============================================================
:check_npm
echo  [ ] npm...

where npm >nul 2>&1
if errorlevel 1 (
    echo  [X] npm nao encontrado.
    exit /b 1
)

for /f "tokens=*" %%V in ('call npm -v') do set "NPM_VERSION=%%V"
echo  [OK] npm v!NPM_VERSION!
exit /b 0

REM ============================================================
REM SUBROTINA: VERIFICAR NGROK
REM ============================================================
:check_ngrok
echo  [ ] ngrok...

set "NGROK_CMD="

where ngrok >nul 2>&1
if not errorlevel 1 set "NGROK_CMD=ngrok"

if not defined NGROK_CMD if exist "%~dp0ngrok.exe" (
    set "NGROK_CMD=%~dp0ngrok.exe"
)

if not defined NGROK_CMD if exist "%~dp0..\ngrok.exe" (
    set "NGROK_CMD=%~dp0..\ngrok.exe"
)

if defined NGROK_CMD (
    for /f "tokens=*" %%V in ('"!NGROK_CMD!" version 2^>^&1') do (
        echo  [OK] %%V
        goto :ngrok_checked
    )
)

echo  [AVISO] ngrok nao encontrado.
echo  [AVISO] O acesso pelo Wi-Fi funciona sem ngrok.
echo  [AVISO] Somente o tunel publico HTTPS ficara indisponivel.
echo.

where winget >nul 2>&1
if errorlevel 1 goto :ngrok_checked

set /p "INSTALL_NGROK=  Deseja instalar o ngrok agora? (S/N): "

if /I "!INSTALL_NGROK!"=="S" (
    winget install --id Ngrok.Ngrok -e ^
        --accept-source-agreements ^
        --accept-package-agreements

    if errorlevel 1 (
        echo  [AVISO] Nao foi possivel instalar o ngrok.
    ) else (
        echo  [OK] ngrok instalado.
    )
)

:ngrok_checked
exit /b 0

REM ============================================================
REM SUBROTINA: VERIFICAR NODE_MODULES
REM ============================================================
:check_dependencies
echo  [ ] Dependencias do projeto...

if not exist "package.json" (
    echo  [X] package.json nao encontrado em:
    echo      %CD%
    exit /b 1
)

if exist "node_modules\" (
    echo  [OK] node_modules encontrado.
    exit /b 0
)

echo  [AVISO] node_modules nao encontrado.
set /p "INSTALL_DEPS=  Deseja executar npm install? (S/N): "

if /I not "!INSTALL_DEPS!"=="S" (
    echo  [X] As dependencias sao obrigatorias.
    exit /b 1
)

echo.
echo  Instalando dependencias...
call npm install

if errorlevel 1 (
    echo.
    echo  [X] Falha no npm install.
    exit /b 1
)

echo  [OK] Dependencias instaladas.
exit /b 0

REM ============================================================
REM SUBROTINA: CONFIGURAR FIREWALL
REM ============================================================
:configure_firewall
echo  [ ] Verificando firewall...

netsh advfirewall firewall show rule ^
    name="Metrys Hub API %API_PORT%" >nul 2>&1

if errorlevel 1 (
    netsh advfirewall firewall add rule ^
        name="Metrys Hub API %API_PORT%" ^
        dir=in ^
        action=allow ^
        protocol=TCP ^
        localport=%API_PORT% ^
        profile=private >nul 2>&1
)

netsh advfirewall firewall show rule ^
    name="Metrys Hub Web %WEB_PORT%" >nul 2>&1

if errorlevel 1 (
    netsh advfirewall firewall add rule ^
        name="Metrys Hub Web %WEB_PORT%" ^
        dir=in ^
        action=allow ^
        protocol=TCP ^
        localport=%WEB_PORT% ^
        profile=private >nul 2>&1
)

echo  [OK] Firewall configurado para rede privada.
exit /b 0

REM ============================================================
REM SUBROTINA: MATAR APENAS PROCESSO ESCUTANDO EM UMA PORTA
REM ============================================================
:kill_port
set "TARGET_PORT=%~1"
set "FOUND_PROCESS=0"

for /f "tokens=5" %%P in ('
    netstat -ano -p TCP 2^>nul ^
    ^| findstr /R /C:":%TARGET_PORT% .*LISTENING"
') do (
    set "TARGET_PID=%%P"

    if not "!TARGET_PID!"=="0" (
        echo  [INFO] Porta %TARGET_PORT% usada pelo PID !TARGET_PID!.

        for /f "tokens=1,*" %%A in ('
            tasklist /FI "PID eq !TARGET_PID!" /FO LIST 2^>nul ^
            ^| findstr /B /C:"Image Name:"
        ') do (
            echo  [INFO] Processo: %%B
        )

        taskkill /F /T /PID !TARGET_PID! >nul 2>&1

        if errorlevel 1 (
            echo  [AVISO] Nao foi possivel encerrar o PID !TARGET_PID!.
        ) else (
            echo  [OK] PID !TARGET_PID! encerrado.
            set "FOUND_PROCESS=1"
        )
    )
)

if "!FOUND_PROCESS!"=="0" (
    echo  [OK] Porta %TARGET_PORT% ja estava livre.
)

exit /b 0

REM ============================================================
REM SUBROTINA: AGUARDAR PORTA FICAR LIVRE
REM ============================================================
:wait_port_free
set "WAIT_PORT=%~1"
set /a "WAIT_SECONDS=%~2"
set /a "CURRENT_WAIT=0"

:wait_port_loop
netstat -ano -p TCP 2>nul ^
    | findstr /R /C:":%WAIT_PORT% .*LISTENING" >nul

if errorlevel 1 exit /b 0

if !CURRENT_WAIT! GEQ !WAIT_SECONDS! exit /b 1

timeout /t 1 /nobreak >nul
set /a "CURRENT_WAIT+=1"
goto :wait_port_loop

REM ============================================================
REM SUBROTINA: MOSTRAR PROCESSO DA PORTA
REM ============================================================
:show_port_process
set "CHECK_PORT=%~1"

for /f "tokens=5" %%P in ('
    netstat -ano -p TCP 2^>nul ^
    ^| findstr /R /C:":%CHECK_PORT% .*LISTENING"
') do (
    echo  PID encontrado: %%P
    tasklist /FI "PID eq %%P"
)

exit /b 0

REM ============================================================
REM SUBROTINA: DETECTAR IPV4 DA REDE LOCAL
REM ============================================================
:detect_local_ip
set "LOCAL_IP="

for /f "usebackq tokens=*" %%I in (`
    powershell -NoProfile -Command ^
    "$ip = Get-NetIPConfiguration ^| Where-Object { $_.NetAdapter.Status -eq 'Up' -and $_.IPv4DefaultGateway -ne $null -and $_.IPv4Address.IPAddress -notlike '169.254.*' } ^| ForEach-Object { $_.IPv4Address.IPAddress } ^| Select-Object -First 1; if($ip){$ip}"
`) do (
    set "LOCAL_IP=%%I"
)

if defined LOCAL_IP exit /b 0

REM Fallback para computadores onde Get-NetIPConfiguration falhar.
for /f "tokens=2 delims=:" %%I in ('
    ipconfig 2^>nul ^
    ^| findstr /I /C:"IPv4 Address" /C:"Endereco IPv4"
') do (
    if not defined LOCAL_IP (
        set "IP_VALUE=%%I"
        set "IP_VALUE=!IP_VALUE: =!"
        set "IP_VALUE=!IP_VALUE:(Preferred)=!"
        set "IP_VALUE=!IP_VALUE:(Preferencial)=!"

        echo !IP_VALUE! | findstr /B /C:"127." /C:"169.254." >nul
        if errorlevel 1 set "LOCAL_IP=!IP_VALUE!"
    )
)

exit /b 0

REM ============================================================
REM ERRO FATAL
REM ============================================================
:fatal_error
echo.
echo  ==================================================
echo   [ERRO] NAO FOI POSSIVEL INICIAR O METRYS HUB
echo  ==================================================
echo.
echo  A janela permanecera aberta para voce ler o erro.
echo.
pause
exit /b 1