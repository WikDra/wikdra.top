/*!
 * sw-v7.js — Service Worker dla wikdra.top.
 *
 * Poprawki względem sw-v6.js:
 *  • pełny app shell (Alpine, uPlot, moduły JS, ikony, fonty, offline.html),
 *  • instalacja odporna na braki: Promise.allSettled zamiast cache.addAll
 *    (jeden brakujący plik nie wywracał całej instalacji),
 *  • usuwa TYLKO własne cache (namespace `wd-` + jawna lista starych nazw),
 *    a nie wszystkie cache w originie,
 *  • nawigacje: network-first z limitem czasu → cache → offline.html
 *    (bez zapisu runtime, więc cache nie rośnie od `?date=`),
 *  • /assets/*: stale-while-revalidate (szybko i odświeża się w tle),
 *  • każdy zapis do cache trzymany w event.waitUntil.
 */

const VERSION = 'v7';
const PREFIX = 'wd-';
const SHELL_CACHE = PREFIX + 'shell-' + VERSION;
const ASSET_CACHE = PREFIX + 'assets-' + VERSION;
/** Nazwy cache z poprzednich wersji (przed namespace'em) — do jednorazowego sprzątnięcia. */
const LEGACY_CACHES = ['solar-forecast-v6', 'solar-forecast-v5'];
const NAV_TIMEOUT_MS = 4000;

const SHELL = [
    '/',
    '/index.html',
    '/panels.html',
    '/history.html',
    '/offline.html',
    '/manifest-solar.json',
    '/assets/css/app-v6.css',
    '/assets/css/uplot.min.css',
    '/assets/js/theme.js',
    '/assets/js/solar.js',
    '/assets/js/storage.js',
    '/assets/js/panels-app.js',
    '/assets/js/history-app.js',
    '/assets/js/index-app.js',
    '/assets/js/alpine.min.js',
    '/assets/js/uPlot.iife.min.js',
    '/assets/icons/favicon.png',
    '/assets/icons/icon-192.png',
    '/assets/icons/icon-512.png',
    '/assets/icons/icon-maskable-512.png',
    '/assets/fonts/syne-800.woff2',
    '/assets/fonts/space-grotesk-400.woff2',
    '/assets/fonts/space-grotesk-700.woff2',
    '/assets/fonts/orbitron-700.woff2',
    '/assets/fonts/orbitron-900.woff2',
    '/assets/fonts/space-mono-400.woff2',
    '/assets/fonts/space-mono-700.woff2',
    '/assets/fonts/inter-400.woff2',
    '/assets/fonts/inter-600.woff2',
    '/assets/fonts/inter-800.woff2',
    '/assets/fonts/playfair-400.woff2',
    '/assets/fonts/playfair-700.woff2',
    '/assets/fonts/jetbrains-mono-400.woff2',
    '/assets/fonts/jetbrains-mono-700.woff2'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);
        const results = await Promise.allSettled(
            SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })))
        );
        const failed = results
            .map((r, i) => (r.status === 'rejected' ? SHELL[i] : null))
            .filter(Boolean);
        if (failed.length) {
            console.warn('[sw] nie udało się dodać do app shell:', failed);
        }
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => {
            const isOurs = key.startsWith(PREFIX);
            const isLegacy = LEGACY_CACHES.includes(key);
            const isCurrent = key === SHELL_CACHE || key === ASSET_CACHE;
            // obce cache w tym originie zostają nietknięte
            if ((isOurs && !isCurrent) || isLegacy) return caches.delete(key);
            return Promise.resolve(false);
        }));
        await self.clients.claim();
    })());
});

function isSameOrigin(url) {
    return url.origin === self.location.origin;
}

/** Endpointy dynamiczne nigdy nie idą do cache. */
function isDynamic(pathname) {
    return pathname.endsWith('/stats.php') || pathname.indexOf('/bichu') === 0 || pathname.endsWith('bichu.php');
}

function fetchWithTimeout(request, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        fetch(request).then(
            (response) => { clearTimeout(timer); resolve(response); },
            (error) => { clearTimeout(timer); reject(error); }
        );
    });
}

/** Nawigacja: świeże HTML, a gdy sieci nie ma — kopia z shellu lub strona offline. */
async function handleNavigation(request) {
    const url = new URL(request.url);
    try {
        const response = await fetchWithTimeout(request, NAV_TIMEOUT_MS);
        if (response && response.ok) return response;
        // 404/500 też pokazujemy — to poprawna odpowiedź serwera
        if (response) return response;
    } catch (e) { /* brak sieci → niżej */ }

    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(url.pathname) || (url.pathname.endsWith('/') ? await cache.match(url.pathname + 'index.html') : null);
    if (cached) return cached;
    const offline = await cache.match('/offline.html');
    return offline || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

/** Zasoby: natychmiast z cache, odświeżenie w tle (stale-while-revalidate). */
async function handleAsset(event) {
    const cache = await caches.open(ASSET_CACHE);
    const shell = await caches.open(SHELL_CACHE);
    const cached = (await shell.match(event.request)) || (await cache.match(event.request));

    const network = fetch(event.request).then(async (response) => {
        if (response && response.ok) {
            await cache.put(event.request, response.clone());
        }
        return response;
    }).catch(() => null);

    if (cached) {
        // odświeżenie musi przeżyć zwrócenie odpowiedzi
        event.waitUntil(network);
        return cached;
    }
    const fresh = await network;
    return fresh || new Response('', { status: 504 });
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (!isSameOrigin(url) || isDynamic(url.pathname)) return;

    if (request.mode === 'navigate') {
        event.respondWith(handleNavigation(request));
        return;
    }
    if (url.pathname.startsWith('/assets/') || url.pathname === '/manifest-solar.json') {
        event.respondWith(handleAsset(event));
    }
});
