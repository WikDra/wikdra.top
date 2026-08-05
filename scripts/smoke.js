/**
 * smoke.js — test dymny całej witryny w headless Chrome.
 *
 * Uruchamia lokalny serwer statyczny na `site/` (ze zaślepką `stats.php`),
 * podstawia deterministyczne odpowiedzi forecast.solar i Nominatim, po czym:
 *   • ładuje wszystkie strony w kilku motywach i wymaga ZERA błędów konsoli,
 *   • sprawdza montaż switchera motywów i jego dostępność (aria-expanded, Escape),
 *   • weryfikuje obliczenia solarne (clipping, energia, limit per dzień),
 *   • weryfikuje magazyn: migrację v1→v2, walidację importu, round-trip eksportu,
 *   • sprawdza render metryk, gdy stats.php zwraca ram = null.
 *
 * Uruchomienie: npm run smoke
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 8791;
const BASE = 'http://127.0.0.1:' + PORT;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.xml': 'application/xml',
    '.txt': 'text/plain; charset=utf-8'
};

let passed = 0;
let failed = 0;
function assert(cond, label, detail) {
    if (cond) { passed++; console.log('  \u2713 ' + label); }
    else { failed++; console.error('  \u2717 ' + label + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
}
function section(name) { console.log('\n' + name); }

/** Osobny kontekst = czyste localStorage/cookies dla kazdego przypadku. */
async function freshPage(browser) {
    const ctx = await browser.createBrowserContext();
    return ctx.newPage();
}

// ——— serwer statyczny ———
function startServer() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, BASE);
        if (url.pathname === '/stats.php') {
            // celowo ram = null — front musi pokazać „—", nie liczbę
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ cpu: 12.5, ram: null, disk: 47.2, age: 0 }));
            return;
        }
        let rel = decodeURIComponent(url.pathname);
        if (rel === '/') rel = '/index.html';
        const file = path.join(SITE, rel);
        if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            const notFound = path.join(SITE, '404.html');
            res.writeHead(404, { 'Content-Type': MIME['.html'] });
            res.end(fs.readFileSync(notFound));
            return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(fs.readFileSync(file));
    });
    // krótkie keep-alive: bez tego zamknięcie serwera czeka na uśpione połączenia Chrome
    server.keepAliveTimeout = 300;
    server.headersTimeout = 1000;
    return new Promise((resolve, reject) => {
        server.once('error', (err) => reject(new Error('nie moge wystartowac serwera na ' + PORT + ': ' + err.message)));
        server.listen(PORT, '127.0.0.1', () => resolve(server));
    });
}

/**
 * Zamknięcie serwera BEZ ryzyka zawieszenia: server.close() czeka na otwarte
 * połączenia keep-alive, których Chrome trzyma kilka. Zrywamy je jawnie
 * i dodatkowo ograniczamy czekanie limitem czasu.
 */
function stopServer(server) {
    return new Promise((resolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        const timer = setTimeout(finish, 3000);
        timer.unref();
        server.close(() => { clearTimeout(timer); finish(); });
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    });
}

// ——— deterministyczna odpowiedź forecast.solar ———
// Klucze celowo NIE po kolei — sprawdzamy sortowanie osi X.
const FORECAST = {
    result: {
        watts: {
            '2026-08-04 09:00:00': 2000,
            '2026-08-04 06:00:00': 1000,
            '2026-08-04 08:00:00': 6000,
            '2026-08-04 07:00:00': 3000
        },
        watt_hours_day: { '2026-08-04': 11000 }
    }
};

function attachRouting(page, errors) {
    page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push('console: ' + msg.text());
    });
    page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
    page.on('requestfailed', (req) => {
        // zablokowane przez nas żądania zewnętrzne nie są błędem
        if (!/forecast\.solar|nominatim/.test(req.url())) {
            errors.push('requestfailed: ' + req.url() + ' ' + (req.failure() && req.failure().errorText));
        }
    });
}

async function interceptExternal(page) {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const url = req.url();
        if (url.includes('api.forecast.solar')) {
            req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(FORECAST) });
        } else if (url.includes('nominatim.openstreetmap.org')) {
            req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify([{ lat: '50.061', lon: '19.937' }]) });
        } else {
            req.continue();
        }
    });
}

async function setTheme(page, theme, mode) {
    await page.evaluateOnNewDocument((t, m) => {
        localStorage.setItem('global_theme', t);
        localStorage.setItem('global_mode', m);
    }, theme, mode);
}

