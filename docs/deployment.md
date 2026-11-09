# Deployment na Mikrus

Serwer: Alpine Linux + Nginx na VPS Mikrus. Katalog WWW: `/var/lib/nginx/html/`.
Strona to pliki statyczne z `site/` (wgrywa `scripts\deploy.bat`). Dwie dynamiczne trasy,
`/stats.php` (metryki serwera) i `/bichu` (edytor treści), obsługuje usługa Go `wikdra`
z katalogu `server/` (wgrywa `scripts/deploy-api.ps1`, opis niżej w „Usługa Go”). PHP strona
już nie używa.

## Konfiguracja lokalna (raz)

1. W katalogu głównym repo utwórz `config.bat` (jest w `.gitignore`):
   ```cmd
   @set MIKRUS_PW=haslo_ssh
   @set MIKRUS_PORT=YOUR_PORT
   @set MIKRUS_USER=YOUR_USER
   @set MIKRUS_HOST=YOUR_HOST
   ```
   Realne wartości hosta/portu/loginu **nie trafiają do repo** — trzymaj je
   wyłącznie w `config.bat` oraz w lokalnych, ignorowanych przez Gita plikach
   (`*.local.*`, np. `AGENTS.local.md`).

2. Wymagane narzędzia: `pscp` i `plink` (PuTTY) w PATH, Node ≥ 20 (`npm ci`),
   PowerShell 7 (`pwsh`), do wdrożeń usługi Go także `gh` (GitHub CLI, zalogowany),
   a do lokalnego buildu Go 1.27.

## Wdrożenie

```cmd
npm run check
scripts\deploy.bat
```

`deploy.bat` po kolei:
1. buduje CSS (`npm run build:css`) — bez tego artefakt mógłby się rozjechać ze źródłem,
2. wysyła **jawną listę** plików z `site/` do katalogu tymczasowego na serwerze
   (celowo NIE `*`: lokalne pliki robocze nie trafią na serwer),
3. kopiuje je do `/var/lib/nginx/html/` i usuwa pliki po starych wersjach
   (`sw-v5.js`, `sw-v6.js`, `themes-v5.css`, `manifest.json`, dawne `bichu.php`,
   `stats.php`, `bichu_config.php`),
4. opcjonalnie (`deploy.bat --with-nginx`) aktualizuje konfigurację Nginx:
   kopia zapasowa → `nginx -t` → `reload`; przy błędzie testu wraca do kopii,
5. wykonuje smoke test: strona główna, panele, favicon, `stats.php`
   oraz kontrola, że `GET /bichu_config.php` zwraca `404`.

Każdy krok kontroluje kod wyjścia — komunikat `[SUCCESS]` pojawia się tylko
wtedy, gdy wszystko przeszło. `deploy.bat` nie dotyka usługi Go.

## Usługa Go (`server/`): `/stats.php` i `/bichu`

Jedna binarka bez zależności (`server/`, Go 1.27, jedyny moduł spoza biblioteki
standardowej to `golang.org/x/crypto/bcrypt`). Na serwerze:

| Co | Gdzie |
|---|---|
| usługa OpenRC (supervise-daemon, restart po awarii) | `/etc/init.d/wikdra`, ustawienia `/etc/conf.d/wikdra` |
| adres (tylko lokalnie, przed nią nginx) | `127.0.0.1:8092` |
| użytkownik (bez hasła i powłoki) | `wikdra` |
| wydania, bieżące | `/srv/wikdra/releases/<wersja>/wikdra`, `/srv/wikdra/current` |
| dane: treść Bichu, hash hasła (bcrypt) | `/var/lib/wikdra/bichu.txt`, `/var/lib/wikdra/bichu.hash` |
| logi usługi i wdrożeń | `/var/log/wikdra/wikdra.log`, `/var/log/wikdra/deploy.log` |
| skrypt wdrożeń (root) | `/usr/local/sbin/wikdra-deploy` |

Stan od 2026-11-09: usługa działa, nginx kieruje do niej `/stats.php` i `/bichu`, pliki PHP
strony są usunięte z `/var/lib/nginx/html` (kopia w `/root/wikdra-php-20261109.tgz`), a pula
php-fpm `www` (nobody, 127.0.0.1:9000), której używała tylko strona, jest wyłączona
(`/etc/php83/php-fpm.d/www.conf.disabled-wikdra`). Samo `php83` i pula `proj` zostają dla
proj.wikdra.top. Usługa zajmuje ok. 7 MB RAM.

