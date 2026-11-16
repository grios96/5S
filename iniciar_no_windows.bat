@echo off
cd /d "%~dp0"
where py >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
 echo Python nao encontrado. Instale Python 3.10+ ou use a publicacao no Render.
 pause
 exit /b 1
)
echo Preparando o 5S SPEEDRUN...
py -m pip install -r requirements.txt
if %ERRORLEVEL% NEQ 0 (
 echo Nao foi possivel instalar as dependencias. Verifique a internet.
 pause
 exit /b 1
)
echo.
echo JOGO ATIVO na porta 8000.
echo No PowerShell, use ipconfig para descobrir o IP do computador.
echo Abra http://SEU-IP:8000 no notebook para gerar um QR para os celulares.
echo Mantenha esta janela aberta durante a dinamica.
py -m uvicorn server:app --host 0.0.0.0 --port 8000
pause
