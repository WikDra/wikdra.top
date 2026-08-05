@echo off
setlocal EnableExtensions
rem ===========================================================================
rem  deploy.bat — wdrożenie wikdra.top na Mikrus FROG (Alpine + Nginx)
rem
rem  Poprawki względem poprzedniej wersji:
rem   * KAŻDY krok sprawdza kod wyjścia — skrypt nie kończy się już "SUCCESS",
rem     kiedy upload albo przeniesienie plików padło,
rem   * wysyłana jest JAWNA lista plików, a nie "*" — lokalna kopia
rem     bichu_content.txt / bichu_attempts.json nie nadpisze danych na serwerze,
rem   * CSS jest budowany przed wysyłką (koniec z rozjechanym artefaktem),
rem   * usuwane są pliki po starych wersjach (sw-v5/sw-v6, manifest.json, themes-v5),
rem   * konfiguracja Nginx tylko na jawne żądanie: deploy.bat --with-nginx,
rem     i zawsze przez `nginx -t` + `reload` (nie `restart`),
rem   * na końcu smoke test HTTP; brak 200 = błąd wdrożenia.
rem
rem  ZNANE OGRANICZENIE: hasło trafia do argumentów procesu (plink -pw, sudo -S).
rem  Docelowo klucz SSH + sudoers NOPASSWD — patrz docs/deployment.md.
rem ===========================================================================

set "REPO_ROOT=%~dp0.."
set "SITE_DIR=%REPO_ROOT%\site"
set "WITH_NGINX=0"
if /I "%~1"=="--with-nginx" set "WITH_NGINX=1"

if not exist "%REPO_ROOT%\config.bat" (
    echo @set MIKRUS_PW=YOUR_PASSWORD_HERE> "%REPO_ROOT%\config.bat"
    echo @set MIKRUS_PORT=11098>> "%REPO_ROOT%\config.bat"
    echo @set MIKRUS_USER=frog>> "%REPO_ROOT%\config.bat"
    echo @set MIKRUS_HOST=frog02.mikr.us>> "%REPO_ROOT%\config.bat"
    echo [ERROR] Brak config.bat — utworzono szkielet. Uzupelnij dane i uruchom ponownie.
    exit /b 1
)
call "%REPO_ROOT%\config.bat"

if "%MIKRUS_HOST%"=="" ( echo [ERROR] config.bat nie ustawia MIKRUS_HOST. & exit /b 1 )
if "%MIKRUS_PW%"=="" ( echo [ERROR] config.bat nie ustawia MIKRUS_PW. & exit /b 1 )

set "SSH=plink -batch -P %MIKRUS_PORT% -pw %MIKRUS_PW% %MIKRUS_USER%@%MIKRUS_HOST%"
set "SCP=pscp -batch -P %MIKRUS_PORT% -pw %MIKRUS_PW%"
set "STAGE=/home/%MIKRUS_USER%/site-upload"
set "WWW=/var/lib/nginx/html"

echo [1/6] Budowanie CSS (artefakt musi zgadzac sie ze zrodlem)...
pushd "%REPO_ROOT%"
call npm run build:css
if errorlevel 1 (
    popd
    echo [ERROR] Build CSS nie powiodl sie. Uruchom `npm ci` i sprawdz src/app.css.
    exit /b 1
)
popd

echo [2/6] Przygotowanie katalogu tymczasowego na serwerze...
%SSH% "rm -rf %STAGE% && mkdir -p %STAGE%/assets"
if errorlevel 1 goto :fail_conn

echo [3/6] Wysylanie plikow...
pushd "%SITE_DIR%"
%SCP% index.html panels.html history.html 404.html offline.html bichu.php stats.php sw-v7.js manifest-solar.json robots.txt sitemap.xml %MIKRUS_USER%@%MIKRUS_HOST%:%STAGE%/
if errorlevel 1 ( popd & goto :fail_upload )
%SCP% -r assets %MIKRUS_USER%@%MIKRUS_HOST%:%STAGE%/
if errorlevel 1 ( popd & goto :fail_upload )
if exist "bichu_config.php" (
    %SCP% bichu_config.php %MIKRUS_USER%@%MIKRUS_HOST%:%STAGE%/
    if errorlevel 1 ( popd & goto :fail_upload )
) else (
    echo [WARN] Brak site\bichu_config.php — edycja Bichu na serwerze pozostanie WYLACZONA (503^).
)
popd

