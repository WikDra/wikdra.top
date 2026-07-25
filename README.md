# wikdra.top

This is the repository for the **wikdra.top** / **panele.wikdra.top** website hosted on a Mikrus Alpine Linux VPS.

## Repository structure

- `index.html` - The main homepage file.
- `panels.html` - The solar forecast panels subpage.
- `history.html` - Archive subpage displaying all saved histories, stats, export/import and search.
- `404.html` - Custom error page.
- `themes-v5.css` - Central visual design system (5 themes x Light/Dark modes).
- `sw-v5.js` - Service Worker v5 with Network-First strategy and PWA support.
- `robots.txt` & `sitemap.xml` - SEO and crawler files.
- `manifest.json` - PWA Web App Manifest.
- `bichu.php` & `stats.php` - Backend PHP endpoints.
- `*.conf` - Nginx configuration templates.
- `deploy.bat` - Windows deployment script using PSCP/Plink.

## Setup & Deployment

1. **Configuration**:
   Ensure `config.bat` exists in the repository root directory (it is ignored by Git). It should contain connection variables:
   ```cmd
   @set MIKRUS_PW=YOUR_PASSWORD
   @set MIKRUS_PORT=11098
   @set MIKRUS_USER=frog
   @set MIKRUS_HOST=frog02.mikr.us
   ```
   Optionally create `bichu_config.php` for Bichu admin panel credentials (also ignored by Git).

2. **Deploying**:
   Run `deploy.bat` in the terminal to automatically upload all updated site files to Mikrus server, move them to `/var/lib/nginx/html/` with `sudo`, and restart Nginx.

