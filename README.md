# wikdra.top

This is the repository for the **wikdra.top** / **panele.wikdra.top** website hosted on a Mikrus Alpine Linux VPS.

## Repository structure

- `index.html` - The main homepage file.
- `panels.html` - The panels subpage.
- `404.html` - Error page.
- `robots.txt` & `sitemap.xml` - SEO and crawler files.
- `manifest.json` & `sw.js` / `sw-v4.js` - Service Worker / PWA assets.
- `bichu.php` & `stats.php` - Backend/PHP scripts.
- `*.conf` - Nginx configuration templates.
- `deploy.bat` - Local Windows script to deploy the main index file to the server.
- `encode_index.py` - Script that base64-encodes `index.html` into `clean.b64` (used in deployment).
- `clean_b64.py` - Script that cleans up raw base64 data.
- `create_update_sh.py` - Script to generate the update script.

## Setup & Deployment

1. **Configuration**:
   Ensure `config.bat` exists in the repository root directory (it is ignored by Git). It should contain connection variables:
   ```cmd
   @set MIKRUS_PW=YOUR_PASSWORD
   @set MIKRUS_PORT=11098
   @set MIKRUS_USER=frog
   @set MIKRUS_HOST=frog02.mikr.us
   ```

2. **Editing content**:
   Edit `index.html` as needed.

3. **Deploying**:
   - First, update the encoded main file by running `python encode_index.py`.
   - Then, deploy the changes to the Mikrus server using:
     ```cmd
     deploy.bat
     ```
     This automatically uploads the encoded file, decodes it on the server, places it under `/var/lib/nginx/html/` with sudo, and restarts Nginx.
