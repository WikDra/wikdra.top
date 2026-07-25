# Deployment na Mikrus (FROG)

Serwer: Alpine Linux + Nginx na VPS Mikrus FROG. Katalog WWW na serwerze: `/var/lib/nginx/html/`.

## Konfiguracja lokalna (raz)

1. W katalogu głównym repo utwórz `config.bat` (jest w `.gitignore`):
   ```cmd
   @set MIKRUS_PW=haslo_ssh
   @set MIKRUS_PORT=11098
   @set MIKRUS_USER=frog
   @set MIKRUS_HOST=frog02.mikr.us
   ```
2. Opcjonalnie `site/bichu_config.php` z hasłem admina panelu Bichu (też w `.gitignore`):
   ```php
   <?php
   $admin_password = 'twoje_haslo';
   ```
3. Wymagane narzędzia na Windows: `pscp` i `plink` (z pakietu PuTTY) w PATH.

## Wdrożenie

Uruchom z dowolnego miejsca:

```cmd
scripts\deploy.bat
```

Skrypt:
1. Wysyła zawartość `site/` na serwer przez `pscp` (w tym `bichu_config.php`, jeśli istnieje),
2. Przenosi pliki do `/var/lib/nginx/html/` (`sudo mv` przez `plink`),
3. Restartuje Nginx (`rc-service nginx restart`).

## Uwagi

- Połączenie z serwerem: `ssh -p 11098 frog@frog02.mikr.us`.
- Konfiguracja Nginx na serwerze: `/etc/nginx/http.d/default.conf` — szablony w katalogu `nginx/`.
- `scripts/update.sh` i `scripts/update_cron.sh` — pomocnicze skrypty serwerowe (aktualizacja systemu).
