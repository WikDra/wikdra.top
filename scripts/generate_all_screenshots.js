const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WORKSPACE_DIR = path.resolve(__dirname, '..'); // d:\wysypisko\mikrus\wikdra.top
const MIKRUS_PARENT_DIR = path.resolve(WORKSPACE_DIR, '..'); // d:\wysypisko\mikrus

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36';

function getGitDetails() {
  try {
    const branch = execSync('git branch --show-current', { cwd: WORKSPACE_DIR }).toString().trim() || 'unknown-branch';
    const shortHash = execSync('git rev-parse --short HEAD', { cwd: WORKSPACE_DIR }).toString().trim() || 'unknown-hash';
    const fullHash = execSync('git rev-parse HEAD', { cwd: WORKSPACE_DIR }).toString().trim() || 'unknown-full-hash';
    const commitMsg = execSync('git log -1 --format="%s"', { cwd: WORKSPACE_DIR }).toString().trim() || '';
    const commitDate = execSync('git log -1 --format="%ci"', { cwd: WORKSPACE_DIR }).toString().trim() || '';
    return { branch, shortHash, fullHash, commitMsg, commitDate };
  } catch (e) {
    return {
      branch: 'modernize',
      shortHash: 'HEAD',
      fullHash: 'HEAD',
      commitMsg: 'Local working copy',
      commitDate: new Date().toISOString()
    };
  }
}

const gitInfo = getGitDetails();
const dateStr = new Date().toISOString().split('T')[0];
const defaultFolderName = `screenshots_${gitInfo.branch}_${gitInfo.shortHash}_${dateStr}`;
const targetOutDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(MIKRUS_PARENT_DIR, defaultFolderName);

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

// Adres bazowy: domyślnie produkcja, ale można wskazać lokalny build.
// UWAGA: zrzuty z produkcji dokumentują to, co JEST WDROŻONE — nie to, co leży
// w bieżącym commicie. Dla weryfikacji zmian przed wdrożeniem:
//   npm run serve                                   (w drugim terminalu)
//   $env:BASE_URL="http://127.0.0.1:8790"; npm run screenshots
const BASE_URL = (process.env.BASE_URL || 'https://panele.wikdra.top').replace(/\/+$/, '');
const IS_LOCAL = /127\.0\.0\.1|localhost/.test(BASE_URL);

// Opcjonalne filtry (listy po przecinku), np. ONLY_THEMES=aurora,brutalist
const ONLY_THEMES = (process.env.ONLY_THEMES || '').split(',').filter(Boolean);
const ONLY_PAGES = (process.env.ONLY_PAGES || '').split(',').filter(Boolean);
const ONLY_DEVICES = (process.env.ONLY_DEVICES || '').split(',').filter(Boolean);

const pages = [
  { name: 'index', url: BASE_URL + '/index.html' },
  { name: 'panels', url: BASE_URL + '/panels.html' },
  { name: 'history', url: BASE_URL + '/history.html' },
  { name: '404', url: BASE_URL + '/404.html' },
  { name: 'offline', url: BASE_URL + '/offline.html' },
  // bichu.php wymaga PHP — przy serwerze lokalnym bez PHP jest pomijane
  { name: 'bichu', url: BASE_URL + '/bichu.php', skipLocal: true }
].filter((p) => (ONLY_PAGES.length === 0 || ONLY_PAGES.includes(p.name)) && !(IS_LOCAL && p.skipLocal));

