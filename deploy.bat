@echo off
setlocal
if not exist config.bat (
    echo @set MIKRUS_PW=YOUR_PASSWORD_HERE> config.bat
    echo @set MIKRUS_PORT=YOUR_PORT>> config.bat
    echo @set MIKRUS_USER=YOUR_USER>> config.bat
    echo @set MIKRUS_HOST=YOUR_HOST>> config.bat
    echo Please configure your Mikrus settings in config.bat
    exit /b 1
)
call config.bat

type clean.b64 | plink -batch -P %MIKRUS_PORT% -pw %MIKRUS_PW% %MIKRUS_USER%@%MIKRUS_HOST% "base64 -d > index.html"
plink -batch -P %MIKRUS_PORT% -pw %MIKRUS_PW% %MIKRUS_USER%@%MIKRUS_HOST% "echo %MIKRUS_PW% | sudo -S mv index.html /var/lib/nginx/html/index.html"
plink -batch -P %MIKRUS_PORT% -pw %MIKRUS_PW% %MIKRUS_USER%@%MIKRUS_HOST% "echo %MIKRUS_PW% | sudo -S rc-service nginx restart"
endlocal