Zachowanie jak w dawnych `stats.php` i `bichu.php` (te same adresy, JSON i komunikaty), z dwiema
różnicami: zapis Bichu i limit prób działają (w PHP od 2026-08-05 kończyły się błędem 500, bo
php-fpm nie mógł pisać w katalogu strony), a liczniki prób są w pamięci, więc restart usługi
(np. wdrożenie) je zeruje. Limity: treść 64 kB, żądanie 256 kB, 5 złych haseł w 15 min → 5 min
blokady dla adresu, 40 złych haseł w 15 min od wszystkich → zapis zablokowany dla każdego. Bez
pliku `bichu.hash` zapis zawsze kończy się `503` (fail-closed).

### Wdrożenie nowej wersji

```powershell
git push                                 # CI: testy, test na Alpine, artefakt wikdra-linux-amd64
pwsh scripts/deploy-api.ps1              # binarka z zielonego CI dla HEAD
pwsh scripts/deploy-api.ps1 -Status      # bieżące wydanie, stan usługi, /healthz
```

`deploy-api.ps1` szuka przebiegu CI dla bieżącego commita (`gh run list -c <sha>`), pobiera
artefakt i sprawdza jego sumę. **Fallback:** gdy nie ma `gh`, GitHub nie odpowiada albo commit
nie ma przebiegu CI (np. nie jest wypchnięty), buduje lokalnie po `go vet` i `go test`
(wersja `<gałąź>-<sha7>[-dirty]-local-<czas>`). Czerwone albo trwające CI to błąd, nie
fallback; świadomie można wymusić build lokalny przez `-Local`.

Na serwerze `wikdra-deploy` sprawdza sumę paczki, uruchamia `wikdra version`, przełącza
`current`, restartuje usługę i czeka do 15 s, aż `/healthz` zwróci nową wersję. Jeśli nie zwróci,
wraca do poprzedniego wydania. Zostają 3 ostatnie wydania. Wdrożenie trwa kilka sekund;
w tym czasie `/stats.php` i `/bichu` dają 502.

### Instalacja od zera (raz)

```powershell
pwsh scripts/deploy-api.ps1 -Install -Plan   # lista zmian, nic nie zmienia
pwsh scripts/deploy-api.ps1 -Install         # server/deploy/install.sh (idempotentny)
pwsh scripts/deploy-api.ps1                  # pierwsza binarka
pwsh scripts/deploy-api.ps1 -ImportPhp       # treść i hasło z dawnej wersji PHP (jeśli pliki są)
pwsh scripts/deploy-api.ps1 -Nginx           # nginx/default.conf: kopia, nginx -t, reload, kontrola
```

`-ImportPhp` kopiuje `bichu_content.txt` i zamienia hasło z `bichu_config.php` na hash bcrypt
(to samo hasło; idzie potokiem `php83` → `wikdra hash-password`, nie jest nigdzie wypisywane).
Istniejących danych usługi nie nadpisuje (`-Force` nadpisuje).

`-Nginx` robi kopię `default.conf` (w `/root/default.conf.<data>` i obok jako `.bak`), sprawdza
`nginx -t`, przeładowuje i kontroluje stronę główną (także tytuł), panele, `/stats.php`,
`/bichu`, 404 dla `/bichu_config.php` i proj.wikdra.top. Przy błędzie wraca do kopii.

### Zmiana hasła edycji Bichu

Na serwerze (hasło wpisujesz bez echa, kończysz Enterem; nie trafia do historii ani logów):

```sh
sudo sh -c 'stty -echo; printf "Nowe hasło: "; read -r p; stty echo; echo;
  printf "%s" "$p" | su -s /bin/sh wikdra -c "/srv/wikdra/current/wikdra hash-password --data-dir=/var/lib/wikdra"'
```

Działa od razu, bez restartu (hash jest czytany przy każdym zapisie).

### Praca lokalna

```powershell
cd server; go test ./...; go run . serve --data-dir ../.dev-wikdra   # http://127.0.0.1:8092
"haslo" | go run . hash-password --data-dir ../.dev-wikdra             # hasło do lokalnych testów
$env:WIKDRA_API = 'http://127.0.0.1:8092'; npm run serve               # strona z /bichu i /stats.php z Go
```