// Watchdog: przy zawieszeniu (np. niedomkniete gniazdo) proces sam sie konczy.
const WATCHDOG_MS = Number(process.env.SMOKE_TIMEOUT_MS || 300000);
const watchdog = setTimeout(() => {
    console.error('\nPRZEKROCZONY LIMIT CZASU (' + Math.round(WATCHDOG_MS / 1000) + ' s) — przerywam test dymny.');
    process.exit(2);
}, WATCHDOG_MS);

(async () => {
    let server = await startServer();
    const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage']
    });

    try {
        // ============ 1. Wszystkie strony × motywy: zero błędów ============
        section('[1] Ladowanie stron we wszystkich motywach (zero bledow konsoli)');
        const pages = ['/index.html', '/panels.html', '/history.html', '/404.html', '/offline.html'];
        const combos = [['brutalist', 'light'], ['cyberpunk', 'dark'], ['terminal', 'light'], ['aurora', 'dark'], ['editorial', 'light']];
        for (const [theme, mode] of combos) {
            for (const p of pages) {
                const page = await freshPage(browser);
                const errors = [];
                attachRouting(page, errors);
                await interceptExternal(page);
                await setTheme(page, theme, mode);
                await page.goto(BASE + p, { waitUntil: 'networkidle2' });
                await new Promise((r) => setTimeout(r, 250));
                const applied = await page.evaluate(() => [document.documentElement.dataset.theme, document.documentElement.dataset.mode]);
                assert(errors.length === 0, p + ' [' + theme + '/' + mode + ']: brak bledow', errors);
                assert(applied[0] === theme && applied[1] === mode, p + ' [' + theme + '/' + mode + ']: motyw zastosowany', applied);

                // Czy w otwarty panel switchera DA SIĘ kliknąć? Sam fakt, że jest
                // widoczny, nie wystarcza: w Glassmorphism nagłówek ma backdrop-filter
                // (kontekst stackingu), więc panel wchodził pod karty i przechwytywały
                // one kliknięcia. Test trafienia przez elementFromPoint to wyłapuje.
                if (await page.$('.switcher-btn')) {
                    await page.click('.switcher-btn');
                    await new Promise((r) => setTimeout(r, 250));
                    const hits = await page.evaluate(() => {
                        const items = Array.from(document.querySelectorAll('.switcher-panel .switcher-item'));
                        return items.map(function (t) {
                            const r = t.getBoundingClientRect();
                            const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
                            return !!(hit && (hit === t || t.contains(hit) || (hit.closest && hit.closest('.switcher-panel'))));
                        });
                    });
                    assert(hits.length >= 7 && hits.every(Boolean),
                        p + ' [' + theme + '/' + mode + ']: pozycje switchera klikalne (nic ich nie przykrywa)',
                        { klikalne: hits.filter(Boolean).length, wszystkich: hits.length });
                    await page.keyboard.press('Escape');
                }
                await page.close();
            }
        }

        // ============ 2. Switcher motywów ============
        section('[2] Switcher motywow (montaz + dostepnosc + zapis wyboru)');
        {
            const page = await freshPage(browser);
            const errors = [];
            attachRouting(page, errors);
            await interceptExternal(page);
            await page.goto(BASE + '/index.html', { waitUntil: 'networkidle2' });
            await new Promise((r) => setTimeout(r, 200));

            assert(await page.$('.switcher .switcher-btn') !== null, 'switcher zostal wstawiony przez theme.js');
            assert(await page.$eval('.switcher-btn', (el) => el.getAttribute('aria-expanded')) === 'false', 'aria-expanded=false przed otwarciem');
            assert(await page.$eval('.switcher-btn', (el) => el.getAttribute('type')) === 'button', 'przycisk ma type="button"');

            await page.click('.switcher-btn');
            await new Promise((r) => setTimeout(r, 150));
            assert(await page.$eval('.switcher-btn', (el) => el.getAttribute('aria-expanded')) === 'true', 'aria-expanded=true po otwarciu');
            assert(await page.$eval('.switcher-panel', (el) => getComputedStyle(el).display !== 'none'), 'panel widoczny');

            await page.keyboard.press('Escape');
            await new Promise((r) => setTimeout(r, 150));
            assert(await page.$eval('.switcher-btn', (el) => el.getAttribute('aria-expanded')) === 'false', 'Escape zamyka panel');
            assert(await page.evaluate(() => document.activeElement.classList.contains('switcher-btn')), 'fokus wraca na przycisk');

            // wybór motywu zapisuje preferencję (cookie + localStorage)
            await page.click('.switcher-btn');
            await new Promise((r) => setTimeout(r, 120));
            const items = await page.$$('.switcher-item');
            await items[1].click(); // Cyber Dashboard
            await new Promise((r) => setTimeout(r, 200));
            const state = await page.evaluate(() => ({
                theme: document.documentElement.dataset.theme,
                mode: document.documentElement.dataset.mode,
                ls: localStorage.getItem('global_theme'),
                cookie: document.cookie
            }));
            assert(state.theme === 'cyberpunk' && state.mode === 'dark', 'wybor motywu zastosowany', state);
            assert(state.ls === 'cyberpunk' && state.cookie.includes('global_theme=cyberpunk'), 'wybor zapisany w localStorage i cookie', state);
            assert(errors.length === 0, 'brak bledow konsoli w interakcji', errors);
            await page.close();
        }

        // ============ 3. Obliczenia solarne (czyste funkcje) ============
        section('[3] Obliczenia solarne (solar.js)');
        {
            const page = await freshPage(browser);
            const errors = [];
            attachRouting(page, errors);
            await interceptExternal(page);
            await page.goto(BASE + '/panels.html', { waitUntil: 'networkidle2' });
            const calc = await page.evaluate(() => {
                const S = window.WikdraSolar;
                const watts = { '2026-08-04 09:00:00': 2000, '2026-08-04 06:00:00': 1000, '2026-08-04 08:00:00': 6000, '2026-08-04 07:00:00': 3000 };
                return {
                    sorted: S.sortedTimes(watts),
                    energy5500: S.energyFromWatts(watts, 5500),
                    energy3000: S.energyFromWatts(watts, 3000),
                    energyInf: S.energyFromWatts(watts, 999999),
                    peak: S.clipWatts(watts, 5500).peak,
                    series: S.chartSeries(watts, 5500),
                    clampedParams: S.normalizeParams({ lat: '999', lon: 'abc', dec: -5, az: 400, kwp: 0, limit: '-3' }),
                    dayLimitFallback: S.dayLimit({ watts: watts }, 4200),
                    dayLimitOwn: S.dayLimit({ watts: watts, params: { limit: 3300 } }, 4200)
                };
            });
            assert(JSON.stringify(calc.sorted) === JSON.stringify([
                '2026-08-04 06:00:00', '2026-08-04 07:00:00', '2026-08-04 08:00:00', '2026-08-04 09:00:00'
            ]), 'sortedTimes porzadkuje znaczniki czasu', calc.sorted);
            assert(calc.energy5500 === 10, 'energia z clippingiem 5500 W = 10.00 kWh', calc.energy5500);
            assert(calc.energy3000 === 7.5, 'energia z clippingiem 3000 W = 7.50 kWh', calc.energy3000);
            assert(calc.energyInf === 10.5, 'energia bez clippingu = 10.50 kWh', calc.energyInf);
            assert(calc.peak === 5500, 'moc szczytowa obcieta do limitu', calc.peak);
            assert(calc.series[0][0] < calc.series[0][3] && calc.series[1][2] === 5500, 'dane wykresu rosnace i obciete', calc.series[1]);
            assert(calc.clampedParams.lat === 90 && calc.clampedParams.az === 180 && calc.clampedParams.kwp === 0.1 && calc.clampedParams.limit === 1,
                'normalizeParams przycina zakresy', calc.clampedParams);
            assert(calc.dayLimitFallback === 4200 && calc.dayLimitOwn === 3300, 'limit dnia: wlasny wygrywa z biezacym', calc);
            assert(errors.length === 0, 'brak bledow konsoli', errors);
            await page.close();
        }

        // ============ 4. Magazyn: walidacja importu i round-trip ============
        section('[4] Magazyn (storage.js)');
        {
            const page = await freshPage(browser);
            const errors = [];
            attachRouting(page, errors);
            await interceptExternal(page);
            await page.goto(BASE + '/history.html', { waitUntil: 'networkidle2' });
            const res = await page.evaluate(() => {
                const St = window.WikdraStorage;
                const S = window.WikdraSolar;
                const garbage = St.parseImport('to nie json', S.DEFAULT_PARAMS);
                const wrongShape = St.parseImport(JSON.stringify({ foo: 'bar' }), S.DEFAULT_PARAMS);
                const badDates = St.parseImport(JSON.stringify({ days: { 'wczoraj': { watts: { 'x': 1 } } } }), S.DEFAULT_PARAMS);
                const v1 = St.parseImport(JSON.stringify({
                    version: '1.0',
                    params: { lat: 52.1, lon: 21.1, dec: 30, az: 0, kwp: 8, limit: 4000 },
                    history: { '2026-08-04': { energy: '11.00', watts: { '2026-08-04 07:00:00': 3000, '2026-08-04 08:00:00': 6000 } } }
                }), S.DEFAULT_PARAMS);
                const merged = St.mergeDays(v1.days, St.parseImport(JSON.stringify({
                    days: { '2026-08-05': { watts: { '2026-08-05 07:00:00': 1000, '2026-08-05 08:00:00': 2000 }, params: { limit: 5000 } } }
                }), S.DEFAULT_PARAMS).days);
                const exported = St.buildExport(v1.params, merged.days);
                const roundTrip = St.parseImport(JSON.stringify(exported), S.DEFAULT_PARAMS);
                return {
                    garbage: { ok: garbage.ok, hasError: !!garbage.error },
                    wrongShape: { ok: wrongShape.ok, accepted: wrongShape.accepted },
                    badDates: { ok: badDates.ok, skipped: badDates.skipped },
                    v1: { ok: v1.ok, accepted: v1.accepted, energy: v1.days['2026-08-04'].energy, limit: v1.days['2026-08-04'].params.limit, raw: v1.days['2026-08-04'].energyRaw },
                    merged: { added: merged.added, updated: merged.updated, count: Object.keys(merged.days).length },
                    roundTrip: { ok: roundTrip.ok, accepted: roundTrip.accepted, same: JSON.stringify(roundTrip.days) === JSON.stringify(merged.days) }
                };
            });
            assert(res.garbage.ok === false && res.garbage.hasError, 'import: smieci odrzucone z komunikatem', res.garbage);
            assert(res.wrongShape.ok === false && res.wrongShape.accepted === 0, 'import: obcy obiekt odrzucony', res.wrongShape);
            assert(res.badDates.ok === false && res.badDates.skipped === 1, 'import: bledny klucz daty pominiety', res.badDates);
            assert(res.v1.ok === true && res.v1.accepted === 1, 'import v1 zaakceptowany', res.v1);
            // limit 4000 z pliku: (3000+4000)/2 * 1h = 3.5 kWh
            assert(res.v1.energy === 3.5, 'energia po migracji liczona limitem z pliku', res.v1);
            assert(res.v1.limit === 4000, 'dzien zachowal wlasny limit', res.v1);
            assert(res.v1.raw === 11, 'energia surowa zachowana jako energyRaw', res.v1);
            assert(res.merged.added === 1 && res.merged.count === 2, 'scalanie dni', res.merged);
            assert(res.roundTrip.ok && res.roundTrip.same, 'round-trip eksport→import bez strat', res.roundTrip);
            assert(errors.length === 0, 'brak bledow konsoli', errors);
            await page.close();
        }

        // ============ 5. Migracja v1 z localStorage ============
        section('[5] Migracja historii v1 -> v2 przy starcie');
        {
            const page = await freshPage(browser);
            const errors = [];
            attachRouting(page, errors);
            await interceptExternal(page);
            await page.evaluateOnNewDocument(() => {
                localStorage.setItem('solar_params', JSON.stringify({ lat: 52.2, lon: 21.0, dec: 30, az: 0, kwp: 8, limit: 5000 }));
                localStorage.setItem('solar_history', JSON.stringify({
                    '2026-07-01': { energy: '9.99', watts: { '2026-07-01 07:00:00': 4000, '2026-07-01 08:00:00': 8000 } },
                    'nie-data': { energy: '1', watts: {} }
                }));
            });
            await page.goto(BASE + '/history.html', { waitUntil: 'networkidle2' });
            await new Promise((r) => setTimeout(r, 300));
            const out = await page.evaluate(() => {
                const raw = JSON.parse(localStorage.getItem('solar_history'));
                return {
                    version: raw.version,
                    days: Object.keys(raw.days),
                    energy: raw.days['2026-07-01'].energy,
                    limit: raw.days['2026-07-01'].params.limit,
                    backup: localStorage.getItem('solar_history_v1_backup') !== null,
                    visibleRows: document.querySelectorAll('tbody tr').length
                };
            });
            assert(out.version === 2, 'schemat podniesiony do v2', out);
            assert(out.days.length === 1 && out.days[0] === '2026-07-01', 'niepoprawny klucz odrzucony', out.days);
            // limit 5000: (4000+5000)/2 = 4.5 kWh
            assert(out.energy === 4.5, 'energia przeliczona z clippingiem', out.energy);
            assert(out.limit === 5000, 'dzien dostal snapshot parametrow', out.limit);
            assert(out.backup === true, 'utworzono kopie solar_history_v1_backup', out.backup);
            assert(out.visibleRows >= 1, 'tabela historii wyrenderowana', out.visibleRows);
            assert(errors.length === 0, 'brak bledow konsoli', errors);
            await page.close();
        }

        // ============ 6. panels.html: przepływ danych i limit per dzień ============
        section('[6] panels.html: prognoza, clipping, limit per dzien');
        {
            const page = await freshPage(browser);
            const errors = [];
            attachRouting(page, errors);
            await interceptExternal(page);
            await page.goto(BASE + '/panels.html?date=2026-08-04', { waitUntil: 'networkidle2' });
            await new Promise((r) => setTimeout(r, 500));

            const view = await page.evaluate(() => ({
                energy: document.querySelectorAll('.stat-value')[0].textContent.trim(),
                peak: document.querySelectorAll('.stat-value')[1].textContent.trim(),
                limit: document.querySelectorAll('.stat-value')[2].textContent.trim(),
                rows: document.querySelectorAll('tbody tr:not([style*="display: none"])').length,
                clipping: Array.from(document.querySelectorAll('.clipping-badge')).filter((e) => getComputedStyle(e).display !== 'none').length,
                canvas: document.querySelectorAll('#forecastChart canvas').length,
                status: (document.querySelector('.status-msg') || {}).textContent
            }));
            assert(view.energy === '10.00', 'energia dnia = 10.00 kWh (z clippingiem)', view);
            assert(view.peak === '5500', 'moc szczytowa = 5500 W', view);
            assert(view.limit === '5500', 'karta limitu pokazuje limit dnia', view);
            assert(view.rows === 4, 'tabela ma 4 wiersze godzinowe', view);
            assert(view.clipping === 1, 'dokladnie jedna godzina oznaczona jako clipping', view);
            assert(view.canvas >= 1, 'uPlot wyrysowal wykres', view);

            // Regresja odstępów: `space-y-*` w Tailwind v4 używa selektora z :where()
            // (zerowa specyficzność), więc byle utility marginesu potrafi go wyłączyć.
            const gaps = await page.evaluate(() => {
                const sec = document.querySelector('main section');
                const kids = Array.from(sec.children);
                return kids.slice(1).map((el, i) => ({
                    para: kids[i].tagName.toLowerCase() + '→' + el.tagName.toLowerCase(),
                    gap: Math.round(el.getBoundingClientRect().top - kids[i].getBoundingClientRect().bottom)
                }));
            });
            const tooTight = gaps.filter((g) => g.gap < 16);
            assert(tooTight.length === 0, 'karty w kolumnie maja odstepy (min. 16 px)', gaps);

            // zmiana limitu w formularzu NIE zmienia archiwum, ale proponuje przeliczenie
            await page.evaluate(() => {
                const el = document.getElementById('param-limit');
                el.value = '3000';
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            });
            await new Promise((r) => setTimeout(r, 250));
            const afterLimit = await page.evaluate(() => ({
                energy: document.querySelectorAll('.stat-value')[0].textContent.trim(),
                mismatchVisible: Array.from(document.querySelectorAll('p')).some((p) => /Ten dzien policzono|Ten dzień policzono/.test(p.textContent) && getComputedStyle(p).display !== 'none')
            }));
            assert(afterLimit.energy === '10.00', 'zmiana limitu nie przelicza zapisanego dnia', afterLimit);
            assert(afterLimit.mismatchVisible === true, 'pokazana podpowiedz o roznicy limitu', afterLimit);

            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button')).find((b) => /Przelicz limitem/.test(b.textContent));
                btn.click();
            });
            await new Promise((r) => setTimeout(r, 300));
            const recomputed = await page.evaluate(() => ({
                energy: document.querySelectorAll('.stat-value')[0].textContent.trim(),
                peak: document.querySelectorAll('.stat-value')[1].textContent.trim(),
                stored: JSON.parse(localStorage.getItem('solar_history')).days['2026-08-04'].params.limit
            }));
            assert(recomputed.energy === '7.50' && recomputed.peak === '3000', 'przeliczenie limitem 3000 W', recomputed);
            assert(recomputed.stored === 3000, 'nowy limit zapisany w dniu', recomputed);

            // geokodowanie: throttling nie wywala aplikacji, wynik trafia do pól
            await page.evaluate(() => {
                const el = document.getElementById('param-address');
                el.value = 'Krakow';
                el.dispatchEvent(new Event('input', { bubbles: true }));
            });
            await page.evaluate(() => {
                const btn = document.querySelector('button[aria-label="Znajdź współrzędne adresu"]');
                btn.click();
            });
            await new Promise((r) => setTimeout(r, 1600));
            const geo = await page.evaluate(() => ({
                lat: document.getElementById('param-lat').value,
                lon: document.getElementById('param-lon').value
            }));
            assert(geo.lat === '50.061' && geo.lon === '19.937', 'geokodowanie ustawilo wspolrzedne', geo);
            assert(errors.length === 0, 'brak bledow konsoli', errors);
            await page.close();
        }

        // ============ 7. history.html: empty state od filtra ============
        section('[7] history.html: empty state, filtr, usuwanie');
        {
            const page = await freshPage(browser);
            const errors = [];
            attachRouting(page, errors);
            await interceptExternal(page);
            await page.evaluateOnNewDocument(() => {
                localStorage.setItem('solar_history', JSON.stringify({
                    version: 2,
                    days: {
                        '2026-08-01': { energy: 5, energyRaw: 5, peak: 3000, watts: { '2026-08-01 07:00:00': 2000, '2026-08-01 08:00:00': 3000 }, params: { lat: 52.2, lon: 21, dec: 30, az: 0, kwp: 8, limit: 5000 }, savedAt: '2026-08-01T00:00:00Z' },
                        '2026-08-02': { energy: 7, energyRaw: 7, peak: 4000, watts: { '2026-08-02 07:00:00': 3000, '2026-08-02 08:00:00': 4000 }, params: { lat: 52.2, lon: 21, dec: 30, az: 0, kwp: 8, limit: 5000 }, savedAt: '2026-08-02T00:00:00Z' }
                    }
                }));
            });
            await page.goto(BASE + '/history.html', { waitUntil: 'networkidle2' });
            await new Promise((r) => setTimeout(r, 300));

            const initial = await page.evaluate(() => ({
                days: document.querySelectorAll('.stat-value')[0].textContent.trim(),
                total: document.querySelectorAll('.stat-value')[1].textContent.trim(),
                avg: document.querySelectorAll('.stat-value')[2].textContent.trim(),
                rows: document.querySelectorAll('tbody tr:first-child').length
            }));
            assert(initial.days === '2' && initial.total === '6.00' && initial.avg === '3.00',
                'statystyki archiwum liczone z mocy godzinowych, nie z pola energy w pliku', initial);
            assert(initial.rows === 2, 'dwa wiersze w tabeli', initial);

            await page.evaluate(() => {
                const el = document.getElementById('history-search');
                el.value = '1999-01';
                el.dispatchEvent(new Event('input', { bubbles: true }));
            });
            await new Promise((r) => setTimeout(r, 250));
            const filtered = await page.evaluate(() => {
                const headings = Array.from(document.querySelectorAll('h2'))
                    .filter((h) => getComputedStyle(h).display !== 'none' && h.offsetParent !== null)
                    .map((h) => h.textContent.trim());
                return { headings: headings };
            });
            assert(filtered.headings.some((h) => /Brak wynikow dla filtra|Brak wyników dla filtra/.test(h)),
                'empty state pochodzi od filtra, nie od calej historii', filtered.headings);

            // chevron ma klasę zamiast inline transform (a więc i animację)
            await page.evaluate(() => {
                const el = document.getElementById('history-search');
                el.value = '';
                el.dispatchEvent(new Event('input', { bubbles: true }));
            });
            await new Promise((r) => setTimeout(r, 200));
            const chevron = await page.evaluate(() => {
                const btn = document.querySelector('tbody tr td:last-child button');
                btn.click();
                const svg = btn.querySelector('svg');
                return { expanded: btn.getAttribute('aria-expanded'), hasClass: svg.classList.contains('chevron') };
            });
            await new Promise((r) => setTimeout(r, 200));
            const chevronAfter = await page.evaluate(() => {
                const btn = document.querySelector('tbody tr td:last-child button');
                return { expanded: btn.getAttribute('aria-expanded'), open: btn.querySelector('svg').classList.contains('chevron-open') };
            });
            assert(chevron.hasClass, 'strzalka uzywa klasy .chevron (animacja z CSS)', chevron);
            assert(chevronAfter.expanded === 'true' && chevronAfter.open, 'rozwiniecie godzin dziala i ma aria-expanded', chevronAfter);
            assert(errors.length === 0, 'brak bledow konsoli', errors);
            await page.close();
        }

        // ============ 8. index.html: metryki, ram = null ============
        section('[8] index.html: metryki serwera (ram = null)');
        {
            const page = await freshPage(browser);
            const errors = [];
            attachRouting(page, errors);
            await interceptExternal(page);
            await page.goto(BASE + '/index.html', { waitUntil: 'networkidle2' });
            await new Promise((r) => setTimeout(r, 400));
            const stats = await page.evaluate(() => {
                const nums = Array.from(document.querySelectorAll('.stats .stat')).map((s) => ({
                    label: s.querySelector('.stat-label').textContent.trim(),
                    value: s.querySelector('.stat-num').textContent.trim(),
                    segsOn: s.querySelectorAll('.seg.on').length
                }));
                return { nums: nums, live: document.querySelector('.stats').getAttribute('aria-live') };
            });
            const ram = stats.nums.find((n) => n.label === 'RAM');
            const cpu = stats.nums.find((n) => n.label === 'CPU');
            assert(cpu.value === '13%', 'CPU wyswietlone jako procent', cpu);
            assert(ram.value === '\u2014' && ram.segsOn === 0, 'RAM = null pokazany jako pauza, bez zapalonych segmentow', ram);
            assert(stats.live === null, 'blok metryk nie jest regionem aria-live (brak zalewania czytnika)', stats.live);
            assert(errors.length === 0, 'brak bledow konsoli', errors);
            await page.close();
        }

        // ============ 9. Dostępność importu z klawiatury ============
        section('[9] Import z klawiatury (bez myszki)');
        {
            const page = await freshPage(browser);
            const errors = [];
            attachRouting(page, errors);
            await interceptExternal(page);
            await page.goto(BASE + '/panels.html', { waitUntil: 'networkidle2' });
            await new Promise((r) => setTimeout(r, 300));
            const focusable = await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Import');
                if (!btn) return { found: false };
                btn.focus();
                const input = document.querySelector('input[type="file"]');
                return {
                    found: true,
                    focused: document.activeElement === btn,
                    inputHidden: getComputedStyle(input).position === 'absolute' || input.classList.contains('sr-only'),
                    inputSkipped: input.tabIndex === -1
                };
            });
            assert(focusable.found && focusable.focused, 'przycisk Import jest fokusowalny', focusable);
            assert(focusable.inputHidden && focusable.inputSkipped, 'input pliku ukryty wizualnie i poza tab-orderem', focusable);
            assert(errors.length === 0, 'brak bledow konsoli', errors);
            await page.close();
        }

        // ============ 10. 404 i offline ============
        section('[10] 404 i offline');
        {
            const page = await freshPage(browser);
            const errors = [];
            attachRouting(page, errors);
            await interceptExternal(page);
            const httpStatus = await new Promise((resolve) => {
                http.get(BASE + '/nie-ma-takiej-strony', (r) => { r.resume(); resolve(r.statusCode); });
            });
            await page.goto(BASE + '/nie-ma-takiej-strony', { waitUntil: 'networkidle2' });
            const content = await page.evaluate(() => ({
                status: document.querySelector('.error-code').textContent.trim(),
                sub: document.querySelector('.error-sub').textContent.trim(),
                svgOk: !document.body.innerHTML.includes('stroke-none"'),
                h1: document.querySelectorAll('h1').length
            }));
            assert(httpStatus === 404, 'serwer zwraca 404', httpStatus);
            assert(content.status === '404', 'kod bledu widoczny', content);
            assert(content.sub === 'UPOŚLEDZENIE W STOPNIU KRYTYCZNYM', 'komunikat zachowany bez zmian', content.sub);
            assert(content.svgOk, 'brak zepsutego atrybutu SVG', content);
            assert(content.h1 === 1, 'dokladnie jeden <h1>', content);
            // samo 404 z serwera jest oczekiwane (przegladarka loguje status), reszta nie
            const real404Errors = errors.filter((e) => !/status of 404/.test(e));
            assert(real404Errors.length === 0, 'brak bledow konsoli na 404 (poza samym statusem 404)', real404Errors);
            await page.close();
        }

        // ============ 11. Widoki mobilne: brak poziomego przewijania ============
        section('[11] Mobile 360x640: brak ucietych etykiet i przewijania w poziomie');
        for (const [theme, mode] of [['brutalist', 'light'], ['editorial', 'light'], ['terminal', 'dark']]) {
            const page = await freshPage(browser);
            const errors = [];
            attachRouting(page, errors);
            await interceptExternal(page);
            await setTheme(page, theme, mode);
            await page.setViewport({ width: 360, height: 640 });
            await page.goto(BASE + '/index.html', { waitUntil: 'networkidle2' });
            await new Promise((r) => setTimeout(r, 300));
            const metrics = await page.evaluate(() => {
                const labels = Array.from(document.querySelectorAll('.stat-label'));
                const clipped = labels.filter((l) => l.scrollWidth > l.clientWidth + 1).map((l) => l.textContent.trim());
                return {
                    clipped: clipped,
                    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
                };
            });
            assert(metrics.clipped.length === 0, 'etykiety metryk nieuciete [' + theme + '/' + mode + ']', metrics.clipped);
            assert(metrics.overflow <= 0, 'brak poziomego przewijania [' + theme + '/' + mode + ']', metrics.overflow);
            assert(errors.length === 0, 'brak bledow konsoli [' + theme + ']', errors);
            await page.close();
        }

        // ============ 12. Service Worker: offline i cache ============
        section('[12] Service Worker (app shell, offline fallback, obce cache)');
        {
            const page = await freshPage(browser);
            const errors = [];
            attachRouting(page, errors);
            await interceptExternal(page);

            // obcy cache w tym samym originie — SW nie ma prawa go tknąć
            await page.goto(BASE + '/index.html', { waitUntil: 'networkidle2' });
            await page.evaluate(async () => {
                const c = await caches.open('obcy-cache-nie-nasz');
                await c.put('/obce', new Response('obce dane'));
            });

            await page.goto(BASE + '/panels.html', { waitUntil: 'networkidle2' });
            const ready = await page.evaluate(async () => {
                const reg = await navigator.serviceWorker.ready;
                // poczekaj na kontroler (aktywacja + clients.claim)
                for (let i = 0; i < 40 && !navigator.serviceWorker.controller; i++) {
                    await new Promise((r) => setTimeout(r, 100));
                }
                return {
                    scriptURL: reg.active ? reg.active.scriptURL : null,
                    controlled: !!navigator.serviceWorker.controller
                };
            });
            assert(ready.scriptURL !== null && ready.scriptURL.endsWith('/sw-v7.js'), 'zarejestrowany sw-v7.js', ready);
            assert(ready.controlled, 'strona jest kontrolowana przez SW', ready);

            const cacheState = await page.evaluate(async () => {
                const keys = await caches.keys();
                const shell = keys.find((k) => k.startsWith('wd-shell-'));
                const cache = shell ? await caches.open(shell) : null;
                const entries = cache ? (await cache.keys()).map((r) => new URL(r.url).pathname) : [];
                return { keys: keys, entries: entries };
            });
            assert(cacheState.keys.some((k) => k.startsWith('wd-')), 'cache ma namespace wd-', cacheState.keys);
            assert(cacheState.keys.includes('obcy-cache-nie-nasz'), 'obcy cache nietkniety przez aktywacje', cacheState.keys);
            for (const must of ['/panels.html', '/history.html', '/offline.html', '/assets/js/alpine.min.js',
                '/assets/js/uPlot.iife.min.js', '/assets/js/theme.js', '/assets/css/app-v6.css',
                '/assets/icons/favicon.png', '/assets/fonts/inter-400.woff2']) {
                assert(cacheState.entries.includes(must), 'app shell zawiera ' + must);
            }

            // ——— tryb offline ———
            await page.setOfflineMode(true);
            await page.goto(BASE + '/history.html', { waitUntil: 'domcontentloaded' });
            const offlineHistory = await page.evaluate(() => ({
                title: document.title,
                hasApp: typeof window.WikdraStorage !== 'undefined',
                h1: document.querySelector('h1') ? document.querySelector('h1').textContent.trim() : null
            }));
            assert(/Historia/.test(offlineHistory.title), 'history.html dziala offline', offlineHistory);
            assert(offlineHistory.hasApp, 'moduly JS dostepne offline (app shell kompletny)', offlineHistory);

            // page.setOfflineMode nie wpływa na żądania Service Workera, więc
            // prawdziwy brak sieci symulujemy wyłączeniem serwera.
            await stopServer(server);
            await page.goto(BASE + '/strona-ktorej-nie-ma-w-cache', { waitUntil: 'domcontentloaded' });
            const fallback = await page.evaluate(() => document.body.innerText.slice(0, 120));
            assert(/Brak po/.test(fallback), 'nawigacja bez cache pokazuje offline.html', fallback);

            await page.goto(BASE + '/panels.html', { waitUntil: 'domcontentloaded' });
            const offlinePanels = await page.evaluate(() => ({
                title: document.title,
                canvasOrEmpty: !!document.getElementById('forecastChart')
            }));
            assert(/Dashboard/.test(offlinePanels.title) && offlinePanels.canvasOrEmpty,
                'panels.html otwiera sie bez sieci (z app shellu)', offlinePanels);

            server = await startServer();
            await page.setOfflineMode(false);
            assert(errors.filter((e) => !/forecast\.solar|ERR_INTERNET_DISCONNECTED|Failed to fetch|net::ERR_FAILED|ERR_CONNECTION_REFUSED|status of 404/.test(e)).length === 0,
                'brak nieoczekiwanych bledow konsoli', errors);
            await page.close();
        }

    } finally {
        await browser.close();
        await stopServer(server);
    }

    clearTimeout(watchdog);
    console.log('\n' + (failed === 0
        ? 'SMOKE OK — ' + passed + ' asercji przeszlo'
        : 'SMOKE BLEDY — ' + failed + ' z ' + (passed + failed) + ' asercji nie przeszlo'));
    process.exit(failed === 0 ? 0 : 1);
})();
