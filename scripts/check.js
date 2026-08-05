/**
 * check.js — jedna bramka jakości dla repo. Uruchamiane przez `npm run check`.
 *
 * Sprawdza to, co da się sprawdzić bez stawiania środowiska serwerowego:
 *   1. składnia wszystkich własnych plików JS (node --check),
 *   2. build CSS jest deterministyczny (artefakt zgodny ze źródłem),
 *   3. poprawność JSON-ów (manifest, package),
 *   4. brak prywatnych współrzędnych i typowych wpadek w plikach site/,
 *   5. `php -l` dla plików PHP — tylko jeśli PHP jest dostępne w PATH
 *      (na Windowsie zwykle nie jest; wtedy krok jest pomijany z ostrzeżeniem).
 */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
let failures = 0;
let warnings = 0;

function ok(msg) { console.log('  \u2713 ' + msg); }
function fail(msg) { console.error('  \u2717 ' + msg); failures++; }
function warn(msg) { console.warn('  ! ' + msg); warnings++; }
function section(name) { console.log('\n' + name); }

// ——— 1. składnia JS ———
section('[1/5] Skladnia JS');
const ownJs = [
    'assets/js/theme.js',
    'assets/js/solar.js',
    'assets/js/storage.js',
    'assets/js/panels-app.js',
    'assets/js/history-app.js',
    'assets/js/index-app.js',
    'assets/js/bichu-app.js',
    'sw-v7.js'
].map((p) => path.join(SITE, p));
const scriptJs = ['generate_icons.js', 'generate_all_screenshots.js', 'check.js', 'smoke.js', 'serve.js']
    .map((p) => path.join(ROOT, 'scripts', p))
    .filter((p) => fs.existsSync(p));

for (const file of ownJs.concat(scriptJs)) {
    const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (res.status === 0) ok(path.relative(ROOT, file));
    else fail(path.relative(ROOT, file) + ': ' + (res.stderr || '').split('\n')[0]);
}

// ——— 2. build CSS deterministyczny ———
section('[2/5] Build CSS');
const cssArtifact = path.join(SITE, 'assets/css/app-v6.css');
const tailwindCli = path.join(ROOT, 'node_modules', '@tailwindcss', 'cli', 'dist', 'index.mjs');
const tmpOut = path.join(ROOT, 'src', '_check-build.css');
try {
    if (!fs.existsSync(tailwindCli)) throw new Error('brak node_modules/@tailwindcss/cli — uruchom `npm ci`');
    // Budujemy do pliku tymczasowego, żeby kontrola nigdy nie modyfikowała artefaktu.
    execFileSync(process.execPath, [tailwindCli, '-i', 'src/app.css', '-o', path.relative(ROOT, tmpOut), '--minify'], {
        cwd: ROOT, stdio: 'pipe'
    });
    const fresh = fs.readFileSync(tmpOut, 'utf8');
    const committed = fs.existsSync(cssArtifact) ? fs.readFileSync(cssArtifact, 'utf8') : null;
    if (committed === null) fail('brak artefaktu ' + path.relative(ROOT, cssArtifact));
    else if (committed === fresh) ok('artefakt zgodny ze zrodlem (bit w bit)');
    else fail('artefakt CSS rozni sie od wyniku builda — uruchom `npm run build:css` i zacommituj');
} catch (e) {
    fail('build CSS nie przeszedl: ' + (e.stderr ? String(e.stderr).slice(0, 300) : e.message));
} finally {
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
}

// ——— 3. JSON-y ———
section('[3/5] Pliki JSON');
for (const rel of ['site/manifest-solar.json', 'package.json']) {
    try {
        JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
        ok(rel);
    } catch (e) {
        fail(rel + ': ' + e.message);
    }
}

// ——— 4. reguły treści ———
section('[4/5] Reguly tresci');
function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}
const textFiles = walk(SITE).concat(walk(path.join(ROOT, 'scripts')))
    .filter((f) => /\.(html|php|js|json|txt|xml|sh|bat|conf)$/i.test(f))
    .filter((f) => !/alpine\.min\.js|uPlot\.iife\.min\.js|uplot\.min\.css|app-v6\.css/.test(f))
    // pliki weryfikujące zawierają same wzorce kontrolne, więc pasowałyby do reguł
    .filter((f) => ['check.js', 'smoke.js'].indexOf(path.basename(f)) === -1);

const forbidden = [
    { re: /50\.482|21\.315/, msg: 'prywatne wspolrzedne domowe' },
    // liczy się faktyczne odwołanie (rejestracja/atrybut src), nie wzmianka w komentarzu
    { re: /(?:register\(|src=)["']\/sw-v[56]\.js/, msg: 'odwolanie do starego Service Workera' },
    { re: /rel="manifest"\s+href="\/manifest\.json"/, msg: 'odwolanie do usunietego manifest.json' },
    { re: /stroke-none"/, msg: 'zepsuty atrybut SVG (stroke-none")' },
    { re: /JSON\.parse\(localStorage/, msg: 'niezabezpieczony JSON.parse na localStorage' }
];
let contentIssues = 0;
for (const file of textFiles) {
    const text = fs.readFileSync(file, 'utf8');
    for (const rule of forbidden) {
        if (rule.re.test(text)) {
            fail(path.relative(ROOT, file) + ': ' + rule.msg);
            contentIssues++;
        }
    }
}
if (contentIssues === 0) ok('brak zakazanych wzorcow w ' + textFiles.length + ' plikach');

// każda strona musi mieć dokładnie jeden <h1>
for (const page of ['index.html', 'panels.html', 'history.html', '404.html', 'offline.html']) {
    const text = fs.readFileSync(path.join(SITE, page), 'utf8');
    const count = (text.match(/<h1[\s>]/g) || []).length;
    if (count === 1) ok(page + ': jeden <h1>');
    else fail(page + ': liczba <h1> = ' + count);
}

// ——— 5. PHP ———
section('[5/5] Skladnia PHP');
const phpCmd = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['php'], { encoding: 'utf8' });
if (phpCmd.status !== 0) {
    warn('PHP nie jest w PATH — pominieto `php -l` (uruchom na serwerze: php -l bichu.php stats.php)');
} else {
    for (const rel of ['site/bichu.php', 'site/stats.php']) {
        const res = spawnSync('php', ['-l', path.join(ROOT, rel)], { encoding: 'utf8' });
        if (res.status === 0) ok(rel);
        else fail(rel + ': ' + (res.stdout || res.stderr || '').trim().split('\n')[0]);
    }
}

console.log('\n' + (failures === 0
    ? 'WYNIK: OK' + (warnings ? ' (ostrzezenia: ' + warnings + ')' : '')
    : 'WYNIK: BLEDY: ' + failures));
process.exit(failures === 0 ? 0 : 1);
