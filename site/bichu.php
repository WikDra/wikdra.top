<?php
$content_file = 'bichu_content.txt';
$attempts_file = 'bichu_attempts.json';
$admin_password = '';
if (file_exists(__DIR__ . '/bichu_config.php')) {
    require_once __DIR__ . '/bichu_config.php';
}
// Simple API for AJAX
if (isset($_GET['api'])) {
    header('Content-Type: application/json');
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        // Rate limiting: 1s delay per failed attempt, 60s lockout after 5 failures
        $attempts = ['count' => 0, 'locked_until' => 0];
        if (file_exists($attempts_file)) {
            $decoded = json_decode(file_get_contents($attempts_file), true);
            if (is_array($decoded)) $attempts = array_merge($attempts, $decoded);
        }
        if (time() < $attempts['locked_until']) {
            http_response_code(429);
            echo json_encode(['success' => false, 'error' => 'Zbyt wiele nieudanych prób. Odczekaj minutę.']);
            exit;
        }

        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true);
        if (($data['password'] ?? '') === $admin_password) {
            file_put_contents($attempts_file, json_encode(['count' => 0, 'locked_until' => 0]));
            file_put_contents($content_file, $data['content'] ?? '');
            echo json_encode(['success' => true]);
        } else {
            sleep(1);
            $attempts['count']++;
            if ($attempts['count'] >= 5) {
                $attempts['locked_until'] = time() + 60;
                $attempts['count'] = 0;
            }
            file_put_contents($attempts_file, json_encode($attempts));
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Błędne hasło']);
        }
        exit;
    }
    echo json_encode(['content' => file_exists($content_file) ? file_get_contents($content_file) : '']);
    exit;
}
?>
<!DOCTYPE html>
<html lang="pl" class="h-full">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bichu | Wikdra.top</title>
    <link rel="icon" href="/assets/icons/favicon.png" type="image/png">

    <link rel="stylesheet" href="/assets/css/app-v6.css">
    <script defer src="/assets/js/alpine.min.js"></script>
    <style>[x-cloak] { display: none !important; }</style>

    <!-- Theme init (anti-FOUC) -->
    <script>
        function getCookie(name) {
            const nameEQ = name + "=";
            const ca = document.cookie.split(';');
            for (let i = 0; i < ca.length; i++) {
                let c = ca[i].trim();
                if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
            }
            return null;
        }
        function getSystemPreferredThemeAndMode() {
            const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            return { theme: isDark ? 'terminal' : 'brutalist', mode: isDark ? 'dark' : 'light' };
        }
        function getGlobalTheme() {
            return getCookie('global_theme') || localStorage.getItem('global_theme') || getSystemPreferredThemeAndMode().theme;
        }
        function getGlobalMode() {
            let mode = getCookie('global_mode') || localStorage.getItem('global_mode');
            if (mode) return mode;
            let hasTheme = getCookie('global_theme') || localStorage.getItem('global_theme');
            if (hasTheme) {
                let theme = getGlobalTheme();
                return (theme === 'brutalist' || theme === 'editorial') ? 'light' : 'dark';
            }
            return getSystemPreferredThemeAndMode().mode;
        }
        function setGlobal(key, val) {
            localStorage.setItem(key, val);
            if (window.location.hostname.endsWith('wikdra.top')) {
                document.cookie = key + "=;path=/;max-age=0;SameSite=Lax";
                document.cookie = key + "=" + val + ";path=/;domain=.wikdra.top;max-age=31536000;SameSite=Lax";
            } else {
                document.cookie = key + "=" + val + ";path=/;max-age=31536000;SameSite=Lax";
            }
        }
        (function () {
            const el = document.documentElement;
            el.dataset.theme = getGlobalTheme();
            el.dataset.mode = getGlobalMode();
        })();
    </script>