echo [4/6] Instalacja plikow w katalogu WWW...
%SSH% "echo %MIKRUS_PW% | sudo -S sh -c 'cp -r %STAGE%/. %WWW%/ && rm -f %WWW%/sw-v5.js %WWW%/sw-v6.js %WWW%/themes-v5.css %WWW%/manifest.json && chmod 644 %WWW%/*.html %WWW%/*.php %WWW%/*.js %WWW%/*.json %WWW%/*.txt %WWW%/*.xml' && rm -rf %STAGE%"
if errorlevel 1 goto :fail_install

if "%WITH_NGINX%"=="1" (
    echo [5/6] Aktualizacja konfiguracji Nginx...
    %SCP% "%REPO_ROOT%\nginx\default.conf" %MIKRUS_USER%@%MIKRUS_HOST%:/home/%MIKRUS_USER%/default.conf
    if errorlevel 1 goto :fail_upload
    rem test.conf serwowal ten sam katalog BEZ obsługi PHP i bez blokad (wyciek zrodel
    rem i bichu_config.php). Host test.wikdra.top jest teraz w default.conf, wiec plik
    rem wylaczamy przez zmiane nazwy (odwracalne: mv test.conf.disabled test.conf).
    %SSH% "echo %MIKRUS_PW% | sudo -S sh -c 'cp /etc/nginx/http.d/default.conf /etc/nginx/http.d/default.conf.bak 2>/dev/null; if [ -f /etc/nginx/http.d/test.conf ]; then mv /etc/nginx/http.d/test.conf /etc/nginx/http.d/test.conf.disabled; fi; cp /home/%MIKRUS_USER%/default.conf /etc/nginx/http.d/default.conf && nginx -t'"
    if errorlevel 1 (
        echo [ERROR] `nginx -t` nie przeszlo — przywracam kopie zapasowa.
        %SSH% "echo %MIKRUS_PW% | sudo -S sh -c 'cp /etc/nginx/http.d/default.conf.bak /etc/nginx/http.d/default.conf; if [ -f /etc/nginx/http.d/test.conf.disabled ]; then mv /etc/nginx/http.d/test.conf.disabled /etc/nginx/http.d/test.conf; fi; nginx -t'"
        exit /b 1
    )
    %SSH% "echo %MIKRUS_PW% | sudo -S rc-service nginx reload"
    if errorlevel 1 goto :fail_nginx
) else (
    echo [5/6] Konfiguracja Nginx pominieta ^(uruchom z --with-nginx, jesli sie zmienila^).
)

echo [6/6] Smoke test...
%SSH% "curl -fsS -o /dev/null -H 'Host: wikdra.top' http://127.0.0.1/ && curl -fsS -o /dev/null -H 'Host: panele.wikdra.top' http://127.0.0.1/panels.html && curl -fsS -o /dev/null http://127.0.0.1/assets/icons/favicon.png && curl -fsS -o /dev/null http://127.0.0.1/stats.php && for h in wikdra.top panele.wikdra.top test.wikdra.top; do test \"$(curl -s -o /dev/null -w '%%{http_code}' -H \"Host: $h\" http://127.0.0.1/bichu_config.php)\" = 404 || exit 1; done"
if errorlevel 1 (
    echo [ERROR] Smoke test nie przeszedl. Strona moze byc w stanie niespojnym.
    echo         Rollback: git checkout ^<poprzedni_hash^> ^&^& scripts\deploy.bat
    exit /b 1
)

echo.
echo [SUCCESS] Wdrozenie zakonczone i sprawdzone.
echo           CSS/JS/ikony maja `no-cache`, wiec CDN nie powinien podawac starych wersji.
echo           Fonty sa cache'owane na rok — po ich podmianie zrob purge Cloudflare.
endlocal
exit /b 0

:fail_conn
echo [ERROR] Nie udalo sie polaczyc z serwerem ^(plink^). Sprawdz config.bat i siec.
exit /b 1
:fail_upload
echo [ERROR] Wysylka plikow nie powiodla sie — NIC nie zostalo podmienione na serwerze.
exit /b 1
:fail_install
echo [ERROR] Instalacja plikow w %WWW% nie powiodla sie. Sprawdz uprawnienia sudo.
exit /b 1
:fail_nginx
echo [ERROR] Reload Nginx nie powiodl sie. Konfiguracja przeszla test, ale usluga nie wstala.
exit /b 1
