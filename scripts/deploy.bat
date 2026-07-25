@echo off
setlocal
set REPO_ROOT=%~dp0..
set SITE_DIR=%~dp0..\site

if not exist "%REPO_ROOT%\config.bat" (
    echo @set MIKRUS_PW=YOUR_PASSWORD_HERE> "%REPO_ROOT%\config.bat"
    echo @set MIKRUS_PORT=11098>> "%REPO_ROOT%\config.bat"
    echo @set MIKRUS_USER=frog>> "%REPO_ROOT%\config.bat"
    echo @set MIKRUS_HOST=frog02.mikr.us>> "%REPO_ROOT%\config.bat"
    echo Please configure your Mikrus settings in config.bat
    exit /b 1
)
call "%REPO_ROOT%\config.bat"

set EXTRA_FILES=
if exist "%SITE_DIR%\bichu_config.php" set EXTRA_FILES=bichu_config.php

echo [1/3] Uploading files to server via PSCP...
pushd "%SITE_DIR%"
pscp -batch -P %MIKRUS_PORT% -pw %MIKRUS_PW% index.html panels.html history.html 404.html themes-v5.css sw-v5.js manifest.json robots.txt sitemap.xml bichu.php stats.php %EXTRA_FILES% %MIKRUS_USER%@%MIKRUS_HOST%:/home/%MIKRUS_USER%/
set UPLOAD_ERR=%ERRORLEVEL%
popd

if %UPLOAD_ERR% neq 0 (
    echo.
    echo [ERROR] Failed to upload files. Check your connection or config.bat.
    exit /b %UPLOAD_ERR%
)

echo [2/3] Moving files to Nginx HTML directory...
plink -batch -P %MIKRUS_PORT% -pw %MIKRUS_PW% %MIKRUS_USER%@%MIKRUS_HOST% "echo %MIKRUS_PW% | sudo -S mv /home/%MIKRUS_USER%/index.html /home/%MIKRUS_USER%/panels.html /home/%MIKRUS_USER%/history.html /home/%MIKRUS_USER%/404.html /home/%MIKRUS_USER%/themes-v5.css /home/%MIKRUS_USER%/sw-v5.js /home/%MIKRUS_USER%/manifest.json /home/%MIKRUS_USER%/robots.txt /home/%MIKRUS_USER%/sitemap.xml /home/%MIKRUS_USER%/bichu.php /home/%MIKRUS_USER%/stats.php /var/lib/nginx/html/ && ( [ -f /home/%MIKRUS_USER%/bichu_config.php ] && echo %MIKRUS_PW% | sudo -S mv /home/%MIKRUS_USER%/bichu_config.php /var/lib/nginx/html/ || true )"

echo [3/3] Restarting Nginx server...
plink -batch -P %MIKRUS_PORT% -pw %MIKRUS_PW% %MIKRUS_USER%@%MIKRUS_HOST% "echo %MIKRUS_PW% | sudo -S rc-service nginx restart"

echo.
echo [SUCCESS] Site deployed successfully!
endlocal