</head>
<body x-data="bichuApp()" class="min-h-screen p-4 md:p-8 relative">

    <!-- Background decoration (CSS-controlled per theme) -->
    <div class="bg-decoration" aria-hidden="true">
        <div class="orb orb-1"></div>
        <div class="orb orb-2"></div>
        <div class="orb orb-3"></div>
        <div class="cyber-grid"></div>
        <div class="cyber-scanlines"></div>
        <div class="cyber-glow"></div>
        <div class="cyber-sun"></div>
    </div>

    <div class="max-w-4xl mx-auto z-10 relative space-y-8">

        <!-- HEADER -->
        <header class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 w-full">
            <div>
                <a href="/" class="page-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                    <span>Bichu</span>
                </a>
            </div>

            <div class="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                <a href="/" class="theme-btn px-3 sm:px-4 text-xs sm:text-sm inline-flex items-center gap-1.5" style="text-decoration:none">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 shrink-0" style="height:0.9em;width:0.9em"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
                    <span>Powrót</span>
                </a>

                <!-- THEME SWITCHER (in flow) -->
                <div class="switcher" x-data="{ open: false }">
                    <button class="switcher-btn" @click="open = !open" :data-open="open" aria-label="Zmień motyw">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                    </button>
                    <div class="switcher-panel" x-show="open" @click.away="open = false" x-transition.origin.top.right style="display: none;">
                        <div class="switcher-title">Styl strony:</div>
                        <template x-for="t in themes" :key="t.key">
                            <button class="switcher-item" :class="{ 'active': theme === t.key }" @click="setTheme(t.key); open = false">
                                <span class="switcher-dot" :style="'background:' + t.color"></span>
                                <span x-text="t.name"></span>
                            </button>
                        </template>
                        <div class="switcher-sep"></div>
                        <div class="switcher-title">Tryb:</div>
                        <button class="switcher-item" :class="{ 'active': mode === 'light' }" @click="setMode('light'); open = false">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="switcher-dot" style="background:none"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4"/></svg>
                            Jasny
                        </button>
                        <button class="switcher-item" :class="{ 'active': mode === 'dark' }" @click="setMode('dark'); open = false">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="switcher-dot" style="background:none"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>
                            Ciemny
                        </button>
                    </div>
                </div>
            </div>
        </header>

        <main class="w-full relative">
            <!-- View Mode -->
            <div x-show="!editMode" x-cloak class="panel-card p-8 min-h-[300px] relative group">
                <div class="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-base leading-relaxed"
                     x-text="content || 'Brak treści...'"></div>

                <button @click="openEditor()"
                        class="absolute top-4 right-4 opacity-0 group-hover:opacity-100 theme-btn px-4 py-1.5 text-xs transition-opacity duration-200">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="height:0.8em;width:0.8em;margin-right:0.4em"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    Edytuj
                </button>
            </div>

            <!-- Edit Mode -->
            <div x-show="editMode" x-cloak class="panel-card p-8 space-y-6 relative">
                <div class="flex flex-col gap-2">
                    <label class="label-tiny">Hasło edycji</label>
                    <input type="password" x-model="password" placeholder="Wpisz hasło..." class="theme-input text-sm">
                </div>
                <div class="flex flex-col gap-2">
                    <label class="label-tiny">Treść strony</label>
                    <textarea x-model="tempContent" rows="12" class="theme-input resize-none font-mono text-sm"></textarea>
                </div>
                <div class="flex flex-wrap gap-4">
                    <button @click="save()" :disabled="saving" class="theme-btn py-2.5 px-6 text-sm flex-1">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="height:0.9em;width:0.9em;margin-right:0.4em" :style="saving && 'animation: spin 1s linear infinite'"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
                        ZAPISZ ZMIANY
                    </button>
                    <button @click="editMode = false" class="theme-btn theme-btn-secondary py-2.5 px-6 text-sm">Anuluj</button>
                </div>
            </div>
        </main>
    </div>

    <script>
        function bichuApp() {
            return {
                content: '',
                tempContent: '',
                password: '',
                editMode: false,
                saving: false,
                theme: getGlobalTheme(),
                mode: getGlobalMode(),
                themes: [
                    { key: 'brutalist', name: 'Neo-Brutalizm', color: '#eab308' },
                    { key: 'cyberpunk', name: 'Cyber Dashboard', color: '#22d3ee' },
                    { key: 'terminal', name: 'Dev Terminal', color: '#34d399' },
                    { key: 'aurora', name: 'Glassmorphism', color: '#a855f7' },
                    { key: 'editorial', name: 'Editorial', color: '#171717' }
                ],

                setTheme(val) {
                    this.theme = val;
                    this.mode = (val === 'brutalist' || val === 'editorial') ? 'light' : 'dark';
                    this.apply();
                },
                setMode(val) {
                    this.mode = val;
                    this.apply();
                },
                apply() {
                    const el = document.documentElement;
                    el.dataset.theme = this.theme;
                    el.dataset.mode = this.mode;
                    setGlobal('global_theme', this.theme);
                    setGlobal('global_mode', this.mode);
                },

                async init() {
                    const res = await fetch('?api=1');
                    const data = await res.json();
                    this.content = data.content;
                },

                openEditor() {
                    this.tempContent = this.content;
                    this.editMode = true;
                },

                async save() {
                    if (!this.password) {
                        alert('Podaj hasło!');
                        return;
                    }
                    this.saving = true;
                    try {
                        const res = await fetch('?api=1', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                password: this.password,
                                content: this.tempContent
                            })
                        });
                        if (res.ok) {
                            this.content = this.tempContent;
                            this.editMode = false;
                            this.password = '';
                        } else {
                            const data = await res.json();
                            alert('Błąd: ' + data.error);
                        }
                    } catch (e) {
                        alert('Wystąpił błąd połączenia.');
                    } finally {
                        this.saving = false;
                    }
                }
            }
        }
    </script>
</body>
</html>
