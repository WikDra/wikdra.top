const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = 'D:\\wysypisko\\mikrus\\aktualny_wygląd_03.08';
const PIXEL_7_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36';

const pages = [
  { name: 'index', url: 'https://panele.wikdra.top/' },
  { name: 'panels', url: 'https://panele.wikdra.top/panels.html' },
  { name: 'history', url: 'https://panele.wikdra.top/history.html' },
  { name: '404', url: 'https://panele.wikdra.top/404.html' },
  { name: 'bichu', url: 'https://panele.wikdra.top/bichu.php' }
];

(async () => {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  console.log('Launching Puppeteer with real Pixel 7 viewport (accounting for Android address bar ~740px height)...');
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

  // Pixel 7 screen is 412x915, but Android status bar + Chrome address bar consume ~175px
  // Net usable inner browser height: 740px
  await page.setViewport({
    width: 412,
    height: 740,
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    isLandscape: false
  });

  await page.setUserAgent(PIXEL_7_UA);

  for (const p of pages) {
    console.log(`Navigating to ${p.name}...`);
    await page.goto(p.url, { waitUntil: 'networkidle2' });
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 800)));

    const screenPath = path.join(OUT_DIR, `real_phone_screen_${p.name}.png`);
    await page.screenshot({ path: screenPath, fullPage: false });
    console.log(`Saved: ${screenPath}`);
  }

  await browser.close();
  console.log('Real phone screenshots updated!');
})();
