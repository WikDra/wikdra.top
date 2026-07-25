# wikdra.top

Repository for the **wikdra.top** / **panele.wikdra.top** website hosted on a Mikrus Alpine Linux VPS (Nginx).

## Repository structure

- `site/` - Everything served by Nginx:
  - `index.html` - main homepage
  - `panels.html` - solar forecast panels subpage
  - `history.html` - archive subpage (all saved histories, stats, export/import, search)
  - `404.html` - custom error page
  - `themes-v5.css` - central visual design system (5 themes x Light/Dark modes)
  - `sw-v5.js` - Service Worker v5 (Network-First strategy, PWA support)
  - `manifest.json` - PWA Web App Manifest
  - `robots.txt` & `sitemap.xml` - SEO and crawler files
  - `bichu.php` & `stats.php` - backend PHP endpoints
- `nginx/` - Nginx configuration templates (`combined.conf`, `panele.conf`, `default.conf.new`)
- `scripts/` - `deploy.bat` (Windows deployment via PSCP/Plink) and server helper scripts
- `docs/` - setup and deployment documentation

## Setup & Deployment

1. **Configuration** (local only, ignored by Git):
   - `config.bat` in the repo root with SSH connection variables (`MIKRUS_PW`, `MIKRUS_PORT`, `MIKRUS_USER`, `MIKRUS_HOST`)
   - optionally `site/bichu_config.php` for Bichu admin panel credentials
2. **Deploy**: run `scripts\deploy.bat` to upload the site to the Mikrus server, move files into `/var/lib/nginx/html/`, and restart Nginx.

See [docs/deployment.md](docs/deployment.md) for details.

## License

[MIT](LICENSE)
