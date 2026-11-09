# wikdra.top

Statyczna strona **wikdra.top** / **panele.wikdra.top** na VPS-ie Mikrus (Alpine Linux + Nginx).
Bez frameworka i bez bundlera: 5 dokumentów, Alpine.js + uPlot, CSS budowany Tailwindem.
Dwie dynamiczne trasy (metryki serwera i edytor Bichu) obsługuje mała usługa Go z `server/`.

## Struktura

- `site/` — wszystko, co serwuje Nginx z dysku:
  - `index.html` — portfolio (metryki VPS z `/stats.php`)
  - `panels.html` — dashboard prognozy PV (forecast.solar + uPlot)
  - `history.html` — archiwum zapisanych dni, statystyki, eksport/import JSON
  - `404.html`, `offline.html` — strona błędu i strona offline (PWA)
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
- `server/` — usługa Go `wikdra` (127.0.0.1:8092 za nginx):
  - `/stats.php` — metryki kontenera (CPU/RAM/dysk), wynik trzymany 10 s
  - `/bichu` (też `/bichu.php`) — strona `bichu.html` i API `?api=1`: jedno hasło (bcrypt),
    fail-closed, limit prób, zapis atomowy
  - `deploy/` — usługa OpenRC, `wikdra-deploy` (wdrożenie z powrotem), instalacja, import z PHP, test na Alpine
- `src/app.css` — **źródło** design systemu (5 motywów × jasny/ciemny)
- `nginx/default.conf` — jeden kanoniczny szablon konfiguracji
- `scripts/` — `deploy.bat` (strona), `deploy-api.ps1` (usługa Go), `check.js`, `smoke.js`,
  `generate_icons.js`, `generate_all_screenshots.js`, skrypty crona
- `docs/deployment.md` — konfiguracja, wdrożenie strony i usługi Go, rollback, aktualizacje systemu (`apk upgrade`)
- `.github/workflows/ci.yml` — CI: testy Go, test usługi na Alpine z OpenRC i nginx, kontrole, test UI w Chrome

## Praca lokalna

```cmd
npm ci
npm run watch:css       :: build CSS w trybie ciągłym
npm run serve           :: lokalny serwer statyczny (http://127.0.0.1:8790)
npm run check           :: składnia JS, determinizm builda CSS, reguły treści (~1 s)
npm run smoke           :: 168 asercji w headless Chrome: strony, motywy, obliczenia, PWA, Bichu na Go (~60 s)
npm run test:server     :: go vet + go test usługi z server/ (wymaga Go 1.27)
npm run icons           :: regeneracja ikon PWA
scripts\deploy.bat      :: wdrożenie strony (szczegóły w docs/deployment.md)
pwsh scripts\deploy-api.ps1 :: wdrożenie usługi Go z artefaktu CI (fallback: build lokalny)
```

`npm run smoke` wymaga Chrome (ścieżka przez `CHROME_PATH`) i ma watchdog —
przy zawieszeniu kończy się kodem 2, nie wisi. Test Bichu potrzebuje binarki
`server/.build/wikdra.exe` (`cd server && go build -o .build/wikdra.exe .`); bez niej
lokalnie jest pomijany z ostrzeżeniem, a w CI jest błędem.

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
