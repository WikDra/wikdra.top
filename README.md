# wikdra.top

Statyczna strona **wikdra.top** / **panele.wikdra.top** na VPS-ie Mikrus (Alpine Linux + Nginx).
Bez frameworka i bez bundlera: 5 dokumentów, Alpine.js + uPlot, CSS budowany Tailwindem.

## Struktura

- `site/` — wszystko, co serwuje Nginx:
  - `index.html` — portfolio (metryki VPS z `stats.php`)
  - `panels.html` — dashboard prognozy PV (forecast.solar + uPlot)
  - `history.html` — archiwum zapisanych dni, statystyki, eksport/import JSON
  - `404.html`, `offline.html` — strona błędu i strona offline (PWA)
  - `bichu.php` — mini-edytor treści (fail-closed, hasło z `bichu_config.php`)
  - `stats.php` — metryki kontenera (CPU/RAM/dysk) z cache 10 s
  - `sw-v7.js` — Service Worker: app shell, offline fallback, namespace cache
  - `manifest-solar.json` — manifest PWA **tylko** dla dashboardu solarnego
  - `robots.txt`, `sitemap.xml`
  - `assets/js/` — wspólne moduły:
    - `theme.js` — jedyne źródło prawdy dla motywu/trybu + montowany switcher
    - `storage.js` — schemat v2 historii, migracje, retencja, walidacja importu
    - `solar.js` — czyste obliczenia (clipping, energia, dane wykresu)
    - `panels-app.js`, `history-app.js`, `index-app.js`, `bichu-app.js` — komponenty Alpine
    - `alpine.min.js`, `uPlot.iife.min.js` — vendored zależności runtime
  - `assets/css/app-v6.css` — artefakt builda (nie edytować ręcznie)
  - `assets/fonts/`, `assets/icons/`
- `src/app.css` — **źródło** design systemu (5 motywów × jasny/ciemny)
- `nginx/default.conf` — jeden kanoniczny szablon konfiguracji
- `scripts/` — `deploy.bat`, `check.js`, `generate_icons.js`, `generate_all_screenshots.js`, skrypty crona
- `docs/deployment.md` — konfiguracja, wdrożenie, rollback

## Praca lokalna

```cmd
npm ci
npm run watch:css       :: build CSS w trybie ciągłym
npm run serve           :: lokalny serwer statyczny (http://127.0.0.1:8790)
npm run check           :: składnia JS/PHP, determinizm builda, reguły treści (~1 s)
npm run smoke           :: 144 asercje w headless Chrome: strony, motywy, obliczenia, PWA (~55 s)
npm run test:php        :: 25 asercji API bichu.php/stats.php (wymaga PHP w %TEMP%\php-lint lub PATH)
npm run icons           :: regeneracja ikon PWA
scripts\deploy.bat      :: wdrożenie (szczegóły w docs/deployment.md)
```

`npm run smoke` wymaga Chrome (ścieżka przez `CHROME_PATH`) i ma watchdog —
przy zawieszeniu kończy się kodem 2, nie wisi. `npm run test:php` pomija się
sam, jeśli nie znajdzie PHP.

Zasady, które warto utrzymać:

- **Motyw** zmienia się tylko przez `WikdraTheme` — nie duplikuj logiki w stronach.
- **Historia** czytana i zapisywana wyłącznie przez `WikdraStorage` (wersjonowany schemat).
- **Obliczenia** w `WikdraSolar`; każdy zapisany dzień trzyma własny snapshot
  parametrów, więc zmiana limitu falownika nie przelicza archiwum.
- W `src/app.css` nie dopisuj `-webkit-backdrop-filter` — build dokłada prefiksy,
  a ręczna wersja powoduje usunięcie właściwości standardowej (i brak efektu w Firefoksie).
- Skanowanie klas jest jawne (`@source`), więc nowy plik z klasami trzeba tam dodać.

## Licencja

[MIT](LICENSE)