`npm run smoke` uruchamia też test Bichu w Chrome na binarce z `server/.build/wikdra.exe`
(albo `WIKDRA_BIN`): `cd server; go build -o .build/wikdra.exe .`.

## Konfiguracja Nginx

W repo jest **jeden** szablon: `nginx/default.conf` (jeden blok `server`
obsługujący `wikdra.top`, `www.wikdra.top` i `panele.wikdra.top`; stronę startową
wybiera `map $host $root_page`). Wgrywa go `pwsh scripts/deploy-api.ps1 -Nginx`
(albo `scripts\deploy.bat --with-nginx`); ręcznie:

```sh
sudo cp nginx/default.conf /etc/nginx/http.d/default.conf
sudo nginx -t && sudo rc-service nginx reload
```

Zawiera: nagłówki bezpieczeństwa, prawdziwy adres klienta zza Cloudflare
(`set_real_ip_from` + `CF-Connecting-IP`, lista jak w proj.conf; bez tego limity liczyłyby
serwery Cloudflare), `proxy_pass` do usługi Go dla `location = /stats.php` i `location ^~ /bichu`
(`^~` sprawia, że także pozostałości po PHP, np. `bichu_config.php`, idą do Go, które zwraca 404),
`limit_req` 5 r/s (burst 10) na tych trasach, 300 kB limitu żądania dla Bichu, 404 dla każdego
innego `.php` i plików kropkowych.

**Nagłówki i cache w jednym miejscu.** W nginksie `add_header` w bloku `location`
unieważnia wszystkie `add_header` z `server` — dlatego Cache-Control jest liczony
mapą `map $uri $cache_control`, a nie ustawiany per location. Inaczej strony HTML
traciły nagłówki bezpieczeństwa (potwierdzone testem na produkcji). Z tego samego
powodu lokalizacje z `proxy_pass` nie mają własnych `add_header`.

Polityka cache:

| Zasób | Cache-Control | Dlaczego |
|---|---|---|
| fonty `.woff2` | `public, max-age=31536000, immutable` | nigdy się nie zmieniają pod tą samą nazwą |
| CSS, JS, ikony, HTML, JSON | `no-cache` (waliduj przed użyciem) | przy `max-age` Cloudflare podawał starą wersję `app-v6.css` po wdrożeniu (origin 92001 B, CDN 91972 B, `CF-Cache-Status: HIT`). Koszt to tanie 304, a szybkość i offline zapewnia Service Worker trzymający te pliki w Cache Storage |
| `/stats.php`, `/bichu*` | `no-store` (ustawia usługa Go) | odpowiedzi dynamiczne; mapa zwraca pustą wartość, żeby nie było dwóch nagłówków |

Dzięki temu **purge Cloudflare nie jest potrzebny po zwykłym wdrożeniu**. Wyjątek:
podmiana fontu pod tą samą nazwą.

## Aktualizacje systemu (`apk upgrade`)

`/var/lib/nginx/html/index.html` (strona główna) leży w pliku należącym do pakietu
`nginx` (`apk info -L nginx` pokazuje `index.html` i `50x.html`). apk chroni przed
nadpisaniem tylko zmienione pliki w `/etc`, więc aktualizacja nginx podmieniała
naszą stronę na „Welcome to nginx!” (615 B). Tak stało się 2026-11-07: przez dwa dni
wikdra.top pokazywała stronę domyślną, bo sprawdzenie po aktualizacji patrzyło tylko
na kod HTTP 200, a nie na treść. Pozostałe pliki z `site/` nie należą do pakietu
i zostały nietknięte.

Zabezpieczenie (na serwerze od 2026-11-09), zob. `apk-protected_paths(5)`:

```sh
# /etc/apk/protected_paths.d/wikdra.list
+var/lib/nginx/html/index.html
```

Zmieniony plik jest teraz traktowany jak konfiguracja w `/etc`: apk go nie nadpisuje,
a wersję z pakietu zapisuje obok jako `index.html.apk-new`. Sprawdzenie:
`apk audit` wypisuje `U var/lib/nginx/html/index.html`. Cofnięcie: usunąć `wikdra.list`.
`50x.html` nie jest chroniony, bo strona go nie używa (`error_page` wskazuje tylko `404.html`).

