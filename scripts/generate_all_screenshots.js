const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_OUT_DIR = 'D:\\wysypisko\\mikrus\\aktualny_wygląd_03.08';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36';

const devices = [
  {
    folder: '1_desktop_1080p',
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    ua: DESKTOP_UA
  },
  {
    folder: '2_pixel7_412x915',
    viewport: { width: 412, height: 740, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
    ua: MOBILE_UA
  },
  {
    folder: '3_small_phone_360x640',
    viewport: { width: 360, height: 610, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    ua: MOBILE_UA
  }
];

const themeCombos = [
  { theme: 'brutalist', mode: 'light' },
  { theme: 'brutalist', mode: 'dark' },
  { theme: 'cyberpunk', mode: 'dark' },
  { theme: 'cyberpunk', mode: 'light' },
  { theme: 'terminal', mode: 'dark' },
  { theme: 'terminal', mode: 'light' },
  { theme: 'aurora', mode: 'dark' },
  { theme: 'aurora', mode: 'light' },
  { theme: 'editorial', mode: 'light' },
  { theme: 'editorial', mode: 'dark' }
];

const pages = [
  { name: 'index', url: 'https://panele.wikdra.top/index.html' },
  { name: 'panels', url: 'https://panele.wikdra.top/panels.html' },
  { name: 'history', url: 'https://panele.wikdra.top/history.html' },
  { name: '404', url: 'https://panele.wikdra.top/404.html' },
  { name: 'bichu', url: 'https://panele.wikdra.top/bichu.php' }
];

(async () => {
  console.log('Starting full multi-theme, multi-device screenshot generation...');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--hide-scrollbars',
      '--enable-viewport',
      '--touch-events=enabled'
    ]
  });

  const page = await browser.newPage();

  for (const dev of devices) {
    const devDir = path.join(BASE_OUT_DIR, dev.folder);
    if (!fs.existsSync(devDir)) {
      fs.mkdirSync(devDir, { recursive: true });
    }

    console.log(`\n=== Processing Device: ${dev.folder} ===`);
    await page.setViewport(dev.viewport);
    await page.setUserAgent(dev.ua);

    for (const combo of themeCombos) {
      const themeDir = path.join(devDir, `${combo.theme}_${combo.mode}`);
      if (!fs.existsSync(themeDir)) {
        fs.mkdirSync(themeDir, { recursive: true });
      }

      console.log(`  Applying Theme: ${combo.theme} (${combo.mode})...`);

      for (const p of pages) {
        await page.goto(p.url, { waitUntil: 'networkidle2' });

        // Apply theme directly into documentElement dataset & localStorage
        await page.evaluate(({ theme, mode }) => {
          document.documentElement.dataset.theme = theme;
          document.documentElement.dataset.mode = mode;
          localStorage.setItem('global_theme', theme);
          localStorage.setItem('global_mode', mode);
          document.cookie = `global_theme=${theme};path=/;max-age=31536000`;
          document.cookie = `global_mode=${mode};path=/;max-age=31536000`;
        }, combo);

        // Wait a short moment for CSS transitions and fonts
        await page.evaluate(() => new Promise(r => setTimeout(r, 400)));

        const filePath = path.join(themeDir, `${p.name}.png`);
        await page.screenshot({ path: filePath, fullPage: false });
      }
    }
  }

  await browser.close();
  console.log('\n✅ All screenshots generated cleanly into structured folders!');
})();
