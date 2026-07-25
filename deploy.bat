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

set EXTRA_FILES=
if exist bichu_config.php set EXTRA_FILES=bichu_config.php

echo [1/3] Uploading files to server via PSCP...
pscp -batch -P %MIKRUS_PORT% -pw %MIKRUS_PW% index.html panels.html 404.html themes-v5.css bichu.php %EXTRA_FILES% %MIKRUS_USER%@%MIKRUS_HOST%:/home/%MIKRUS_USER%/

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Failed to upload files. Check your connection or config.bat.
    exit /b %ERRORLEVEL%
)

echo [2/3] Moving files to Nginx HTML directory...
plink -batch -P %MIKRUS_PORT% -pw %MIKRUS_PW% %MIKRUS_USER%@%MIKRUS_HOST% "echo %MIKRUS_PW% | sudo -S mv /home/%MIKRUS_USER%/index.html /home/%MIKRUS_USER%/panels.html /home/%MIKRUS_USER%/404.html /home/%MIKRUS_USER%/themes-v5.css /home/%MIKRUS_USER%/bichu.php /var/lib/nginx/html/ && ( [ -f /home/%MIKRUS_USER%/bichu_config.php ] && echo %MIKRUS_PW% | sudo -S mv /home/%MIKRUS_USER%/bichu_config.php /var/lib/nginx/html/ || true )"

echo [3/3] Restarting Nginx server...
plink -batch -P %MIKRUS_PORT% -pw %MIKRUS_PW% %MIKRUS_USER%@%MIKRUS_HOST% "echo %MIKRUS_PW% | sudo -S rc-service nginx restart"

echo.
echo [SUCCESS] Site deployed successfully!
endlocal
