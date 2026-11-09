/**
 * serve.js — mikroserwer statyczny dla `site/` do pracy lokalnej i zrzutów ekranu.
 * `/stats.php` i `/bichu*` obsługuje na serwerze usługa Go (server/). Lokalnie:
 *   - z WIKDRA_API (np. http://127.0.0.1:8092) te trasy idą do uruchomionej usługi:
 *       cd server && go run . serve --data-dir ../.dev-wikdra
 *   - bez niej `/stats.php` zwraca zaślepkę, a `/bichu` — 501.
 *
 * Użycie: npm run serve  (domyślnie http://127.0.0.1:8790)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const SITE = path.resolve(__dirname, '..', 'site');
const PORT = Number(process.env.PORT || 8790);
const API = process.env.WIKDRA_API ? new URL(process.env.WIKDRA_API) : null;

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

function proxy(req, res) {
    const up = http.request({
        host: API.hostname, port: API.port, method: req.method, path: req.url,
        headers: Object.assign({}, req.headers, { host: API.host })
    }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', (e) => { res.writeHead(502, { 'Content-Type': MIME['.txt'] }); res.end('usługa Go nie odpowiada: ' + e.message); });
    req.pipe(up);
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1:' + PORT);
    const dynamic = url.pathname === '/stats.php' || url.pathname.startsWith('/bichu');
    if (dynamic && API) {
        proxy(req, res);
        return;
    }
    if (url.pathname === '/stats.php') {
        res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ cpu: 17.3, ram: 42.1, disk: 47.2, age: 0 }));
        return;
    }
    if (url.pathname.startsWith('/bichu')) {
        res.writeHead(501, { 'Content-Type': MIME['.txt'] });
        res.end('Bichu obsługuje usługa Go: cd server && go run . serve --data-dir ../.dev-wikdra, potem WIKDRA_API=http://127.0.0.1:8092 npm run serve');
        return;
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.join(SITE, rel);
    if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404, { 'Content-Type': MIME['.html'] });
        res.end(fs.readFileSync(path.join(SITE, '404.html')));
        return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
});

server.listen(PORT, '127.0.0.1', () => {
    console.log('Serwer lokalny: http://127.0.0.1:' + PORT + (API ? ' (stats i Bichu → ' + API.origin + ')' : ''));
});
