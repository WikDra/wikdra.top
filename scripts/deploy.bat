@echo off
setlocal
set REPO_ROOT=%~dp0..
set SITE_DIR=%~dp0..\site

if not exist "%REPO_ROOT%\config.bat" (
    echo @set MIKRUS_PW=YOUR_PASSWORD_HERE> "%REPO_ROOT%\config.bat"
    echo @set MIKRUS_PORT=YOUR_PORT>> "%REPO_ROOT%\config.bat"
    echo @set MIKRUS_USER=YOUR_USER>> "%REPO_ROOT%\config.bat"
    echo @set MIKRUS_HOST=YOUR_HOST>> "%REPO_ROOT%\config.bat"
    echo Please configure your Mikrus settings in config.bat
    exit /b 1
)
call "%REPO_ROOT%\config.bat"

echo [1/4] Preparing upload directory on server...
plink -batch -P %MIKRUS_PORT% -pw %MIKRUS_PW% %MIKRUS_USER%@%MIKRUS_HOST% "mkdir -p /home/%MIKRUS_USER%/site-upload/"

echo [2/4] Uploading files to server via PSCP...
pushd "%SITE_DIR%"
pscp -batch -r -P %MIKRUS_PORT% -pw %MIKRUS_PW% * %MIKRUS_USER%@%MIKRUS_HOST%:/home/%MIKRUS_USER%/site-upload/
set UPLOAD_ERR=%ERRORLEVEL%
if exist "bichu_config.php" (
    pscp -batch -P %MIKRUS_PORT% -pw %MIKRUS_PW% bichu_config.php %MIKRUS_USER%@%MIKRUS_HOST%:/home/%MIKRUS_USER%/site-upload/
)
popd

if %UPLOAD_ERR% neq 0 (
    echo.
    echo [ERROR] Failed to upload files. Check your connection or config.bat.
    exit /b %UPLOAD_ERR%
)

echo [3/4] Moving files to Nginx HTML directory...
plink -batch -P %MIKRUS_PORT% -pw %MIKRUS_PW% %MIKRUS_USER%@%MIKRUS_HOST% "echo %MIKRUS_PW% | sudo -S rm -f /var/lib/nginx/html/themes-v5.css /var/lib/nginx/html/sw-v5.js && echo %MIKRUS_PW% | sudo -S cp -r /home/%MIKRUS_USER%/site-upload/* /var/lib/nginx/html/ && echo %MIKRUS_PW% | sudo -S rm -rf /home/%MIKRUS_USER%/site-upload"

echo [4/4] Restarting Nginx server...
plink -batch -P %MIKRUS_PORT% -pw %MIKRUS_PW% %MIKRUS_USER%@%MIKRUS_HOST% "echo %MIKRUS_PW% | sudo -S rc-service nginx restart"

echo.
echo [SUCCESS] Site deployed successfully!
endlocal