Po każdej aktualizacji systemu:

1. `find /var/lib/nginx/html -name '*.apk-new'` — usuń znalezione pliki
   (właściwa strona to ta z repo, nie z pakietu);
2. sprawdź treść, nie tylko kod odpowiedzi:
   ```sh
   curl -s -H 'Host: wikdra.top' http://127.0.0.1/ | grep -o '<title>[^<]*</title>'
   ```
   ma wyjść `<title>Wikdra - Oficjalna Strona i Projekty</title>`.

Gdyby strona jednak została nadpisana, `scripts\deploy.bat` wgrywa całe `site/` od nowa.
Uwaga: smoke test w `deploy.bat` też sprawdza tylko kody HTTP (`curl -f`), więc stronę
domyślną nginx uznałby za poprawną.

## Rollback

Cała witryna jest w Gicie, więc odtworzenie poprzedniej wersji to:

```cmd
git checkout <poprzedni_hash>
scripts\deploy.bat
git checkout main
```

Usługa Go: `wikdra-deploy` sam wraca do poprzedniego wydania, gdy nowe nie odpowiada.
Świadomy powrót do starszej wersji: `pwsh scripts/deploy-api.ps1 -RunId <przebieg CI>` albo na
serwerze `sudo ln -sfn releases/<wersja> /srv/wikdra/current && sudo rc-service wikdra restart`
(lista: `ls -t /srv/wikdra/releases`).

Powrót do dawnej wersji PHP (przełączenie było 2026-11-09; kopia w
`/root/wikdra-php-20261109.tgz`: `html/` z `bichu.php`, `stats.php`, `bichu_config.php`,
`bichu_content.txt`, `php-fpm.d/www.conf` i `nginx/default.conf.php`; konfiguracja nginx sprzed
przełączenia także w `/root/default.conf.20261109-193641`):

```sh
cd /tmp && sudo tar -xzf /root/wikdra-php-20261109.tgz
sudo cp -p /tmp/html/* /var/lib/nginx/html/
sudo mv /etc/php83/php-fpm.d/www.conf.disabled-wikdra /etc/php83/php-fpm.d/www.conf
sudo php-fpm83 -t && sudo rc-service php-fpm83 restart
sudo cp /root/default.conf.20261109-193641 /etc/nginx/http.d/default.conf
sudo nginx -t && sudo rc-service nginx reload
```

(Zapis w PHP i tak nie działał — patrz „Usługa Go”.)

Dane użytkownika (historia prognoz) siedzą w `localStorage` przeglądarki i nie
zależą od wdrożenia. Treść Bichu jest w `/var/lib/wikdra/bichu.txt` na serwerze
(wdrożenia jej nie ruszają); kopia przed większymi zmianami:
`sudo cp -p /var/lib/wikdra/bichu.txt /root/bichu.txt.$(date +%Y%m%d)`.

## Ikony i zrzuty ekranu

- `npm run icons` — generuje prawdziwe PNG (192, 512, maskable 512, favicon 32)
  z SVG w `scripts/generate_icons.js`. Po wdrożeniu wyczyść cache Cloudflare
  dla `/assets/icons/*`.
- `npm run screenshots` — zestaw zrzutów dla 3 urządzeń × 10 motywów.
  Domyślnie zrzuca produkcję; pamiętaj, że URL nie gwarantuje, że produkcja
  odpowiada bieżącemu commitowi.

## Cron (serwer)

`scripts/update_cron.sh` dokłada wpis rozgrzewający cache forecast.solar,
zachowując istniejący crontab i tworząc jego kopię w `/tmp`. Nie używaj
`update.sh` przez `crontab -` — to tylko szablon wpisu do podejrzenia.

## Uwagi

- Połączenie: `ssh -p YOUR_PORT YOUR_USER@YOUR_HOST` (wartości z `config.bat`).
- **Znane ograniczenie:** hasło SSH trafia do argumentów procesu (`plink -pw`,
  `echo … | sudo -S`; tak samo w `scripts/remote.ps1` używanym przez `deploy-api.ps1`).
  Docelowo klucz SSH (`plink -i`) + `sudoers` z `NOPASSWD` dla `cp`/`rc-service`.
