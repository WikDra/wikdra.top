# Deployment na Mikrus (FROG)

Serwer: Alpine Linux + Nginx na VPS Mikrus FROG. Katalog WWW: `/var/lib/nginx/html/`.

## Konfiguracja lokalna (raz)

1. W katalogu głównym repo utwórz `config.bat` (jest w `.gitignore`):
   ```cmd
   @set MIKRUS_PW=haslo_ssh
   @set MIKRUS_PORT=11098
   @set MIKRUS_USER=frog
   @set MIKRUS_HOST=frog02.mikr.us
   ```

2. **`site/bichu_config.php` jest WYMAGANY, jeśli edycja Bichu ma działać.**
   Bez niego `bichu.php` odpowiada `503` i nie zapisuje niczego (fail-closed) —
   wcześniej brak tego pliku oznaczał, że zapis przechodził z pustym hasłem.

   Zalecana forma (hash, nie hasło jawne):
   ```php
   <?php
   // wygeneruj: php -r "echo password_hash('twoje_haslo', PASSWORD_DEFAULT), PHP_EOL;"
   $admin_password_hash = '$2y$10$....';
   ```
   Forma zgodna wstecz (odradzana, hasło leży jawnie na dysku):
   ```php
   <?php
   $admin_password = 'twoje_haslo';
   ```
   Plik jest w `.gitignore`, a Nginx zwraca dla niego `404`.

3. Wymagane narzędzia: `pscp` i `plink` (PuTTY) w PATH oraz Node ≥ 20 (`npm ci`).

## Wdrożenie

```cmd
npm run check
scripts\deploy.bat
```

`deploy.bat` po kolei:
1. buduje CSS (`npm run build:css`) — bez tego artefakt mógłby się rozjechać ze źródłem,
2. wysyła **jawną listę** plików z `site/` do katalogu tymczasowego na serwerze
   (celowo NIE `*`: lokalna kopia `bichu_content.txt` / `bichu_attempts.json`
   nie nadpisze danych produkcyjnych),
3. kopiuje je do `/var/lib/nginx/html/` i usuwa pliki po starych wersjach
   (`sw-v5.js`, `sw-v6.js`, `themes-v5.css`, `manifest.json`),
4. opcjonalnie (`deploy.bat --with-nginx`) aktualizuje konfigurację Nginx:
   kopia zapasowa → `nginx -t` → `reload`; przy błędzie testu wraca do kopii,
5. wykonuje smoke test: strona główna, panele, favicon, `stats.php`
   oraz kontrola, że `GET /bichu_config.php` zwraca `404`.

Każdy krok kontroluje kod wyjścia — komunikat `[SUCCESS]` pojawia się tylko
wtedy, gdy wszystko przeszło.

## Konfiguracja Nginx

W repo jest **jeden** szablon: `nginx/default.conf` (jeden blok `server`
obsługujący `wikdra.top`, `www.wikdra.top` i `panele.wikdra.top`; stronę startową
wybiera `map $host $root_page`).

```sh
sudo cp nginx/default.conf /etc/nginx/http.d/default.conf
sudo nginx -t && sudo rc-service nginx reload
```

Zawiera: nagłówki bezpieczeństwa, blokadę `bichu_config.php` / `bichu_content.txt`
/ `bichu_attempts.json` / plików kropkowych, wąskie `location` dla PHP (tylko
`bichu.php` i `stats.php`), `limit_req` 5 r/s, `fastcgi_hide_header X-Powered-By`.

**Nagłówki i cache w jednym miejscu.** W nginksie `add_header` w bloku `location`
unieważnia wszystkie `add_header` z `server` — dlatego Cache-Control jest liczony
mapą `map $uri $cache_control`, a nie ustawiany per location. Inaczej strony HTML
traciły nagłówki bezpieczeństwa (potwierdzone testem na produkcji).

Polityka cache:

| Zasób | Cache-Control | Dlaczego |
|---|---|---|
| fonty `.woff2` | `public, max-age=31536000, immutable` | nigdy się nie zmieniają pod tą samą nazwą |
| CSS, JS, ikony, HTML, JSON | `no-cache` (waliduj przed użyciem) | przy `max-age` Cloudflare podawał starą wersję `app-v6.css` po wdrożeniu (origin 92001 B, CDN 91972 B, `CF-Cache-Status: HIT`). Koszt to tanie 304, a szybkość i offline zapewnia Service Worker trzymający te pliki w Cache Storage |
| `.php` | `no-store` (ustawia sam skrypt) | odpowiedzi API nie mają czego cache'ować |

Dzięki temu **purge Cloudflare nie jest potrzebny po zwykłym wdrożeniu**. Wyjątek:
podmiana fontu pod tą samą nazwą.

Dodatkowo w `php.ini` warto ustawić `expose_php = Off`.

## Rollback

Cała witryna jest w Gicie, więc odtworzenie poprzedniej wersji to:

```cmd
git checkout <poprzedni_hash>
scripts\deploy.bat
git checkout modernize
```

Dane użytkownika (historia prognoz) siedzą w `localStorage` przeglądarki i nie
zależą od wdrożenia. Treść Bichu jest w `/var/lib/nginx/html/bichu_content.txt`
na serwerze — warto zrobić kopię przed większymi zmianami:
`plink ... "cat /var/lib/nginx/html/bichu_content.txt" > backup.txt`.

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

- Połączenie: `ssh -p 11098 frog@frog02.mikr.us`.
- **Znane ograniczenie:** hasło SSH trafia do argumentów procesu (`plink -pw`,
  `echo … | sudo -S`). Docelowo klucz SSH (`plink -i`) + `sudoers` z `NOPASSWD`
  dla `cp`/`rc-service`.