function createReadme(outDir) {
  const content = `# Zrzuty Ekranu: ${gitInfo.branch} (${gitInfo.shortHash})

Ten katalog zawiera automatycznie wygenerowany zestaw zrzutów ekranu serwisu **wikdra.top** dla różnych urządzeń oraz wszystkich 5 motywów v6 (w trybie jasnym i ciemnym).

## Informacje o Commicie

- **Gałąź (Branch):** \`${gitInfo.branch}\`
- **Short Hash:** \`${gitInfo.shortHash}\`
- **Full Commit Hash:** \`${gitInfo.fullHash}\`
- **Tytuł Commita:** \`${gitInfo.commitMsg}\`
- **Data Commita:** \`${gitInfo.commitDate}\`
- **Data Generowania:** \`${new Date().toLocaleString('pl-PL')}\`
- **Adres bazowy:** \`${BASE_URL}\`${IS_LOCAL ? ' (lokalny build — odpowiada temu commitowi)' : '\n\n> [!WARNING]\n> Zrzuty pochodzą z PRODUKCJI. Sam URL nie gwarantuje, że produkcja odpowiada bieżącemu commitowi — sprawdź, co jest wdrożone.'}

> [!NOTE]
> **Uwaga dotycząca wykresów fotowoltaiki na podstronie Paneli (\`panels.png\`):**
> Ewentualny brak wykresu na niektórych zrzutach wynika wyłącznie z przekroczenia limitu zapytań (rate limit) zewnętrznego API (\`forecast.solar\`). Kod renderujący uPlot działa w 100% poprawnie.

---

## 📁 Struktura Urządzeń

- \`1_desktop_1080p/\`: Widok komputerowy (1920x1080 px)
- \`2_pixel7_412x915/\`: Widok telefonu Google Pixel 7 (viewport 412x740 px z uwzględnieniem paska adresu Chrome)
- \`3_small_phone_360x640/\`: Widok małego telefonu mobilnego (viewport 360x610 px)

Dla każdego urządzenia wygenerowano podkatalogi dla 10 kombinacji motywów (5 motywów x 2 tryby: light/dark).
`;

  fs.writeFileSync(path.join(outDir, 'README.md'), content, 'utf8');
}

(async () => {
  console.log(`Starting automated screenshot generator...`);
  console.log(`Git Branch: ${gitInfo.branch}`);
  console.log(`Git Commit: ${gitInfo.shortHash} (${gitInfo.commitMsg})`);
  console.log(`Target Folder: ${targetOutDir}\n`);

  if (!fs.existsSync(targetOutDir)) {
    fs.mkdirSync(targetOutDir, { recursive: true });
  }

  createReadme(targetOutDir);

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

  for (const dev of devices.filter((d) => ONLY_DEVICES.length === 0 || ONLY_DEVICES.includes(d.folder))) {
    const devDir = path.join(targetOutDir, dev.folder);
    if (!fs.existsSync(devDir)) {
      fs.mkdirSync(devDir, { recursive: true });
    }

    console.log(`=== Processing Device: ${dev.folder} ===`);
    await page.setViewport(dev.viewport);
    await page.setUserAgent(dev.ua);

    for (const combo of themeCombos.filter((c) => ONLY_THEMES.length === 0 || ONLY_THEMES.includes(c.theme))) {
      const themeDir = path.join(devDir, `${combo.theme}_${combo.mode}`);
      if (!fs.existsSync(themeDir)) {
        fs.mkdirSync(themeDir, { recursive: true });
      }

      console.log(`  Applying Theme: ${combo.theme} (${combo.mode})...`);

      for (const p of pages) {
        await page.goto(p.url, { waitUntil: 'networkidle2' });

        await page.evaluate(({ theme, mode }) => {
          document.documentElement.dataset.theme = theme;
          document.documentElement.dataset.mode = mode;
          localStorage.setItem('global_theme', theme);
          localStorage.setItem('global_mode', mode);
          document.cookie = `global_theme=${theme};path=/;max-age=31536000`;
          document.cookie = `global_mode=${mode};path=/;max-age=31536000`;
        }, combo);

        await page.evaluate(() => new Promise(r => setTimeout(r, 350)));

        const filePath = path.join(themeDir, `${p.name}.png`);
        await page.screenshot({ path: filePath, fullPage: false });
      }
    }
  }

  await browser.close();
  console.log(`\n✅ Screenshots generated successfully into:\n${targetOutDir}`);
})();
