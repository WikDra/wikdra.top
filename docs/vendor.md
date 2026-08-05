# Zależności vendored (kopiowane do repo, poza `npm audit`)

Te pliki są dołączone do repozytorium, bo strona nie ma bundlera — ładują się
bezpośrednio ze `site/assets/`. `npm audit` ich NIE widzi, dlatego wersje i sumy
kontrolne są zapisane tutaj i sprawdzane ręcznie przy aktualizacji.

| Plik | Biblioteka | Wersja | SHA256 |
|---|---|---|---|
| `site/assets/js/alpine.min.js` | Alpine.js | 3.14.9 | `3ed1eed252488921df65e363d6715deb04d7f92aaedb9e52199fdf73cb1e0ad3` |
| `site/assets/js/uPlot.iife.min.js` | uPlot | 1.6.32 | `19c8d4c6ad88929a79f4ae49d6f7161566dfd0ba3d15cc495e974f787eb78f1f` |
| `site/assets/css/uplot.min.css` | uPlot (styl) | 1.6.32 | `df630c6a8d6f8eeaff264b50f73ce5b114f646ffd9a0bb74f049b0a00135fa04` |

## Aktualizacja

1. Pobierz nową wersję z oficjalnego wydania (GitHub releases / jsDelivr).
2. Podmień plik, przelicz sumę: `Get-FileHash <plik> -Algorithm SHA256`.
3. Zaktualizuj tabelę powyżej (wersja + suma).
4. `npm run check && npm run smoke` — testy dymne przechodzą przez Alpine i uPlot,
   więc regresja w tych bibliotekach zostanie wyłapana.
5. Po wdrożeniu pamiętaj, że pliki są w app shellu Service Workera —
   podbij wersję cache w `site/sw-v7.js` (`const VERSION`), żeby klienci pobrali nowe.

Fonty w `site/assets/fonts/` to subsety (latin + latin-ext) rodzin: Syne, Space
Grotesk, Orbitron, Space Mono, Inter, Playfair Display, JetBrains Mono —
licencje OFL/Apache, źródło: Google Fonts.
