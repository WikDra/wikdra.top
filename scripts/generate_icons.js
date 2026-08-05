/**
 * generate_icons.js — generuje PRAWDZIWE pliki PNG ikon PWA.
 *
 * Powód istnienia: dotychczasowe icon-192.png / icon-512.png były w rzeczywistości
 * plikami JPEG z rozszerzeniem .png (identyczna zawartość, 1024×1024), a favicon.png
 * w ogóle nie istniał — przeglądarki odrzucały ikony, favicon zwracał 404.
 *
 * Renderuje SVG w Chrome (puppeteer-core) i zapisuje zrzuty w wymaganych rozmiarach:
 *   icon-192.png, icon-512.png (purpose: any), icon-maskable-512.png (safe zone 20%),
 *   favicon.png (32×32).
 *
 * Użycie: node scripts/generate_icons.js
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = path.resolve(__dirname, '..', 'site', 'assets', 'icons');

const BG = '#0f172a';
const SUN = '#eab308';
const PANEL = '#22d3ee';

/**
 * @param {number} inset margines bezpieczeństwa w procentach (maskable = 20)
 * @param {boolean} rounded czy tło ma zaokrąglone narożniki (nie dla maskable)
 */
function svg(inset, rounded) {
    const scale = (100 - 2 * inset) / 100;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="${BG}" ${rounded ? 'rx="96"' : ''}/>
  <g transform="translate(256,256) scale(${scale}) translate(-256,-256)">
    <circle cx="256" cy="196" r="60" fill="${SUN}"/>
    <g stroke="${SUN}" stroke-width="18" stroke-linecap="round">
      <path d="M256 96v-34"/>
      <path d="M256 296v34"/>
      <path d="M156 196h-34"/>
      <path d="M356 196h34"/>
      <path d="M186 126l-24-24"/>
      <path d="M326 126l24-24"/>
    </g>
    <path d="M116 402h280l-40-96H156z" fill="${PANEL}" fill-opacity="0.9"/>
    <g stroke="${BG}" stroke-width="10">
      <path d="M156 306l-40 96"/>
      <path d="M256 306v96"/>
      <path d="M356 306l40 96"/>
      <path d="M170 354h172"/>
    </g>
    <rect x="236" y="402" width="40" height="34" fill="${PANEL}" fill-opacity="0.9"/>
    <rect x="176" y="436" width="160" height="16" rx="8" fill="${PANEL}" fill-opacity="0.9"/>
  </g>
</svg>`;
}

async function shoot(page, markup, size, file) {
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
          html,body{margin:0;padding:0;background:transparent}
          svg{display:block;width:${size}px;height:${size}px}
        </style></head><body>${markup}</body></html>`
    );
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.goto(dataUrl, { waitUntil: 'load' });
    const target = path.join(OUT_DIR, file);
    await page.screenshot({ path: target, type: 'png', omitBackground: true });
    const bytes = fs.readFileSync(target);
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    console.log(`${file}: ${isPng ? 'PNG' : 'NIE-PNG!'} ${width}x${height} ${bytes.length} B`);
    if (!isPng || width !== size || height !== size) {
        throw new Error(`Nieprawidłowy plik wynikowy: ${file}`);
    }
}

(async () => {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: true,
        args: ['--force-device-scale-factor=1']
    });
    const page = await browser.newPage();
    try {
        await shoot(page, svg(0, true), 512, 'icon-512.png');
        await shoot(page, svg(0, true), 192, 'icon-192.png');
        // maskable: treść w bezpiecznym obszarze (80%), tło pełne bez zaokrągleń
        await shoot(page, svg(10, false), 512, 'icon-maskable-512.png');
        await shoot(page, svg(0, true), 32, 'favicon.png');
    } finally {
        await browser.close();
    }
    console.log('Gotowe. Po wdrożeniu wyczyść cache Cloudflare dla /assets/icons/*.');
})();
